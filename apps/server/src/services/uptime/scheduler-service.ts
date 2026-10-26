import {
	db,
	uptimeMonitor,
	uptimeCheckLog,
	uptimeStatusChange,
} from "@pulsy/db";
import {
	scheduledJobs,
	scheduleJob,
	gracefulShutdown as cancelAllJobs,
} from "node-schedule";
import { and, eq } from "drizzle-orm";
import { safeErrorSummary } from "../../lib/safe-error";
import { performMonitorProbe } from "./monitor-probe";
import { FIRST_CHECK_JITTER_MS } from "./first-check";
import { checkTlsCertificate } from "./tls-checker-service";
import { createIncident, resolveIncident, getOngoingIncident } from "./incident-service";
import { evaluateLatencyTransition } from "./latency-policy";
import {
	dispatchNotifications,
	dispatchTlsExpiryNotifications,
} from "./notification-service";
import type { UptimeMonitor } from "./monitor-service";

const TLS_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const lastTlsCheckMap = new Map<string, number>();

// ---------------------------------------------------------------------------
// Concurrency control & lifecycle tracking
//
// Three guards keep the scheduler from accumulating "zombie" tasks and from
// stampeding the database when many monitors fire on the same cron boundary:
//
//  1. `inFlightChecks`  — per-monitor re-entrancy guard. A monitor whose check
//     outruns its interval is skipped on the next tick instead of stacking.
//  2. `acquireSlot`     — a global counting semaphore capping how many checks
//     execute concurrently (CHECK_CONCURRENCY). Excess ticks queue briefly.
//  3. `runningChecks`   — registry of in-flight run promises so a graceful
//     shutdown can drain work that is mid-write before the process exits.
// ---------------------------------------------------------------------------

const CHECK_CONCURRENCY = Math.max(
	1,
	Number(process.env.CHECK_CONCURRENCY ?? 20),
);

const inFlightChecks = new Set<string>();
const runningChecks = new Set<Promise<void>>();
const queuedScheduledChecks = new Set<string>();

let availableSlots = CHECK_CONCURRENCY;
const slotWaiters: Array<() => void> = [];

function acquireSlot(waitMs?: number): Promise<void> {
	if (availableSlots > 0) {
		availableSlots -= 1;
		return Promise.resolve();
	}
	// Bound waiting manual probes; increase only when measured mixed
	// account capacity supports a higher queue without missing scheduled work.
	if (waitMs !== undefined && slotWaiters.length >= 200) return Promise.reject(Object.assign(new Error("Monitor check capacity is temporarily unavailable"), { code: "EPROBEBUSY" }));
	return new Promise<void>((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const ready = () => { if (timer) clearTimeout(timer); resolve(); };
		slotWaiters.push(ready);
		if (waitMs !== undefined) timer = setTimeout(() => { const index = slotWaiters.indexOf(ready); if (index >= 0) slotWaiters.splice(index, 1); reject(Object.assign(new Error("Monitor check capacity is temporarily unavailable"), { code: "EPROBEBUSY" })); }, waitMs);
	});
}

function releaseSlot(): void {
	const next = slotWaiters.shift();
	if (next) {
		// Hand the slot directly to the next waiter (count stays "spent").
		next();
	} else {
		availableSlots += 1;
	}
}

/** Manual DNS/TCP probes share scheduled capacity; queue expiry records no sample. */
export async function withMonitorCheckSlot<T>(work: () => Promise<T>, waitMs: number): Promise<T> {
  await acquireSlot(waitMs);
  try { return await work(); } finally { releaseSlot(); }
}

/**
 * Wrap a single scheduled check run: acquire a global concurrency slot, track
 * the promise for graceful drain, and always release the slot afterwards.
 */
function runScheduledCheck(monitorId: string): void {
	if (queuedScheduledChecks.has(monitorId) || !schedulingEnabled) return;
	queuedScheduledChecks.add(monitorId);
	const run = (async () => {
		await acquireSlot();
		try {
			if (schedulingEnabled) await executeCheck(monitorId);
		} catch (err) {
			console.error(
				`[uptime] Failed to execute check for monitor ${monitorId}: ${safeErrorSummary(err)}`,
			);
		} finally {
			releaseSlot();
			queuedScheduledChecks.delete(monitorId);
		}
	})();

	runningChecks.add(run);
	void run.finally(() => {
		runningChecks.delete(run);
	});
}

