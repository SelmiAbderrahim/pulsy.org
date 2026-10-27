import { reliabilityRetentionDays } from "./reliability-retention";
import {
	db,
	uptimeCheckLog,
	uptimeIncident,
	uptimeMonitor,
	uptimeNotificationLog,
	uptimeStatusChange,
  uptimeReliabilityDay, uptimeReliabilityAnnotation, uptimeReliabilityPolicy,
} from "@pulsy/db";
import { and, eq, inArray, lt, desc } from "drizzle-orm";

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

/** Existing daily cleanup owns this work; no new per-monitor timers. The partial
 * cutoff UTC day is retained for exact clipped reads until its final instant ages out.
 * Keep the policy spanning the cutoff and all newer versions.
 */
export async function cleanupReliabilityHistory(envDefaultRetentionDays: number): Promise<number> {
  const owners = await db.selectDistinct({ userId: uptimeMonitor.userId }).from(uptimeMonitor);
  let removed = 0;
  for (const { userId } of owners) {
    const retention = await reliabilityRetentionDays(userId, envDefaultRetentionDays);
    const cutoff = cutoffIso(retention), cutoffDay = cutoff.slice(0, 10);
    for (;;) {
      const batch = await db.select({ id: uptimeReliabilityDay.id }).from(uptimeReliabilityDay).where(and(eq(uptimeReliabilityDay.userId, userId), lt(uptimeReliabilityDay.day, cutoffDay))).limit(BATCH_SIZE);
      if (!batch.length) break;
      await db.delete(uptimeReliabilityDay).where(and(eq(uptimeReliabilityDay.userId, userId), inArray(uptimeReliabilityDay.id, batch.map(row => row.id)))); removed += batch.length;
    }
    for (;;) {
      const batch = await db.select({ id: uptimeReliabilityAnnotation.id }).from(uptimeReliabilityAnnotation).where(and(eq(uptimeReliabilityAnnotation.userId, userId), lt(uptimeReliabilityAnnotation.at, cutoff))).limit(BATCH_SIZE);
      if (!batch.length) break;
      await db.delete(uptimeReliabilityAnnotation).where(and(eq(uptimeReliabilityAnnotation.userId, userId), inArray(uptimeReliabilityAnnotation.id, batch.map(row => row.id)))); removed += batch.length;
    }
    const monitors = await db.select({ id: uptimeMonitor.uptimeMonitorId }).from(uptimeMonitor).where(eq(uptimeMonitor.userId, userId));
    for (const monitor of monitors) {
      const scope = and(eq(uptimeReliabilityPolicy.userId, userId), eq(uptimeReliabilityPolicy.monitorId, monitor.id));
      const [baseline] = await db.select({ version: uptimeReliabilityPolicy.version }).from(uptimeReliabilityPolicy).where(and(scope, lt(uptimeReliabilityPolicy.firstObservedAt, cutoff))).orderBy(desc(uptimeReliabilityPolicy.version)).limit(1);
      if (!baseline) continue;
      for (;;) {
        const batch = await db.select({ id: uptimeReliabilityPolicy.id }).from(uptimeReliabilityPolicy).where(and(scope, lt(uptimeReliabilityPolicy.version, baseline.version))).limit(BATCH_SIZE);
        if (!batch.length) break;
        await db.delete(uptimeReliabilityPolicy).where(and(scope, inArray(uptimeReliabilityPolicy.id, batch.map(row => row.id)))); removed += batch.length;
      }
    }
  }
  return removed;
}
