import { DEFAULT_FAILURE_THRESHOLD } from "@pulsy/db/monitor-defaults";
import { createHash, randomBytes } from "node:crypto";
import { db, user, apiHeartbeatConfiguration, apiHeartbeatReceipt, uptimeMonitor, uptimeHeartbeat, uptimeHeartbeatRun, uptimeCheckLog, uptimeIncident, uptimeStatusChange, type DbExecutor, type DbTransaction } from "@pulsy/db";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { scheduledJobs, scheduleJob } from "node-schedule";
import type { Translator } from "../../lib/i18n";
import { heartbeatDeadline } from "./heartbeat-clock";
import type { z } from "zod";
import { dispatchNotifications } from "./notification-service";
import { safeErrorSummary } from "../../lib/safe-error";
import { encrypt, decrypt } from "../../lib/crypto";

type Monitor = typeof uptimeMonitor.$inferSelect;
type Heartbeat = typeof uptimeHeartbeat.$inferSelect;
type ReceiptResult = { statusCode: 200 | 400 | 404 | 409 | 429; outcome: "accepted" | "duplicate" | "ignored" | "invalid" | "unavailable" | "conflict" | "limited"; runId?: string };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const scopeMonitor = (id: string, userId: string) => and(eq(uptimeMonitor.uptimeMonitorId, id), eq(uptimeMonitor.userId, userId));
const scopeHeartbeat = (id: string, userId: string) => and(eq(uptimeHeartbeat.monitorId, id), eq(uptimeHeartbeat.userId, userId));
const scopeRuns = (id: string, userId: string) => and(eq(uptimeHeartbeatRun.monitorId, id), eq(uptimeHeartbeatRun.userId, userId));

export async function createHeartbeatForUser(input: z.output<typeof apiHeartbeatConfiguration>, userId: string, t: Translator, now = new Date()) {
  const configuration = apiHeartbeatConfiguration.parse(input);
  const token = newToken(); const expectedAt = new Date(now.getTime() + configuration.interval * 1000).toISOString();
  const monitor = await db.transaction(async tx => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
    const [monitor] = await tx.insert(uptimeMonitor).values({ name: configuration.name, monitorType: "heartbeat", url: "", interval: configuration.interval, active: configuration.active, tags: configuration.tags, failureThreshold: DEFAULT_FAILURE_THRESHOLD, userId, createdAt: now.toISOString(), nextCheckAt: configuration.active ? expectedAt : null }).returning();
    if (!monitor) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: t("errors.internal") });
    await tx.insert(uptimeHeartbeat).values({ monitorId: monitor.uptimeMonitorId, userId, tokenHash: hash(token), tokenCipher: encrypt(token), graceSeconds: configuration.graceSeconds, expectedAt, nextDeadline: expectedAt });
    return monitor;
  });
  return { monitor, token };
}

/**
 * A paused heartbeat keeps its old deadline (the scan skips inactive monitors), so
 * resuming it would be judged against that stale deadline and go Down at once.
 * Start a fresh interval on an inactive -> active transition only; re-saving an
 * already-active monitor must never push a real missed deadline forward. A Down
 * heartbeat has no deadline (nextDeadline NULL) and stays that way until a receipt.
 */
export async function rearmResumedHeartbeat(
  executor: DbExecutor,
  before: Pick<Monitor, "uptimeMonitorId" | "userId" | "monitorType" | "active">,
  after: Pick<Monitor, "active" | "interval">,
  now = new Date(),
): Promise<string | undefined> {
  if (before.monitorType !== "heartbeat" || before.active || !after.active) return;
  const expectedAt = new Date(now.getTime() + after.interval * 1000).toISOString();
  const rearmed = await executor.update(uptimeHeartbeat).set({ expectedAt, nextDeadline: expectedAt })
    .where(and(scopeHeartbeat(before.uptimeMonitorId, before.userId), isNotNull(uptimeHeartbeat.nextDeadline))).returning({ id: uptimeHeartbeat.monitorId });
  if (rearmed.length) {
    await executor.update(uptimeMonitor).set({ nextCheckAt: expectedAt }).where(scopeMonitor(before.uptimeMonitorId, before.userId));
    return expectedAt;
  }
}