function intervalToCron(intervalSeconds: number): string {
	if (intervalSeconds < 60) {
		return `*/${intervalSeconds} * * * * *`;
	}

	const minutes = Math.floor(intervalSeconds / 60);

	if (minutes < 60) {
		return `*/${minutes} * * * *`;
	}

	const hours = Math.floor(minutes / 60);
	return `0 */${hours} * * *`;
}

const scheduledIntervals = new Map<string, number>();
let schedulingEnabled = true;
export const setSchedulingEnabled = (enabled: boolean): void => { schedulingEnabled = enabled; };

function queueDueCheck(monitor: UptimeMonitor): void {
	if (!monitor.active || !monitor.nextCheckAt || monitor.monitorType === "heartbeat" || monitor.monitorType === "server" || !schedulingEnabled) return;
	const delay = Date.parse(monitor.nextCheckAt) - Date.now();
	if (!(delay <= FIRST_CHECK_JITTER_MS)) return;
	setTimeout(() => runScheduledCheck(monitor.uptimeMonitorId), Math.max(0, delay)).unref();
}

export const scheduleMonitorCheck = (monitor: UptimeMonitor, options: { checkIfDue?: boolean } = {}): void => {
	const jobName = `uptime-${monitor.uptimeMonitorId}`;

	const existingJob = scheduledJobs[jobName];
	if (existingJob) {
		existingJob.cancel();
	}

	scheduledIntervals.delete(monitor.uptimeMonitorId);
	if (!schedulingEnabled || monitor.monitorType === "heartbeat" || monitor.monitorType === "server") return;

	const cron = intervalToCron(monitor.interval);

	scheduleJob(jobName, cron, () => {
		runScheduledCheck(monitor.uptimeMonitorId);
	});
	scheduledIntervals.set(monitor.uptimeMonitorId, monitor.interval);
  if (options.checkIfDue) queueDueCheck(monitor);
};

export const cancelMonitorCheck = (monitorId: string): void => {
	const jobName = `uptime-${monitorId}`;
	const existingJob = scheduledJobs[jobName];
	if (existingJob) {
		existingJob.cancel();
	}
	scheduledIntervals.delete(monitorId);
	lastTlsCheckMap.delete(monitorId);
};

/** Cancel every per-monitor check job (leadership lost). In-flight checks are left to finish. */
export const cancelAllMonitorChecks = (): void => {
	for (const monitorId of [...scheduledIntervals.keys()]) cancelMonitorCheck(monitorId);
};

/**
 * Leader only: make the in-memory jobs match the database. A monitor created, edited
 * or paused through another replica never calls this process's schedule/cancel, so the
 * leader re-reads the active set periodically. Cheap: one indexed query of active rows.
 */
export const reconcileScheduledMonitors = async (): Promise<{ scheduled: number; cancelled: number }> => {
	if (!schedulingEnabled) return { scheduled: 0, cancelled: 0 };
	const active = await db.query.uptimeMonitor.findMany({ where: eq(uptimeMonitor.active, true) });
	const wanted = new Map(active.filter((monitor) => monitor.monitorType !== "heartbeat" && monitor.monitorType !== "server").map((monitor) => [monitor.uptimeMonitorId, monitor]));
	let scheduled = 0;
	let cancelled = 0;
	for (const [id, monitor] of wanted) {
		if (scheduledIntervals.get(id) !== monitor.interval) {
			// A monitor created through another replica has never been checked: check it now.
			scheduleMonitorCheck(monitor, { checkIfDue: monitor.lastCheckedAt === null });
			scheduled++;
		}
	}
	for (const id of [...scheduledIntervals.keys()]) {
		if (!wanted.has(id)) {
			cancelMonitorCheck(id);
			cancelled++;
		}
	}
	return { scheduled, cancelled };
};

export const rescheduleMonitorCheck = (monitor: UptimeMonitor): void => {
	cancelMonitorCheck(monitor.uptimeMonitorId);
	scheduleMonitorCheck(monitor, { checkIfDue: true });
};

/**
 * Schedule periodic checks for every active monitor on process start.
 *
 * Only the elected PostgreSQL scheduler leader initializes these jobs.
 */
export const initializeAllMonitors = async (): Promise<void> => {
	const monitors = await db.query.uptimeMonitor.findMany({
		where: eq(uptimeMonitor.active, true),
	});

	for (const monitor of monitors) {
		scheduleMonitorCheck(monitor);
	}

	console.info(
		`[uptime] Initialized ${monitors.length} active monitor(s)`,
	);
};

