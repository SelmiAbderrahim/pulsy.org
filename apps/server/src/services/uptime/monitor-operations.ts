// ---------------------------------------------------------------------------
// Shared monitor orchestration.
//
// Both the tRPC router (`uptimeMonitor.monitor.*`) and the public REST API
// (`/api/v1/monitors`) drive monitor creation and manual checks. To keep a
// single source of truth that orchestration lives here:
//
//   createMonitorForUser  — insert (caller schedules)
//   runManualCheck        — the full "check now" pipeline
//
// `createMonitorForUser` intentionally does NOT schedule: callers invoke
// `scheduleMonitorCheck` at the call site (where the tRPC test's scheduler mock
// is bound), exactly as the router did before this extraction.
// ---------------------------------------------------------------------------

import type { z } from "zod";
import {
	type apiCreateUptimeMonitor,
	db,
	uptimeCheckLog,
	uptimeMonitor,
	uptimeStatusChange,
} from "@pulsy/db";
import { and, eq } from "drizzle-orm";
import { safeErrorSummary } from "../../lib/safe-error";
import { performHttpCheck } from "./checker-service";
import {
	createIncident,
	getOngoingIncident,
	resolveIncident,
} from "./incident-service";
import type { UptimeMonitor } from "./monitor-service";
import { dispatchNotifications } from "./notification-service";
import { computeStatusTransition } from "./status-transition";

/**
 * Create a monitor for `userId`. Returns the inserted row; the caller is
 * responsible for scheduling it (`scheduleMonitorCheck`) when active.
 */
export async function createMonitorForUser(
	input: z.infer<typeof apiCreateUptimeMonitor>,
	userId: string,
): Promise<UptimeMonitor> {
	const nextCheckAt = input.active
		? new Date(Date.now() + input.interval * 1000).toISOString()
		: null;

	const [inserted] = await db
		.insert(uptimeMonitor)
		.values({
			name: input.name,
			url: input.url,
			method: input.method,
			expectedStatus: input.expectedStatus,
			timeout: input.timeout,
			interval: input.interval,
			failureThreshold: input.failureThreshold,
			active: input.active,
			tags: input.tags,
			status: "pending",
			consecutiveFailures: 0,
			nextCheckAt,
			userId,
		})
		.returning();

	/* v8 ignore next 3 -- unreachable: INSERT ... RETURNING yields the row or throws */
	if (!inserted) {
		throw new Error("Failed to create uptime monitor");
	}

	return inserted;
}

/**
 * Run a check immediately: HTTP probe → check log → monitor-state update →
 * status-change record → incident open/resolve → notification dispatch.
 * The caller must have verified ownership and that the monitor is active.
 * Returns the updated monitor row.
 */
export async function runManualCheck(
	monitor: UptimeMonitor,
): Promise<UptimeMonitor> {
	const checkResult = await performHttpCheck(monitor);
	const now = new Date().toISOString();
	const transition = computeStatusTransition({
		previousStatus: monitor.status,
		checkStatus: checkResult.status,
		consecutiveFailures: monitor.consecutiveFailures,
		failureThreshold: monitor.failureThreshold,
	});

	const previousStatus = monitor.status;

	// Same atomicity contract as the scheduler's runCheck: all state writes for
	// this check commit or roll back together; dispatch happens after commit.
	const { updated, statusChangeRecord } = await db.transaction(async (tx) => {
		await tx.insert(uptimeCheckLog).values({
			uptimeMonitorId: monitor.uptimeMonitorId,
			httpStatus: checkResult.httpStatus,
			responseTime: checkResult.responseTime,
			status: checkResult.status,
			errorMessage: checkResult.errorMessage ?? null,
			createdAt: now,
		});

		const [updatedRow] = await tx
			.update(uptimeMonitor)
			.set({
				status: transition.monitorStatus,
				httpStatus: checkResult.httpStatus,
				responseTime: checkResult.responseTime,
				lastCheckedAt: now,
				nextCheckAt: new Date(
					Date.now() + monitor.interval * 1000,
				).toISOString(),
				consecutiveFailures: transition.consecutiveFailures,
			})
			.where(
				and(
					eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId),
					eq(uptimeMonitor.userId, monitor.userId),
				),
			)
			.returning();

		/* v8 ignore next 3 -- unreachable: UPDATE ... RETURNING on an existing row */
		if (!updatedRow) {
			throw new Error("Failed to update uptime monitor");
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
				reason: checkResult.errorMessage ?? null,
				createdAt: now,
			})
			.returning();

		if (transition.shouldCreateIncident) {
			const ongoing = await getOngoingIncident(monitor.uptimeMonitorId, tx);
			if (!ongoing) {
				await createIncident(
					monitor.uptimeMonitorId,
					checkResult.errorMessage,
					tx,
				);
			}
		}

		if (transition.shouldResolveIncident) {
			await resolveIncident(monitor.uptimeMonitorId, tx);
		}

		return { updated: updatedRow, statusChangeRecord: record ?? null };
	});

	// Detached: retry backoff (up to ~12.5 min) must not block the checkNow
	// tRPC request. In-flight retries are lost on restart (accepted).
	if (statusChangeRecord) {
		void dispatchNotifications(monitor, statusChangeRecord).catch((err) => {
			console.error(
				`[uptime] Failed to dispatch notifications for monitor ${monitor.uptimeMonitorId}: ${safeErrorSummary(err)}`,
			);
		});
	}

	return updated;
}
