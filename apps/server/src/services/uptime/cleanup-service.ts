import {
	db,
	uptimeCheckLog,
	uptimeIncident,
	uptimeMonitor,
	uptimeNotificationLog,
	uptimeStatusChange,
} from "@pulsy/db";
import { and, eq, inArray, lt } from "drizzle-orm";

// Delete in bounded batches so the daily cleanup never holds a long table lock
// or loads millions of row ids into memory at once. Each batch selects up to
// BATCH_SIZE primary keys older than the cutoff and deletes exactly those.
/* v8 ignore next -- env-default/clamp for an ops tunable */
const BATCH_SIZE = Math.max(1, Number(process.env.CLEANUP_BATCH_SIZE ?? 5000));

function cutoffIso(retentionDays: number): string {
	return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

export const cleanupOldCheckLogs = async (
	retentionDays: number,
): Promise<number> => {
	const cutoff = cutoffIso(retentionDays);
	let total = 0;

	for (;;) {
		const batch = await db
			.select({ id: uptimeCheckLog.checkLogId })
			.from(uptimeCheckLog)
			.where(lt(uptimeCheckLog.createdAt, cutoff))
			.limit(BATCH_SIZE);

		if (batch.length === 0) {
			break;
		}

		await db.delete(uptimeCheckLog).where(
			inArray(
				uptimeCheckLog.checkLogId,
				batch.map((row) => row.id),
			),
		);

		total += batch.length;

		if (batch.length < BATCH_SIZE) {
			break;
		}
	}

	return total;
};

export const cleanupOldIncidents = async (
	retentionDays: number,
): Promise<number> => {
	const cutoff = cutoffIso(retentionDays);
	let total = 0;

	for (;;) {
		const batch = await db
			.select({ id: uptimeIncident.incidentId })
			.from(uptimeIncident)
			.where(
				and(
					eq(uptimeIncident.status, "resolved"),
					lt(uptimeIncident.startedAt, cutoff),
				),
			)
			.limit(BATCH_SIZE);

		if (batch.length === 0) {
			break;
		}

		await db.delete(uptimeIncident).where(
			inArray(
				uptimeIncident.incidentId,
				batch.map((row) => row.id),
			),
		);

		total += batch.length;

		if (batch.length < BATCH_SIZE) {
			break;
		}
	}

	return total;
};

export const cleanupOldStatusChanges = async (
	retentionDays: number,
): Promise<number> => {
	const cutoff = cutoffIso(retentionDays);
	let total = 0;

	for (;;) {
		const batch = await db
			.select({ id: uptimeStatusChange.statusChangeId })
			.from(uptimeStatusChange)
			.where(lt(uptimeStatusChange.createdAt, cutoff))
			.limit(BATCH_SIZE);

		if (batch.length === 0) {
			break;
		}

		await db.delete(uptimeStatusChange).where(
			inArray(
				uptimeStatusChange.statusChangeId,
				batch.map((row) => row.id),
			),
		);

		total += batch.length;

		if (batch.length < BATCH_SIZE) {
			break;
		}
	}

	return total;
};

export const cleanupOldNotificationLogs = async (
	retentionDays: number,
): Promise<number> => {
	const cutoff = cutoffIso(retentionDays);
	let total = 0;

	for (;;) {
		const batch = await db
			.select({ id: uptimeNotificationLog.notificationLogId })
			.from(uptimeNotificationLog)
			.where(lt(uptimeNotificationLog.createdAt, cutoff))
			.limit(BATCH_SIZE);

		if (batch.length === 0) {
			break;
		}

		await db.delete(uptimeNotificationLog).where(
			inArray(
				uptimeNotificationLog.notificationLogId,
				batch.map((row) => row.id),
			),
		);

		total += batch.length;

		if (batch.length < BATCH_SIZE) {
			break;
		}
	}

	return total;
};