/** Explicit projection: token hashes and admission counters never leave storage. */
export async function readHeartbeatForUser(monitorId: string, userId: string, t: Translator) {
  const [row] = await db.select({ monitorId: uptimeHeartbeat.monitorId, graceSeconds: uptimeHeartbeat.graceSeconds, expectedAt: uptimeHeartbeat.expectedAt, nextDeadline: uptimeHeartbeat.nextDeadline, lastReceivedAt: uptimeHeartbeat.lastReceivedAt, lastSuccessAt: uptimeHeartbeat.lastSuccessAt, lastFailAt: uptimeHeartbeat.lastFailAt, currentRunId: uptimeHeartbeat.currentRunId, lastRunDurationMs: uptimeHeartbeat.lastRunDurationMs, interval: uptimeMonitor.interval })
    .from(uptimeHeartbeat).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeHeartbeat.monitorId))
    .where(and(scopeHeartbeat(monitorId, userId), scopeMonitor(monitorId, userId), eq(uptimeMonitor.monitorType, "heartbeat"))).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });
  return row;
}

export async function rotateHeartbeatToken(monitorId: string, userId: string, t: Translator) {
  const token = newToken();
  await db.transaction(async tx => {
    // All mutation paths lock parent then heartbeat, including delete/rotation.
    const [monitor] = await tx.select({ id: uptimeMonitor.uptimeMonitorId }).from(uptimeMonitor).where(and(scopeMonitor(monitorId, userId), eq(uptimeMonitor.monitorType, "heartbeat"))).for("update");
    if (!monitor) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });
    const [updated] = await tx.update(uptimeHeartbeat).set({ tokenHash: hash(token), tokenCipher: encrypt(token) }).where(scopeHeartbeat(monitorId, userId)).returning({ id: uptimeHeartbeat.monitorId });
    if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });
  });
  return { token };
}

/** Explicit owner action only: never include credentials in polling projections. */
export async function revealHeartbeatToken(monitorId: string, userId: string, t: Translator) {
  const [row] = await db.select({ cipher: uptimeHeartbeat.tokenCipher })
    .from(uptimeHeartbeat).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeHeartbeat.monitorId))
    .where(and(scopeHeartbeat(monitorId, userId), scopeMonitor(monitorId, userId), eq(uptimeMonitor.monitorType, "heartbeat"))).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });
  return { token: row.cipher ? decrypt(row.cipher) : null };
}

/**
 * One heartbeat timeline: `expectedAt` (ping due) → Late; `graceEndsAt`
 * (`expectedAt + grace`) → Down and the incident's `startedAt`. A transition's
 * status change, history sample, incident and alert all carry the boundary time,
 * never the scan time; `lastCheckedAt` alone records when it was evaluated.
 */
async function recordHealth(tx: DbTransaction, monitor: Monitor, configuration: Heartbeat, status: "up" | "down" | "degraded", reason: string | null, now: Date, transitionAt = now, expectedAt: string | null = null) {
  const stamp = now.toISOString();
  const transitionStamp = transitionAt.toISOString(); const changed = monitor.status !== status;
  const sampleStamp = changed ? transitionStamp : stamp;
  // Bound history to one receipt sample per interval plus real transitions.
  const sample = changed || !configuration.lastSampleAt || now.getTime() - Date.parse(configuration.lastSampleAt) >= monitor.interval * 1000;
  await tx.update(uptimeMonitor).set({ status, lastCheckedAt: stamp, nextCheckAt: monitor.active ? configuration.nextDeadline : null, responseTime: null, httpStatus: null, consecutiveFailures: status === "down" ? 1 : 0 }).where(scopeMonitor(monitor.uptimeMonitorId, monitor.userId));
  if (sample) {
    await tx.insert(uptimeCheckLog).values({ uptimeMonitorId: monitor.uptimeMonitorId, status, errorMessage: reason, createdAt: sampleStamp, responseTime: null, httpStatus: null });
    await tx.update(uptimeHeartbeat).set({ lastSampleAt: sampleStamp }).where(scopeHeartbeat(monitor.uptimeMonitorId, monitor.userId));
  }
  if (!changed) return;
  const [transition] = await tx.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: monitor.status, statusAfter: status, reason, createdAt: transitionStamp }).returning();
  if (!transition) throw new Error("Heartbeat transition failed");
  const bad = status === "down" || status === "degraded";
  const outageId = bad ? (monitor.status === "down" || monitor.status === "degraded") && monitor.notificationOutageId ? monitor.notificationOutageId : transition.statusChangeId : monitor.notificationOutageId;
  await tx.update(uptimeMonitor).set({ notificationOutageId: outageId }).where(scopeMonitor(monitor.uptimeMonitorId, monitor.userId));
  const [ongoing] = await tx.select({ incident: uptimeIncident }).from(uptimeIncident).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeIncident.uptimeMonitorId))
    .where(and(scopeMonitor(monitor.uptimeMonitorId, monitor.userId), eq(uptimeIncident.status, "ongoing"))).limit(1);
  if (status === "down" && !ongoing) await tx.insert(uptimeIncident).values({ uptimeMonitorId: monitor.uptimeMonitorId, cause: reason, startedAt: transitionStamp, expectedAt, severity: monitor.latencyPolicy?.importance ?? "critical" });
  if (!bad && ongoing) await tx.update(uptimeIncident).set({ status: "resolved", resolvedAt: stamp, durationSeconds: Math.max(0, Math.round((now.getTime() - Date.parse(ongoing.incident.startedAt)) / 1000)) }).where(and(eq(uptimeIncident.incidentId, ongoing.incident.incidentId), eq(uptimeIncident.uptimeMonitorId, monitor.uptimeMonitorId)));
  // A first success has no outage to recover. Pausing never emits recovery.
  if (monitor.active && (bad || outageId)) return { monitor: { ...monitor, status, notificationOutageId: outageId }, transition };
}

