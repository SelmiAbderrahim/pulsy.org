import { incidentRecoveryDelivery } from "./incident-delivery";
import { db, uptimeMaintenance, uptimeDeferredAlert, uptimeMonitor, uptimeStatusChange, user, type DbExecutor, type DeferredAlertSnapshot, type apiMaintenanceConfig } from "@pulsy/db";
import { and, desc, eq, gt, inArray, lt, lte, or, ne, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { RecurrenceRule, scheduleJob, scheduledJobs } from "node-schedule";
import { dispatchNotifications, type DispatchOptions } from "./notification-service";
import type { Translator } from "../../lib/i18n";
import type { z } from "zod";

type Config = z.output<typeof apiMaintenanceConfig>;
type Window = typeof uptimeMaintenance.$inferSelect;

function recurrenceRule(config: Config): RecurrenceRule {
	const start = new Date(config.startsAt);
	const parts = new Intl.DateTimeFormat("en-US", { timeZone: config.timezone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(start);
	const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
	const rule = new RecurrenceRule();
	rule.tz = config.timezone; rule.hour = Number(get("hour")); rule.minute = Number(get("minute")); rule.second = start.getUTCSeconds();
	if (config.recurrence === "weekly") rule.dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
	return rule;
}

/** Library recurrence; nonexistent local times are skipped. Duration is elapsed time. */
export function previewMaintenance(config: Config, now = new Date()): Array<{ startsAt: string; endsAt: string }> {
	const start = Date.parse(config.startsAt); const duration = Date.parse(config.endsAt) - start;
	if (config.recurrence === "once") return Date.parse(config.endsAt) > now.getTime() ? [{ startsAt: config.startsAt, endsAt: config.endsAt }] : [];
	const key = JSON.stringify([config.startsAt, config.endsAt, config.timezone, config.recurrence]);
	const previous = occurrenceCache.get(key);
	if (previous && now.getTime() >= previous.computedAt && Date.parse(previous.occurrences[0]!.endsAt) > now.getTime()) return previous.occurrences;
	const rule = recurrenceRule(config);
	let cursor = new Date(Math.max(start - 1000, now.getTime() - duration - 1000));
	const result: Array<{ startsAt: string; endsAt: string }> = [];
	// A local time inside the repeated autumn hour (e.g. 02:30) happens twice that day. The window
	// belongs to the first occurrence only: a second one an hour later would silence alerts again.
	const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone });
	const repeatsEarlierToday = (next: Date) => {
		const earlier = rule.nextInvocationDate(new Date(next.getTime() - 3 * 3600_000));
		return !!earlier && earlier.getTime() < next.getTime() && localDay.format(earlier) === localDay.format(next);
	};
	// Bound previews to five upcoming occurrences.
	for (let i = 0; i < 10 && result.length < 5; i++) {
		const next = rule.nextInvocationDate(cursor);
		if (!next) break;
		const end = next.getTime() + duration;
		if (next.getTime() >= start && end > now.getTime() && !repeatsEarlierToday(next)) result.push({ startsAt: next.toISOString(), endsAt: new Date(end).toISOString() });
		cursor = next;
	}
	if (result.length) {
		// Bound calendar cache storage per process.
		if (occurrenceCache.size >= 512) occurrenceCache.delete(occurrenceCache.keys().next().value!);
		occurrenceCache.set(key, { computedAt: now.getTime(), occurrences: result });
	}
	return result;
}

// Cache calendar arithmetic, never ownership or enabled state. Absolute bounds
// are checked against the current clock on every use; config edits change the key.
const occurrenceCache = new Map<string, { computedAt: number; occurrences: ReturnType<typeof previewMaintenance> }>();
function currentOccurrences(window: Window, now: Date) {
	if (window.recurrence === "once") return [{ startsAt: window.startsAt, endsAt: window.endsAt }];
	const key = JSON.stringify([window.startsAt, window.endsAt, window.timezone, window.recurrence]);
	const previous = occurrenceCache.get(key);
	if (previous && now.getTime() >= previous.computedAt && Date.parse(previous.occurrences.at(-1)!.endsAt) > now.getTime()) return previous.occurrences;
	return previewMaintenance(window, now);
}

export function effectiveSuppressions(windows: Window[], now = new Date()) {
	const result = new Map<string, { ids: string[]; until: string; maintenance: boolean }>();
	for (const window of windows) {
		if (!window.enabled) continue;
		const active = currentOccurrences(window, now).filter(occurrence => Date.parse(occurrence.startsAt) <= now.getTime() && Date.parse(occurrence.endsAt) > now.getTime());
		if (!active.length) continue;
		const until = active.map(value => value.endsAt).sort().at(-1)!;
		for (const monitorId of window.monitorIds) {
			const previous = result.get(monitorId);
			result.set(monitorId, { ids: [...new Set([...(previous?.ids ?? []), window.id])], until: previous && previous.until > until ? previous.until : until, maintenance: Boolean(previous?.maintenance || window.kind === "maintenance") });
		}
	}
	return result;
}
export function effectiveSuppression(windows: Window[], monitorId: string, now = new Date()) {
	const ids = new Set<string>(); const ends: string[] = []; let maintenance = false;
	for (const window of windows) {
		if (!window.enabled || !window.monitorIds.includes(monitorId)) continue;
		const active = currentOccurrences(window, now).filter(value => Date.parse(value.startsAt) <= now.getTime() && Date.parse(value.endsAt) > now.getTime());
		if (!active.length) continue;
		const end = active.map(value => value.endsAt).sort().at(-1)!;
		ids.add(window.id); ends.push(end);
		maintenance ||= window.kind === "maintenance";
	}
	const until = ends.sort().at(-1);
	return until ? { ids: [...ids], until, maintenance } : null;
}

export async function loadMaintenance(userId: string, dbc: DbExecutor = db) {
	return dbc.query.uptimeMaintenance.findMany({ where: and(eq(uptimeMaintenance.userId, userId), eq(uptimeMaintenance.enabled, true), or(gt(uptimeMaintenance.endsAt, new Date().toISOString()), inArray(uptimeMaintenance.recurrence, ["daily", "weekly"]))), orderBy: desc(uptimeMaintenance.createdAt) });
}

/** Existing suppression plus durable delivery for explicitly configured operating policy. */
export async function deferSuppressedAlert(monitor: typeof uptimeMonitor.$inferSelect, snapshot: DeferredAlertSnapshot, dbc: DbExecutor = db, suppressionOnly = false): Promise<boolean> {
  const bad = snapshot.statusAfter === "down" || snapshot.statusAfter === "degraded";
  // Removing a policy must not abandon an already delivered operational episode.
  const priorOperational = !suppressionOnly && snapshot.statusAfter === "up" && monitor.notificationOutageId
    ? await dbc.query.uptimeDeferredAlert.findFirst({ where: and(eq(uptimeDeferredAlert.userId, monitor.userId), eq(uptimeDeferredAlert.monitorId, monitor.uptimeMonitorId), or(eq(uptimeDeferredAlert.statusChangeId, monitor.notificationOutageId), eq(uptimeDeferredAlert.sourceOutageId, monitor.notificationOutageId))) }) : null;
  const configured = !suppressionOnly && ((monitor.monitorType === "heartbeat" || monitor.monitorType === "server") || Boolean(monitor.latencyPolicy) || Boolean(priorOperational));
  const suppression = bad ? effectiveSuppression(await loadMaintenance(monitor.userId, dbc), monitor.uptimeMonitorId) : null;
  if (!suppression && !configured) return false;
  const informational = configured && monitor.latencyPolicy?.importance === "informational";
  const cooldownUntil = configured && bad && monitor.lastOperationalAlertAt
    ? Date.parse(monitor.lastOperationalAlertAt) + (monitor.latencyPolicy?.cooldownSeconds ?? 0) * 1000 : 0;
  const due = Math.max(Date.now(), suppression ? Date.parse(suppression.until) : 0, cooldownUntil);
  await dbc.insert(uptimeDeferredAlert).values({
    userId: monitor.userId, monitorId: monitor.uptimeMonitorId, statusChangeId: snapshot.statusChangeId,
    sourceOutageId: configured ? monitor.notificationOutageId ?? (bad ? snapshot.statusChangeId : null) : null,
    policyReason: informational ? "informational" : suppression ? "maintenance" : cooldownUntil > Date.now() ? "cooldown" : null,
    state: informational ? "cancelled" : "pending",
    // Only transition facts; never request values or response bodies.
    snapshot, suppressionIds: suppression?.ids ?? [], dueAt: new Date(due).toISOString(),
  }).onConflictDoNothing({ target: uptimeDeferredAlert.statusChangeId });
  return true;
}

/** Durable per-destination delivery provenance outlives disposable check history.
 * null means an ordinary outage: preserve the pre-maintenance delivery policy.
 */
export async function recoveryDeliveryTargets(monitor: typeof uptimeMonitor.$inferSelect, before: string): Promise<string[] | null> {
	const outage = monitor.latencyPolicy ? monitor.notificationOutageId : monitor.notificationOutageId ?? (await latestOutage(monitor.userId, monitor.uptimeMonitorId, before))?.id;
	if (monitor.latencyPolicy && !outage) return [];
  if (outage) {
    const jobs = await episodeJobs(monitor.userId, monitor.uptimeMonitorId, outage);
    if (jobs.length || monitor.latencyPolicy) return [...new Set(jobs.flatMap(job => job.deliveredTargets))];
  }
	const deferred = await db.query.uptimeDeferredAlert.findFirst({
		where: and(eq(uptimeDeferredAlert.userId, monitor.userId), eq(uptimeDeferredAlert.monitorId, monitor.uptimeMonitorId), ...(outage ? [eq(uptimeDeferredAlert.statusChangeId, outage)] : [lte(uptimeDeferredAlert.createdAt, before)])),
		orderBy: desc(uptimeDeferredAlert.createdAt),
	});
	return deferred ? deferred.deliveredTargets : monitor.latencyPolicy ? [] : null;
}

/** Keep the shared technical safety bound under the owner lock. */
export async function saveMaintenance(values: typeof uptimeMaintenance.$inferInsert, limitMessage: string) {
	return db.transaction(async tx => {
		await tx.select({ id: user.id }).from(user).where(eq(user.id, values.userId)).for("update");
		// Technical abuse ceiling, identical for every account.
		if ((await loadMaintenance(values.userId, tx)).length >= 200) throw new TRPCError({ code: "BAD_REQUEST", message: limitMessage });
		const [saved] = await tx.insert(uptimeMaintenance).values(values).returning();
		return saved!;
	});
}

/** Edit a future schedule atomically; past suppression history remains immutable. */
export async function updateMaintenance(id: string, ownerId: string, config: Config, expected: Config, t: Translator) {
	return db.transaction(async tx => {
		const [existing] = await tx.select().from(uptimeMaintenance).where(and(eq(uptimeMaintenance.id, id), eq(uptimeMaintenance.userId, ownerId), eq(uptimeMaintenance.kind, "maintenance"), eq(uptimeMaintenance.enabled, true))).for("update");
		if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "maintenance" }) });
		const fields = ["name", "reason", "startsAt", "endsAt", "timezone", "recurrence"] as const;
		if (fields.some(field => existing[field] !== expected[field])) throw new TRPCError({ code: "CONFLICT", message: t("errors.maintenanceConflict") });
		if (Date.parse(existing.startsAt) <= Date.now() || Date.parse(config.startsAt) <= Date.now()) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.invalidInput") });
		const [updated] = await tx.update(uptimeMaintenance).set(config).where(and(eq(uptimeMaintenance.id, id), eq(uptimeMaintenance.userId, ownerId))).returning();
		if (existing.monitorIds.length) await tx.update(uptimeDeferredAlert).set({ dueAt: new Date().toISOString() }).where(and(eq(uptimeDeferredAlert.userId, ownerId), inArray(uptimeDeferredAlert.monitorId, existing.monitorIds), eq(uptimeDeferredAlert.state, "pending")));
		return updated!;
	});
}

