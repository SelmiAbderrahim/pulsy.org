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
import { eq } from "drizzle-orm";
import { safeErrorSummary } from "../../lib/safe-error";
import { performHttpCheck } from "./checker-service";
import { checkTlsCertificate } from "./tls-checker-service";
import { createIncident, resolveIncident, getOngoingIncident } from "./incident-service";
import { computeStatusTransition } from "./status-transition";
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

let availableSlots = CHECK_CONCURRENCY;
const slotWaiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
	if (availableSlots > 0) {
		availableSlots -= 1;
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => {
		slotWaiters.push(resolve);
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

/**
 * Wrap a single scheduled check run: acquire a global concurrency slot, track
 * the promise for graceful drain, and always release the slot afterwards.
 */
function runScheduledCheck(monitorId: string): void {
	const run = (async () => {
		await acquireSlot();
		try {
			await executeCheck(monitorId);
		} catch (err) {
			console.error(
				`[uptime] Failed to execute check for monitor ${monitorId}: ${safeErrorSummary(err)}`,
			);
		} finally {
			releaseSlot();
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

export const scheduleMonitorCheck = (monitor: UptimeMonitor): void => {
	const jobName = `uptime-${monitor.uptimeMonitorId}`;

	const existingJob = scheduledJobs[jobName];
	if (existingJob) {
		existingJob.cancel();
	}

	const cron = intervalToCron(monitor.interval);

	scheduleJob(jobName, cron, () => {
		runScheduledCheck(monitor.uptimeMonitorId);
	});
};

export const cancelMonitorCheck = (monitorId: string): void => {
	const jobName = `uptime-${monitorId}`;
	const existingJob = scheduledJobs[jobName];
	if (existingJob) {
		existingJob.cancel();
	}
	lastTlsCheckMap.delete(monitorId);
};

export const rescheduleMonitorCheck = (monitor: UptimeMonitor): void => {
	cancelMonitorCheck(monitor.uptimeMonitorId);
	scheduleMonitorCheck(monitor);
};

/**
 * Schedule periodic checks for every active monitor on process start.
 *
 * SINGLE-INSTANCE ASSUMPTION: this scheduler is in-process and has no
 * cross-process coordination. Running more than one server replica would make
 * EVERY monitor check fire once per replica — duplicate check logs, duplicate
 * incidents, and duplicate notifications. Before scaling to multiple replicas,
 * gate this with a PostgreSQL advisory lock (`pg_advisory_lock`) so only the
 * elected leader runs the scheduler.
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

	if (!monitor || !monitor.active) {
		return;
	}

	const checkResult = await performHttpCheck(monitor);
	const now = new Date().toISOString();

	// Apply failure-threshold semantics to the monitor state.
	const transition = computeStatusTransition({
		previousStatus: monitor.status,
		checkStatus: checkResult.status,
		consecutiveFailures: monitor.consecutiveFailures,
		failureThreshold: monitor.failureThreshold,
	});

	const nextCheckAt = new Date(
		Date.now() + monitor.interval * 1000,
	).toISOString();

	const previousStatus = monitor.status;

	// Persist the check atomically: check log + monitor state + status change +
	// incident open/resolve commit or roll back together. Without this, a crash
	// between the monitor UPDATE and the status-change INSERT leaves the monitor
	// marked "down" with no transition recorded — the next tick then sees
	// previousStatus === "down" and the incident's notification is never sent.
	// The HTTP probe stays before the transaction and notification dispatch
	// after commit: no network I/O while holding a pooled connection.
	const statusChangeRecord = await db.transaction(async (tx) => {
		await tx.insert(uptimeCheckLog).values({
			uptimeMonitorId: monitorId,
			httpStatus: checkResult.httpStatus,
			responseTime: checkResult.responseTime,
			status: checkResult.status,
			errorMessage: checkResult.errorMessage ?? null,
			createdAt: now,
		});

		await tx
			.update(uptimeMonitor)
			.set({
				status: transition.monitorStatus,
				httpStatus: checkResult.httpStatus,
				responseTime: checkResult.responseTime,
				lastCheckedAt: now,
				nextCheckAt,
				consecutiveFailures: transition.consecutiveFailures,
			})
			.where(eq(uptimeMonitor.uptimeMonitorId, monitorId));

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
				reason: checkResult.errorMessage ?? null,
				createdAt: now,
			})
			.returning();

		if (transition.shouldCreateIncident) {
			const ongoing = await getOngoingIncident(monitorId, tx);
			if (!ongoing) {
				await createIncident(monitorId, checkResult.errorMessage, tx);
			}
		}

		if (transition.shouldResolveIncident) {
			await resolveIncident(monitorId, tx);
		}

		return record ?? null;
	});

	// Dispatch after commit, detached: retries back off for up to ~12.5 minutes
	// and must not hold this monitor's re-entrancy guard or a concurrency slot.
	// In-flight retries are lost on process restart (accepted — the delivery
	// log records the final known outcome).
	if (statusChangeRecord) {
		void dispatchNotifications(monitor, statusChangeRecord).catch((err) => {
			console.error(
				`[uptime] Failed to dispatch notifications for monitor ${monitorId}: ${safeErrorSummary(err)}`,
			);
		});
	}

	// 7. TLS check for HTTPS URLs (every 24 hours)
	if (monitor.url.startsWith("https://")) {
		const lastTlsCheck = lastTlsCheckMap.get(monitorId) ?? 0;
		const timeSinceLastTls = Date.now() - lastTlsCheck;

		if (timeSinceLastTls >= TLS_CHECK_INTERVAL_MS) {
			try {
				const tlsInfo = await checkTlsCertificate(monitor.url);
				if (tlsInfo) {
					await db
						.update(uptimeMonitor)
						.set({
							tlsExpiresAt: tlsInfo.expiresAt,
							tlsExpiresInDays: tlsInfo.expiresInDays,
						})
						.where(eq(uptimeMonitor.uptimeMonitorId, monitorId));

					// Detached for the same reason as status-change dispatch above.
					void dispatchTlsExpiryNotifications(monitor, tlsInfo).catch(
						(err) => {
							console.error(
								`[uptime] Failed to dispatch TLS expiry notifications for monitor ${monitorId}: ${safeErrorSummary(err)}`,
							);
						},
					);
				}
				lastTlsCheckMap.set(monitorId, Date.now());
			} catch (err) {
				console.error(
					`[uptime] TLS check failed for monitor ${monitorId}: ${safeErrorSummary(err)}`,
				);
			}
		}
	}
};