/** Dispatch only committed transitions; maintenance delivery joins this path in Phase 7. */
function dispatchHeartbeat(delivery: Awaited<ReturnType<typeof recordHealth>>): void {
  if (!delivery) return;
  void dispatchNotifications(delivery.monitor, delivery.transition).catch(error => {
    console.error(`[uptime] Heartbeat notification failed: ${safeErrorSummary(error)}`);
  });
}

/** Token capability lookup is followed by fresh owner-scoped locks and hash recheck. */
export async function receiveHeartbeat(token: string, event: "start" | "success" | "fail", payload: unknown, now = new Date()): Promise<ReceiptResult> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { statusCode: 404, outcome: "unavailable" };
  const parsed = apiHeartbeatReceipt.safeParse(payload);
  if (!parsed.success || [parsed.data.runId, ...Object.values(parsed.data.metadata ?? {})].some(value => value?.includes(token))) return { statusCode: 400, outcome: "invalid" };
  const input = parsed.data; const tokenHash = hash(token);
  const [target] = await db.select({ monitorId: uptimeHeartbeat.monitorId, userId: uptimeHeartbeat.userId }).from(uptimeHeartbeat).where(eq(uptimeHeartbeat.tokenHash, tokenHash)).limit(1);
  if (!target) return { statusCode: 404, outcome: "unavailable" };
  let delivery: Awaited<ReturnType<typeof recordHealth>>;
  const result = await db.transaction<ReceiptResult>(async tx => {
    const [monitor] = await tx.select().from(uptimeMonitor).where(and(scopeMonitor(target.monitorId, target.userId), eq(uptimeMonitor.monitorType, "heartbeat"))).for("update");
    if (!monitor) return { statusCode: 404, outcome: "unavailable" };
    const [configuration] = await tx.select().from(uptimeHeartbeat).where(and(scopeHeartbeat(target.monitorId, target.userId), eq(uptimeHeartbeat.tokenHash, tokenHash))).for("update");
    if (!configuration) return { statusCode: 404, outcome: "unavailable" };
    // Entry timestamps can arrive at this lock out of order. An older receipt
    // cannot undo a newer receipt or deadline evaluation, or resolve its incident.
    if ([configuration.lastReceivedAt, monitor.lastCheckedAt].some(value => value !== null && Date.parse(value) > now.getTime())) {
      return { statusCode: 200, outcome: "ignored" };
    }
    // A uniform technical ceiling, independent of the monitor cadence.
    // Duplicate receipts count toward admission without changing measured state.
    // Their newer window must never be reset by an overtaken entry timestamp.
    const admissionAt = Math.max(now.getTime(), configuration.rateWindowAt ? Date.parse(configuration.rateWindowAt) : now.getTime());
    const reset = !configuration.rateWindowAt || admissionAt - Date.parse(configuration.rateWindowAt) >= 60_000;
    if (!reset && configuration.rateCount >= 120) return { statusCode: 429, outcome: "limited" };
    const stamp = now.toISOString();
    await tx.update(uptimeHeartbeat).set({ rateWindowAt: reset ? new Date(admissionAt).toISOString() : configuration.rateWindowAt, rateCount: reset ? 1 : configuration.rateCount + 1 }).where(scopeHeartbeat(target.monitorId, target.userId));
    const runId = input.runId ?? (event === "start" ? nanoid() : configuration.currentRunId);
    const [run] = runId ? await tx.select().from(uptimeHeartbeatRun).where(and(scopeRuns(target.monitorId, target.userId), eq(uptimeHeartbeatRun.runId, runId))).limit(1) : [];
    if (event === "start") {
      if (run) return { statusCode: 200, outcome: "duplicate", runId: run.runId };
      if (configuration.currentRunId) await tx.update(uptimeHeartbeatRun).set({ outcome: "superseded", finishedAt: stamp }).where(and(scopeRuns(target.monitorId, target.userId), eq(uptimeHeartbeatRun.runId, configuration.currentRunId), eq(uptimeHeartbeatRun.outcome, "running")));
      let count = configuration.runCount;
      // Retain the last 1,000 run IDs; a pruned ID needs a fresh start.
      if (count >= 1000) {
        const old = await tx.select({ id: uptimeHeartbeatRun.id }).from(uptimeHeartbeatRun).where(scopeRuns(target.monitorId, target.userId)).orderBy(asc(uptimeHeartbeatRun.startedAt), asc(uptimeHeartbeatRun.id)).limit(100);
        if (old.length) await tx.delete(uptimeHeartbeatRun).where(and(scopeRuns(target.monitorId, target.userId), inArray(uptimeHeartbeatRun.id, old.map(row => row.id))));
        count -= old.length;
      }
      await tx.insert(uptimeHeartbeatRun).values({ userId: target.userId, monitorId: target.monitorId, runId: runId!, startedAt: stamp, outcome: "running", metadata: input.metadata });
      await tx.update(uptimeHeartbeat).set({ currentRunId: runId, runCount: count + 1, lastReceivedAt: stamp }).where(scopeHeartbeat(target.monitorId, target.userId));
      return { statusCode: 200, outcome: "accepted", runId: runId! };
    }
    if (input.runId && !run) return { statusCode: 409, outcome: "conflict" };
    if (run && run.outcome === "superseded") return { statusCode: 200, outcome: "ignored" };
    if (run && run.outcome !== "running") return { statusCode: 200, outcome: "duplicate" };
    if (run && configuration.currentRunId !== run.runId) return { statusCode: 200, outcome: "ignored" };
    if (run) await tx.update(uptimeHeartbeatRun).set({ outcome: event, finishedAt: stamp }).where(and(scopeRuns(target.monitorId, target.userId), eq(uptimeHeartbeatRun.id, run.id)));
    const duration = run ? Math.max(0, now.getTime() - Date.parse(run.startedAt)) : configuration.lastRunDurationMs;
    const expectedAt = event === "success" ? new Date(now.getTime() + monitor.interval * 1000).toISOString() : configuration.expectedAt;
    const nextDeadline = event === "success" ? expectedAt : null;
    const updated = { ...configuration, currentRunId: null, expectedAt, nextDeadline, lastReceivedAt: stamp, lastRunDurationMs: duration, ...(event === "success" ? { lastSuccessAt: stamp } : { lastFailAt: stamp }) };
    await tx.update(uptimeHeartbeat).set({ currentRunId: null, expectedAt, nextDeadline, lastReceivedAt: stamp, lastRunDurationMs: duration, ...(event === "success" ? { lastSuccessAt: stamp } : { lastFailAt: stamp }) }).where(scopeHeartbeat(target.monitorId, target.userId));
    delivery = await recordHealth(tx, monitor, updated, event === "success" ? "up" : "down", event === "fail" ? "heartbeat_failed" : null, now);
    return { statusCode: 200, outcome: "accepted" };
  });
  dispatchHeartbeat(delivery);
  return result;
}