/** Bounded daily cleanup; retain only current-outage delivery provenance beyond history retention. */
export async function cleanupMaintenanceHistory(retentionDays: number): Promise<void> {
	const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString();
	const windows = await db.select({ id: uptimeMaintenance.id, userId: uptimeMaintenance.userId }).from(uptimeMaintenance)
		.where(or(and(eq(uptimeMaintenance.recurrence, "once"), lt(uptimeMaintenance.endsAt, cutoff)), and(eq(uptimeMaintenance.enabled, false), lt(uptimeMaintenance.createdAt, cutoff)))).limit(500);
	for (const window of windows) await db.delete(uptimeMaintenance).where(and(eq(uptimeMaintenance.id, window.id), eq(uptimeMaintenance.userId, window.userId)));
	const rows = await db.select({ job: uptimeDeferredAlert }).from(uptimeDeferredAlert)
		.innerJoin(uptimeMonitor, and(eq(uptimeMonitor.uptimeMonitorId, uptimeDeferredAlert.monitorId), eq(uptimeMonitor.userId, uptimeDeferredAlert.userId)))
		.where(and(inArray(uptimeDeferredAlert.state, ["sent", "failed", "cancelled"]), lt(uptimeDeferredAlert.createdAt, cutoff), or(eq(uptimeDeferredAlert.historyPruned, false), isNull(uptimeMonitor.notificationOutageId), and(ne(uptimeMonitor.notificationOutageId, uptimeDeferredAlert.statusChangeId), or(isNull(uptimeDeferredAlert.sourceOutageId), ne(uptimeMonitor.notificationOutageId, uptimeDeferredAlert.sourceOutageId)))))).limit(500);
	const jobs = rows.map(row => row.job);
	for (const job of jobs) {
		const monitor = await db.query.uptimeMonitor.findFirst({ where: and(eq(uptimeMonitor.userId, job.userId), eq(uptimeMonitor.uptimeMonitorId, job.monitorId)) });
		const where = and(eq(uptimeDeferredAlert.id, job.id), eq(uptimeDeferredAlert.userId, job.userId));
		if (monitor?.notificationOutageId && (monitor.notificationOutageId === job.statusChangeId || monitor.notificationOutageId === job.sourceOutageId)) {
      const snapshot = { ...job.snapshot, reason: null, httpStatus: null, responseTime: null };
      delete snapshot.webhookBodies;
			await db.update(uptimeDeferredAlert).set({ snapshot, suppressionIds: [], historyPruned: true }).where(where);
		} else await db.delete(uptimeDeferredAlert).where(where);
	}
}