/**
 * Gracefully stop the scheduler: cancel all scheduled jobs, then wait for any
 * in-flight checks to finish writing (bounded by `timeoutMs`) so a deploy/
 * restart never orphans a check mid-write.
 */
export const shutdownScheduler = async (timeoutMs = 10000): Promise<void> => {
	// Cancel all node-schedule jobs (checks + daily cleanup).
	await cancelAllJobs();

	if (runningChecks.size === 0) {
		return;
	}

	console.info(
		`[uptime] Draining ${runningChecks.size} in-flight check(s)...`,
	);

	const drained = Promise.allSettled([...runningChecks]).then(() => undefined);
	const timeout = new Promise<void>((resolve) => {
		setTimeout(resolve, timeoutMs).unref();
	});

	await Promise.race([drained, timeout]);
};

export const executeCheck = async (monitorId: string): Promise<void> => {
	// Per-monitor re-entrancy guard: if the previous check for this monitor is
	// still running (slow endpoint, slow notification), skip this tick rather
	// than stacking concurrent checks for the same monitor.
	if (inFlightChecks.has(monitorId)) {
		console.warn(
			`[uptime] Skipping check for monitor ${monitorId}: previous check still in flight`,
		);
		return;
	}

	inFlightChecks.add(monitorId);
	try {
		await runCheck(monitorId);
	} finally {
		inFlightChecks.delete(monitorId);
	}
};