/** Evaluations run at the configured cadence and at each deadline, even after Down.
 * Pending before the first deadline has no health sample. Missed deadlines are
 * observed failures, including after restart; a real success alone recovers them.
 */
export async function scanHeartbeatDeadlines(now = new Date()): Promise<number> {
  // Global worker enumeration only; each mutation rechecks the recorded owner.
  // Bound each five-second scan to 50 owned, locked evaluations.
  const candidates = await db.select({ monitorId: uptimeHeartbeat.monitorId, userId: uptimeHeartbeat.userId }).from(uptimeHeartbeat)
    .innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeHeartbeat.monitorId))
    .where(and(eq(uptimeMonitor.userId, uptimeHeartbeat.userId), eq(uptimeMonitor.active, true), eq(uptimeMonitor.monitorType, "heartbeat"), or(
      lte(uptimeHeartbeat.nextDeadline, now.toISOString()),
      isNull(uptimeMonitor.lastCheckedAt),
      sql`${uptimeMonitor.lastCheckedAt}::timestamptz <= ${now.toISOString()}::timestamptz - ${uptimeMonitor.interval} * interval '1 second'`,
    )))
    .orderBy(sql`${uptimeMonitor.lastCheckedAt} ASC NULLS FIRST`, asc(uptimeHeartbeat.monitorId)).limit(50);
  let processed = 0;
  for (const target of candidates) {
    let delivery: Awaited<ReturnType<typeof recordHealth>>;
    const result = await db.transaction(async tx => {
      const [monitor] = await tx.select().from(uptimeMonitor).where(and(scopeMonitor(target.monitorId, target.userId), eq(uptimeMonitor.active, true), eq(uptimeMonitor.monitorType, "heartbeat"))).for("update", { skipLocked: true });
      if (!monitor) return false;
      const [configuration] = await tx.select().from(uptimeHeartbeat).where(scopeHeartbeat(target.monitorId, target.userId)).for("update");
      if (!configuration) return false;
      const due = configuration.nextDeadline !== null && Date.parse(configuration.nextDeadline) <= now.getTime();
      // A concurrent receipt/scan may have refreshed this row since enumeration.
      if (!due && monitor.lastCheckedAt && now.getTime() - Date.parse(monitor.lastCheckedAt) < monitor.interval * 1000) return false;
      const deadline = heartbeatDeadline({ expectedAt: Date.parse(configuration.expectedAt), graceSeconds: configuration.graceSeconds, receivedSuccess: !!configuration.lastSuccessAt, now: now.getTime() });
      // A settings edit/resume can move a deadline without receiving a ping.
      // Preserve the failing state until receiveHeartbeat records real success.
      const status = configuration.nextDeadline === null || monitor.status === "down" ? "down"
        : monitor.status === "degraded" && (deadline.status === "up" || deadline.status === "pending") ? "degraded"
        : deadline.status;
      if (status === "pending") {
        await tx.update(uptimeMonitor).set({ lastCheckedAt: now.toISOString() }).where(scopeMonitor(target.monitorId, target.userId));
        return false;
      }
      const nextDeadline = status === "down" || deadline.nextDeadline === null ? null : new Date(deadline.nextDeadline).toISOString();
      await tx.update(uptimeHeartbeat).set({ nextDeadline }).where(scopeHeartbeat(target.monitorId, target.userId));
      const reason = configuration.nextDeadline === null ? null : configuration.currentRunId && status === "down" ? "heartbeat_unfinished" : deadline.reason;
      // Deadline transitions describe the known schedule; lastCheckedAt remains the actual evaluation time.
      // Late starts at expectedAt; Down (and the incident) at graceEndsAt = expectedAt + grace.
      const expectedAt = Date.parse(configuration.expectedAt), graceEndsAt = expectedAt + configuration.graceSeconds * 1000;
      const deadlineTransition = due && monitor.status !== status && (status === "down" || status === "degraded");
      const transitionAt = deadlineTransition ? new Date(status === "down" ? graceEndsAt : expectedAt) : now;
      delivery = await recordHealth(tx, monitor, { ...configuration, nextDeadline }, status, reason, now, transitionAt, deadlineTransition && status === "down" ? configuration.expectedAt : null);
      return true;
    });
    if (result) processed++;
    dispatchHeartbeat(delivery);
  }
  return processed;
}