/** A configured episode has at most Degraded + Down; recovery itself is excluded. */
async function episodeJobs(userId: string, monitorId: string, outage: string) {
  const rows = await db.query.uptimeDeferredAlert.findMany({ where: and(eq(uptimeDeferredAlert.userId, userId), eq(uptimeDeferredAlert.monitorId, monitorId), or(eq(uptimeDeferredAlert.statusChangeId, outage), eq(uptimeDeferredAlert.sourceOutageId, outage))) });
  return rows.filter(row => row.snapshot.statusAfter !== "up");
}

async function latestOutage(userId: string, monitorId: string, before: string) {
	const [row] = await db.select({ id: uptimeStatusChange.statusChangeId }).from(uptimeStatusChange)
		.innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeStatusChange.uptimeMonitorId))
		.where(and(eq(uptimeMonitor.userId, userId), eq(uptimeMonitor.uptimeMonitorId, monitorId), eq(uptimeStatusChange.statusAfter, "down"), lte(uptimeStatusChange.createdAt, before)))
		.orderBy(desc(uptimeStatusChange.createdAt)).limit(1);
	return row;
}

/** Durable indexed scan, one scheduler job; expiry is computed, never an unsnooze tick. */
export async function resumeSuppressedNotifications(opts: Pick<DispatchOptions, "onResult"> = {}): Promise<void> {
	const now = new Date(); const stamp = now.toISOString();
	// The worker enumerates durable jobs, then every monitor/channel access uses
	// the recorded owner. Ordinary session queries never have this global scope.
	const jobs = await db.select({ id: uptimeDeferredAlert.id, userId: uptimeDeferredAlert.userId }).from(uptimeDeferredAlert)
		.where(and(inArray(uptimeDeferredAlert.state, ["pending", "processing"]), lte(uptimeDeferredAlert.dueAt, stamp)))
		.orderBy(uptimeDeferredAlert.dueAt).limit(25);
	for (const job of jobs) {
		const now = new Date(); const stamp = now.toISOString();
		const claimed = await db.transaction(async tx => {
			const [row] = await tx.select().from(uptimeDeferredAlert).where(and(eq(uptimeDeferredAlert.id, job.id), eq(uptimeDeferredAlert.userId, job.userId), inArray(uptimeDeferredAlert.state, ["pending", "processing"]), lte(uptimeDeferredAlert.dueAt, stamp))).for("update", { skipLocked: true });
			if (!row) return null;
			await tx.update(uptimeDeferredAlert).set({ state: "processing", dueAt: new Date(now.getTime() + 300_000).toISOString() }).where(and(eq(uptimeDeferredAlert.id, job.id), eq(uptimeDeferredAlert.userId, job.userId)));
			return row;
		});
		if (!claimed) continue;
		const where = and(eq(uptimeDeferredAlert.id, claimed.id), eq(uptimeDeferredAlert.userId, claimed.userId));
		try {
			const monitor = await db.query.uptimeMonitor.findFirst({ where: and(eq(uptimeMonitor.uptimeMonitorId, claimed.monitorId), eq(uptimeMonitor.userId, claimed.userId)) });
      const latest = await latestOutage(claimed.userId, claimed.monitorId, stamp);
      const recovery = claimed.snapshot.statusAfter === "up";
      const expectedOutage = claimed.sourceOutageId ?? (recovery ? null : claimed.statusChangeId);
      const currentOutage = monitor?.notificationOutageId ?? latest?.id;
      if (!monitor || !monitor.active || monitor.status !== claimed.snapshot.statusAfter || (recovery && !expectedOutage) || (currentOutage && currentOutage !== expectedOutage)) {
        await db.update(uptimeDeferredAlert).set({ state: "cancelled", policyReason: recovery && !expectedOutage ? "unannounced" : "superseded" }).where(where); continue;
      }
      if (monitor.latencyPolicy?.importance === "informational") {
        await db.update(uptimeDeferredAlert).set({ state: "cancelled", policyReason: "informational" }).where(where); continue;
      }
      if (recovery) {
        const sources = await episodeJobs(claimed.userId, claimed.monitorId, expectedOutage!);
        const incidentDelivery = await incidentRecoveryDelivery(monitor, claimed.snapshot.createdAt);
        // Wait for all in-flight target receipts before deciding which recoveries are allowed.
        if (sources.some(source => source.state === "processing") || incidentDelivery.processing) {
          await db.update(uptimeDeferredAlert).set({ state: "pending", dueAt: new Date(Date.now() + 15_000).toISOString() }).where(where); continue;
        }
        if (!sources.some(source => source.deliveredTargets.length) && !incidentDelivery.targets.length) {
          await db.update(uptimeDeferredAlert).set({ state: "cancelled", policyReason: "unannounced" }).where(where); continue;
        }
      }
      const suppression = recovery ? null : effectiveSuppression(await loadMaintenance(claimed.userId), monitor.uptimeMonitorId, now);
      const cooldownUntil = !recovery && monitor.latencyPolicy && monitor.lastOperationalAlertId !== claimed.statusChangeId && monitor.lastOperationalAlertAt
        ? Date.parse(monitor.lastOperationalAlertAt) + monitor.latencyPolicy.cooldownSeconds * 1000 : 0;
      if (suppression || cooldownUntil > now.getTime()) {
        await db.update(uptimeDeferredAlert).set({ state: "pending", policyReason: suppression ? "maintenance" : "cooldown",
          suppressionIds: [...new Set([...claimed.suppressionIds, ...(suppression?.ids ?? [])])],
          dueAt: new Date(Math.max(suppression ? Date.parse(suppression.until) : 0, cooldownUntil)).toISOString() }).where(where); continue;
      }
			if (claimed.attempts >= 4) {
				await db.update(uptimeDeferredAlert).set({ state: "failed" }).where(where); continue;
			}
			// Persist the attempt before network I/O: a crash after provider
			// acceptance must still consume the bounded delivery budget.
			await db.update(uptimeDeferredAlert).set({ attempts: claimed.attempts + 1 }).where(where);
			let retryable = false;
			let suppressed = false;
			await dispatchNotifications(monitor, claimed.snapshot, {
				delaysMs: [], resumeSuppressed: true, deduplicate: true, strictAudit: true,
				finishedTargets: claimed.finishedTargets, deferredAlertId: claimed.id, sourceOutageId: expectedOutage!,
				onSuppressed: () => { suppressed = true; },
				onResult: async result => { if (result.retryable) retryable = true; await opts.onResult?.(result); },
			});
			const final = await db.query.uptimeDeferredAlert.findFirst({ where });
      const current = await db.query.uptimeMonitor.findFirst({ where: and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, claimed.userId)) });
      if (!current || !current.active || current.status !== claimed.snapshot.statusAfter || current.notificationOutageId && current.notificationOutageId !== expectedOutage || current.latencyPolicy?.importance === "informational") {
        await db.update(uptimeDeferredAlert).set({ state: "cancelled", policyReason: current?.latencyPolicy?.importance === "informational" ? "informational" : "superseded" }).where(where); continue;
      }
			const suppressionNow = recovery ? null : effectiveSuppression(await loadMaintenance(claimed.userId), monitor.uptimeMonitorId);
			if (suppressed || (retryable && suppressionNow)) {
				await db.update(uptimeDeferredAlert).set({ state: "pending", suppressionIds: [...new Set([...claimed.suppressionIds, ...(suppressionNow?.ids ?? [])])], dueAt: suppressionNow?.until ?? new Date().toISOString() }).where(where);
				continue;
			}
			const failed = final!.finishedTargets.some(key => !final!.deliveredTargets.includes(key));
			const attempts = claimed.attempts + 1;
			await db.update(uptimeDeferredAlert).set({ state: retryable ? (attempts >= 4 ? "failed" : "pending") : failed ? "failed" : final!.deliveredTargets.length ? "sent" : "cancelled", dueAt: new Date(Date.now() + [30_000, 120_000, 600_000, 600_000][Math.min(attempts - 1, 3)]!).toISOString() }).where(where);
		} catch {
			// A failed DB/send attempt keeps its lease and is retried after restart.
			// Log IDs only; provider errors may contain credential-bearing URLs.
			console.error(`[uptime] Deferred alert ${claimed.id} could not finish`);
		}
	}
}

let runningMaintenanceScan: Promise<void> | undefined;
export function startMaintenanceWorker(): void {
  scheduledJobs["uptime-maintenance-resume"]?.cancel();
  const tick = () => {
    if (runningMaintenanceScan) return runningMaintenanceScan;
    runningMaintenanceScan = resumeSuppressedNotifications()
      .catch(() => { console.error("[uptime] Maintenance scan failed"); })
      .finally(() => { runningMaintenanceScan = undefined; });
    return runningMaintenanceScan;
  };
  scheduleJob("uptime-maintenance-resume", "*/15 * * * * *", tick);
  void tick();
}

/** Drain committed delivery work before relinquishing scheduler leadership. */
export async function stopMaintenanceWorker(): Promise<void> {
  scheduledJobs["uptime-maintenance-resume"]?.cancel();
  await runningMaintenanceScan;
}