const runCheck = async (monitorId: string): Promise<void> => {
	const monitor = await db.query.uptimeMonitor.findFirst({
		where: eq(uptimeMonitor.uptimeMonitorId, monitorId),
	});

	if (!monitor || !monitor.active || (monitor.monitorType === "heartbeat" || monitor.monitorType === "server")) {
		return;
	}

	const checkResult = await performMonitorProbe(monitor);

	// Apply failure-threshold semantics to the monitor state.
	let transition = evaluateLatencyTransition({
		previousStatus: monitor.status,
		checkStatus: checkResult.status,
		consecutiveFailures: monitor.consecutiveFailures,
		failureThreshold: monitor.failureThreshold,
    responseTime: checkResult.responseTime, policy: monitor.latencyPolicy,
    consecutiveSlow: monitor.consecutiveSlow, consecutiveHealthy: monitor.consecutiveHealthy,
	});

	const nextCheckAt = new Date(
		Date.now() + monitor.interval * 1000,
	).toISOString();

	let previousStatus = monitor.status;
  let policyMonitor = monitor;

	// Persist the check atomically: check log + monitor state + status change +
	// incident open/resolve commit or roll back together. Without this, a crash
	// between the monitor UPDATE and the status-change INSERT leaves the monitor
	// marked "down" with no transition recorded — the next tick then sees
	// previousStatus === "down" and the incident's notification is never sent.
	// The HTTP probe stays before the transaction and notification dispatch
	// after commit: no network I/O while holding a pooled connection.
	const statusChangeRecord = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, monitor.userId))).for("update");
    if (!current) throw new Error("Monitor removed during check");
    policyMonitor = current;
	const now = new Date().toISOString();
	if (current.lastCheckedAt && Date.parse(current.lastCheckedAt) > Date.now()) return null;
    // Completion time is assigned after the probe, never when queued. Serialize
    // against the latest committed observation, including legacy monitors.
    // An older completion waiting for this lock must not rewind state/history.
    previousStatus = current.status;
    transition = evaluateLatencyTransition({ previousStatus, checkStatus: checkResult.status, responseTime: checkResult.responseTime,
      consecutiveFailures: current.consecutiveFailures, failureThreshold: current.failureThreshold,
      consecutiveSlow: current.consecutiveSlow, consecutiveHealthy: current.consecutiveHealthy, policy: current.latencyPolicy });
		await tx.insert(uptimeCheckLog).values({
      uptimeMonitorId: current.uptimeMonitorId,
			httpStatus: checkResult.httpStatus,
			responseTime: checkResult.responseTime,
			status: transition.sampleStatus,
			errorMessage: checkResult.errorMessage ?? transition.latencyReason ?? null,
			assertionOutcomes: checkResult.assertionOutcomes ?? null,
			createdAt: now,
		});

		// The locked row owns status, timing and completion time as one snapshot.
		const [claimed] = await tx
			.update(uptimeMonitor)
			.set({
				status: transition.monitorStatus,
				httpStatus: checkResult.httpStatus,
				responseTime: checkResult.responseTime,
				lastCheckedAt: now,
				nextCheckAt: new Date(Date.now() + current.interval * 1000).toISOString(),
				consecutiveFailures: transition.consecutiveFailures,
        consecutiveSlow: transition.consecutiveSlow, consecutiveHealthy: transition.consecutiveHealthy,
			})
			.where(
				and(
					eq(uptimeMonitor.uptimeMonitorId, monitorId),
					eq(uptimeMonitor.userId, monitor.userId),
					eq(uptimeMonitor.status, previousStatus),
				),
			)
			.returning({ uptimeMonitorId: uptimeMonitor.uptimeMonitorId });

		if (!claimed) {
			console.warn(
				`[uptime] Skipping transition for monitor ${monitorId}: status changed concurrently`,
			);
			return null;
		}

		if (!transition.shouldRecordStatusChange) {
			return null;
		}

		const [record] = await tx
			.insert(uptimeStatusChange)
			.values({
				uptimeMonitorId: monitorId,
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

    } else if (record?.statusAfter === "degraded" && !policyMonitor.latencyPolicy && (previousStatus === "up" || previousStatus === "pending")) {
      // A fresh legacy degraded episode must not inherit a recovered episode's receipts.
      await tx.update(uptimeMonitor).set({ notificationOutageId: null }).where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, monitor.userId)));
      policyMonitor = { ...policyMonitor, notificationOutageId: null };
		} else if (record?.statusAfter === "up") {

    }

		if (transition.shouldCreateIncident) {
			const ongoing = await getOngoingIncident(monitorId, tx);
			if (!ongoing) {
				await createIncident(monitorId, checkResult.errorMessage ?? transition.latencyReason, tx, policyMonitor.latencyPolicy?.importance ?? "critical", now);
			}
		}

		if (transition.shouldResolveIncident) {
			await resolveIncident(monitorId, tx, now);
		}

		return record ?? null;
	});

	// Dispatch after commit, detached: retries back off for up to ~12.5 minutes
	// and must not hold this monitor's re-entrancy guard or a concurrency slot.
	// In-flight retries are lost on process restart (accepted — the delivery
	// log records the final known outcome).
	if (statusChangeRecord) {
		void dispatchNotifications(policyMonitor, statusChangeRecord).catch((err) => {
			console.error(
				`[uptime] Failed to dispatch notifications for monitor ${monitorId}:`,
				safeErrorSummary(err),
			);
		});
	}

	// 7. TLS check for HTTPS URLs (every 24 hours)
	if (monitor.monitorType === "http" && monitor.tlsMonitoringEnabled !== false && monitor.url.startsWith("https://")) {
		const lastTlsCheck = lastTlsCheckMap.get(monitorId) ?? 0;
		const timeSinceLastTls = Date.now() - lastTlsCheck;

		if (timeSinceLastTls >= TLS_CHECK_INTERVAL_MS) {
			try {
				const tlsMonitor = await db.query.uptimeMonitor.findFirst({ where: and(eq(uptimeMonitor.uptimeMonitorId, monitorId), eq(uptimeMonitor.userId, monitor.userId), eq(uptimeMonitor.tlsMonitoringEnabled, true)) });
        if (!tlsMonitor || !tlsMonitor.url.startsWith("https://")) return;
        const tlsInfo = await checkTlsCertificate(tlsMonitor.url);
				if (tlsInfo) {
					const [tlsUpdated] = await db
						.update(uptimeMonitor)
						.set({
							tlsExpiresAt: tlsInfo.expiresAt,
							tlsExpiresInDays: tlsInfo.expiresInDays,
						})
						.where(and(eq(uptimeMonitor.uptimeMonitorId, monitorId), eq(uptimeMonitor.userId, monitor.userId), eq(uptimeMonitor.tlsMonitoringEnabled, true), eq(uptimeMonitor.url, tlsMonitor.url))).returning();
          if (!tlsUpdated) return;

					// Detached for the same reason as status-change dispatch above.
					void dispatchTlsExpiryNotifications(tlsUpdated, tlsInfo).catch(
						(err) => {
							console.error(
								`[uptime] Failed to dispatch TLS expiry notifications for monitor ${monitorId}:`,
								safeErrorSummary(err),
							);
						},
					);
				}
			} catch (err) {
				console.error(
					`[uptime] TLS check failed for monitor ${monitorId}:`,
					safeErrorSummary(err),
				);
			} finally {
				// Throttle even on failure: a broken TLS endpoint or a failed DB
				// write must not re-probe (and re-alert) on every check tick.
				lastTlsCheckMap.set(monitorId, Date.now());
			}
		}
	}
};