let runningScan: Promise<void> | undefined;
export function startHeartbeatWorker() {
  scheduledJobs["uptime-heartbeat-deadlines"]?.cancel();
  const scan = () => {
    if (runningScan) return runningScan;
    runningScan = scanHeartbeatDeadlines().then(() => undefined).catch(() => {
      console.error("[uptime] Heartbeat deadline scan failed");
    }).finally(() => { runningScan = undefined; });
    return runningScan;
  };
  // Restart evaluates persisted deadlines without postponing the outage.
  void scan();
  return scheduleJob("uptime-heartbeat-deadlines", "*/5 * * * * *", scan);
}

export async function stopHeartbeatWorker(): Promise<void> {
  scheduledJobs["uptime-heartbeat-deadlines"]?.cancel();
  await runningScan;
}

export async function listHeartbeatRuns(monitorId: string, userId: string, t: Translator, limit = 50) {
  await readHeartbeatForUser(monitorId, userId, t);
  return db.select({ id: uptimeHeartbeatRun.id, runId: uptimeHeartbeatRun.runId, startedAt: uptimeHeartbeatRun.startedAt, finishedAt: uptimeHeartbeatRun.finishedAt, outcome: uptimeHeartbeatRun.outcome, metadata: uptimeHeartbeatRun.metadata }).from(uptimeHeartbeatRun).where(scopeRuns(monitorId, userId)).orderBy(desc(uptimeHeartbeatRun.startedAt), desc(uptimeHeartbeatRun.id)).limit(limit);
}
