import { insertObservedCheck } from "./reliability-storage";
import { appendIncidentTransition } from "./incident-timeline";
import { deferSuppressedAlert } from "./maintenance-service";
import { acceptsProbeResult } from "./probe-configuration";
import { canonicalMonitorUrl, normalizeMonitorUrl } from "@pulsy/db/monitor-url";
// Shared owned monitor writes and manual checks. Callers schedule after commit.

import {
	type apiCreateUptimeMonitor,
	db, user, uptimeNotificationChannel, type DbExecutor,
	uptimeMonitor,
  uptimeMonitorChannelBinding,
	uptimeStatusChange,
} from "@pulsy/db";
import type { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";

import type { Translator } from "../../lib/i18n";
import { getTranslator } from "../../lib/i18n";
import { withManualActionLimit } from "../../lib/manual-limit";
import { TRPCError } from "@trpc/server";

import { httpConfigPatch } from "./http-config";
import { performMonitorProbe } from "./monitor-probe";
import { withMonitorCheckSlot } from "./scheduler-service";
import {
	createIncident,
	getOngoingIncident,
	resolveIncident,
} from "./incident-service";
import type { UptimeMonitor } from "./monitor-service";
import { dispatchNotifications } from "./notification-service";
import { evaluateLatencyTransition } from "./latency-policy";
import { safeErrorSummary } from "../../lib/safe-error";
import { assertMonitorUrlAllowed } from "./egress-input";
import { firstCheckAt } from "./first-check";

/** Validate referenced channels inside the same owned write transaction. */
export { assertOwnedChannelReferences as assertOwnedMonitorChannels } from "./channel-bindings";
import { assertOwnedChannelReferences as assertOwnedMonitorChannels } from "./channel-bindings";

/** Owner lock serializes creation without imposing a monitor count limit. */
export async function createMonitorForUser(
	input: z.output<typeof apiCreateUptimeMonitor>,
	userId: string,
	t: Translator = getTranslator("en"),
): Promise<UptimeMonitor> {
	const [inserted] = await createMonitorsForUser([input], userId, t);
	if (!inserted) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: t("errors.internal") });
	return inserted;
}

/** Single, bulk, shared clone, template and import creation share this lock. */
export async function createMonitorsForUser(
	inputs: Array<z.output<typeof apiCreateUptimeMonitor>>,
	userId: string,
	t: Translator,
	targetField: string | null = "url",
): Promise<UptimeMonitor[]> {
  // The policy sees the URL as typed, so non-canonical IP encodings are
  // rejected before normalisation rewrites them.
  for (const input of inputs) await assertMonitorUrlAllowed(input.url, t, targetField);
  inputs = inputs.map(input => {
    const url = normalizeMonitorUrl(input.url);
    if (!url) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.httpDestination") });
    return { ...input, url, name: input.name.trim() || new URL(url).hostname };
  });
	const configuration = inputs.map(input => httpConfigPatch(input, input.method, t));
	return db.transaction(async tx => {
  await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
	for (const input of inputs) await assertOwnedMonitorChannels(tx, userId, input.channelIds ?? [], t);
  const existing = await tx.select({ url: uptimeMonitor.url, name: uptimeMonitor.name }).from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, userId), eq(uptimeMonitor.monitorType, "http")));
  const seen = new Map(existing.map(monitor => [canonicalMonitorUrl(monitor.url), monitor.name]));
  for (const input of inputs) {
    const key = canonicalMonitorUrl(input.url);
    if (seen.has(key)) throw new TRPCError({ code: "CONFLICT", message: t("errors.monitorDuplicate", { name: seen.get(key)! }) });
    seen.set(key, input.name);
  }
  const inserted = await tx
		.insert(uptimeMonitor)
		.values(inputs.map((input, index) => ({
			...configuration[index],
			name: input.name,
			url: input.url,
			method: input.method,
			expectedStatus: input.expectedStatus,
      expectedStatuses: input.expectedStatuses ?? null,
      tlsMonitoringEnabled: input.tlsMonitoringEnabled ?? true,
			timeout: input.timeout,
			interval: input.interval,
			failureThreshold: input.failureThreshold,
			active: input.active,
			tags: input.tags,
      latencyPolicy: input.latencyPolicy ?? null,
			status: "pending" as const,
			consecutiveFailures: 0,
			nextCheckAt: input.active ? firstCheckAt(inputs.length) : null,
			userId,
		})))
		.returning();
  for (const [index, monitor] of inserted.entries()) {
    const ids = inputs[index]?.channelIds ?? [];
    if (ids.length) await tx.insert(uptimeMonitorChannelBinding).values(ids.map(channelId => ({ userId, monitorId: monitor.uptimeMonitorId, channelId })));
  }
  return inserted;
	});
}

/**
 * Run a check immediately: HTTP probe → check log → monitor-state update →
 * status-change record → incident open/resolve → notification dispatch.
 * The caller must have verified ownership and that the monitor is active.
 * Returns the updated monitor row.
 */
export async function runManualCheck(
	monitor: UptimeMonitor,
	t: Translator = getTranslator("en"),
): Promise<UptimeMonitor> {
	if (monitor.monitorType === "heartbeat" || monitor.monitorType === "server") throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.monitorTypeAction") });
	let checkResult: Awaited<ReturnType<typeof performMonitorProbe>>;
  try {
    // Every probe type shares scheduled capacity, and one account can only have a few in flight.
    checkResult = await withManualActionLimit(monitor.userId, t, () => withMonitorCheckSlot(() => performMonitorProbe(monitor), monitor.timeout));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPROBEBUSY") throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: t("errors.networkBusy") });
    throw error;
  }
	let transition = evaluateLatencyTransition({
		previousStatus: monitor.status,
		checkStatus: checkResult.status,
		consecutiveFailures: monitor.consecutiveFailures,
		failureThreshold: monitor.failureThreshold,
    responseTime: checkResult.responseTime, policy: monitor.latencyPolicy,
    consecutiveSlow: monitor.consecutiveSlow, consecutiveHealthy: monitor.consecutiveHealthy,
	});

	let previousStatus = monitor.status;
  let policyMonitor = monitor;
  let notificationQueued = false;

	// Same atomicity contract as the scheduler's runCheck: all state writes for
	// this check commit or roll back together; dispatch happens after commit.
	const { updated, statusChangeRecord } = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, monitor.userId))).for("update");
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });
    if (!acceptsProbeResult(current, monitor)) return { updated: current, statusChangeRecord: null };
    policyMonitor = current;
	const now = new Date().toISOString();
	// A caller may hold a snapshot whose last observation is scheduled in the
	// future; do not let that stale request rewind the committed state. Recent
	// observations from concurrent checks are still serialized and retained.
	if (current.lastCheckedAt && Date.parse(current.lastCheckedAt) > Date.now()) return { updated: current, statusChangeRecord: null };
    // Completion time is assigned after the probe, never when queued. Serialize
    // against the latest committed observation, including legacy monitors.
    // An older completion waiting for this lock must not rewind state/history.
    previousStatus = current.status;
    transition = evaluateLatencyTransition({ previousStatus, checkStatus: checkResult.status, responseTime: checkResult.responseTime,
      consecutiveFailures: current.consecutiveFailures, failureThreshold: current.failureThreshold,
      consecutiveSlow: current.consecutiveSlow, consecutiveHealthy: current.consecutiveHealthy, policy: current.latencyPolicy });
		await insertObservedCheck(tx, policyMonitor, {
			httpStatus: checkResult.httpStatus,
			responseTime: checkResult.responseTime,
			status: transition.sampleStatus,
			errorMessage: checkResult.errorMessage ?? transition.latencyReason ?? null,
			assertionOutcomes: checkResult.assertionOutcomes ?? null,
			createdAt: now,
		});

		// The locked row owns status, timing and completion time as one snapshot.
		const [updatedRow] = await tx
			.update(uptimeMonitor)
			.set({
				status: transition.monitorStatus,
				httpStatus: checkResult.httpStatus,
				responseTime: checkResult.responseTime,
				lastCheckedAt: now,
				nextCheckAt: new Date(
					Date.now() + policyMonitor.interval * 1000,
				).toISOString(),
				consecutiveFailures: transition.consecutiveFailures,
        consecutiveSlow: transition.consecutiveSlow, consecutiveHealthy: transition.consecutiveHealthy,
			})
			.where(
				and(
					eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId),
					eq(uptimeMonitor.userId, monitor.userId),
					eq(uptimeMonitor.status, previousStatus),
				),
			)
			.returning();

		if (!updatedRow) {
			const fresh = await tx.query.uptimeMonitor.findFirst({
				where: and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, monitor.userId)),
			});
			/* v8 ignore next 3 -- unreachable: the monitor row cannot vanish mid-tx */
			if (!fresh) {
				throw new Error("Failed to update uptime monitor");
			}
			console.warn(
				`[uptime] Skipping transition for monitor ${monitor.uptimeMonitorId}: status changed concurrently`,
			);
			return { updated: fresh, statusChangeRecord: null };
		}

		if (!transition.shouldRecordStatusChange) {
			return { updated: updatedRow, statusChangeRecord: null };
		}

		const [record] = await tx
			.insert(uptimeStatusChange)
			.values({
				uptimeMonitorId: monitor.uptimeMonitorId,
				statusBefore: previousStatus,
				statusAfter: transition.statusAfter,
				httpStatus: checkResult.httpStatus,
				responseTime: checkResult.responseTime,
				reason: checkResult.errorMessage ?? transition.latencyReason ?? null,
				createdAt: now,
			})
			.returning();

		if (record?.statusAfter === "down" || policyMonitor.latencyPolicy && record?.statusAfter === "degraded") {
      // One configured failure episode may escalate Degraded → Down before recovery.
      const outageId = policyMonitor.latencyPolicy && (previousStatus === "down" || previousStatus === "degraded") && policyMonitor.notificationOutageId ? policyMonitor.notificationOutageId : record.statusChangeId;
			await tx.update(uptimeMonitor).set({ notificationOutageId: outageId }).where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, monitor.userId)));
			policyMonitor = { ...policyMonitor, notificationOutageId: outageId };
      notificationQueued = await deferSuppressedAlert(policyMonitor, record, tx);

    } else if (record?.statusAfter === "degraded" && !policyMonitor.latencyPolicy && (previousStatus === "up" || previousStatus === "pending")) {
      // A fresh legacy degraded episode must not inherit a recovered episode's receipts.
      await tx.update(uptimeMonitor).set({ notificationOutageId: null }).where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, monitor.userId)));
      policyMonitor = { ...policyMonitor, notificationOutageId: null };
		} else if (record?.statusAfter === "up") {
      notificationQueued = await deferSuppressedAlert(policyMonitor, record, tx);
    }

		if (transition.shouldCreateIncident) {
			const ongoing = await getOngoingIncident(monitor.uptimeMonitorId, tx);
			if (!ongoing) {
				await createIncident(
					monitor.uptimeMonitorId,
					checkResult.errorMessage ?? transition.latencyReason,
					tx,
          policyMonitor.latencyPolicy?.importance ?? "critical",
          now,
				);
			}
		}

		if (transition.shouldResolveIncident) {
			await resolveIncident(monitor.uptimeMonitorId, tx, now);
		}

    if (record) await appendIncidentTransition(policyMonitor, record, tx);
		return { updated: updatedRow, statusChangeRecord: record ?? null };
	});

	// Detached: retry backoff (up to ~12.5 min) must not block the checkNow
	// tRPC request. In-flight retries are lost on restart (accepted).
	if (statusChangeRecord && !notificationQueued) {
		void dispatchNotifications(policyMonitor, statusChangeRecord).catch((err) => {
			console.error(
				`[uptime] Failed to dispatch notifications for monitor ${monitor.uptimeMonitorId}: ${safeErrorSummary(err)}`,
			);
		});
	}

	return updated;
}
