import {
	db,
	uptimeCheckLog,
	uptimeIncident,
	uptimeMonitor,
} from "@pulsy/db";
import { eq, and, gte, lte, desc, count, exists } from "drizzle-orm";

export interface MonitorStats {
	totalChecks: number;
	successfulChecks: number;
	failedChecks: number;
	avgResponseTime: number | null;
	minResponseTime: number | null;
	maxResponseTime: number | null;
	p95ResponseTime: number | null;
	uptimePercentage: number;
}

export interface DailyUptimeEntry {
	date: string;
	uptimePercentage: number;
	totalChecks: number;
}

export interface IncidentSummary {
	count: number;
	totalDowntimeSeconds: number;
	longestIncidentSeconds: number;
}

function dateKeyFromIso(value: string): string {
	const [date] = value.split("T");
	/* v8 ignore next -- fallback only for a "T"-less string; createdAt is always ISO */
	return date ?? new Date(value).toISOString().split("T")[0]!;
}

/** Require that `monitorId` belongs to `userId` inside each child-table query. */
function ownedMonitorExists(monitorId: string, userId: string) {
	return exists(
		db
			.select({ id: uptimeMonitor.uptimeMonitorId })
			.from(uptimeMonitor)
			.where(
				and(
					eq(uptimeMonitor.uptimeMonitorId, monitorId),
					eq(uptimeMonitor.userId, userId),
				),
			),
	);
}

/** Pure aggregation over a set of check-log rows. */
function computeStats(
	logs: Array<{ status: string; responseTime: number | null }>,
): MonitorStats {
	const totalChecks = logs.length;
	const successfulChecks = logs.filter((log) => log.status === "up").length;
	const failedChecks = logs.filter((log) => log.status === "down").length;
	const responseTimes = logs
		.map((log) => log.responseTime)
		.filter((value): value is number => typeof value === "number");
	const avgResponseTime =
		responseTimes.length > 0
			? Math.round(
					responseTimes.reduce((sum, value) => sum + value, 0) /
						responseTimes.length,
				)
			: null;
	const minResponseTime =
		responseTimes.length > 0 ? Math.min(...responseTimes) : null;
	const maxResponseTime =
		responseTimes.length > 0 ? Math.max(...responseTimes) : null;

	let p95ResponseTime: number | null = null;
	if (responseTimes.length > 0) {
		const sorted = [...responseTimes].sort((a, b) => a - b);
		const index = Math.min(
			sorted.length - 1,
			Math.ceil(0.95 * sorted.length) - 1,
		);
		p95ResponseTime = sorted[index]!;
	}

	const uptimePercentage =
		totalChecks > 0
			? Math.round((successfulChecks / totalChecks) * 10000) / 100
			: 100;

	return {
		totalChecks,
		successfulChecks,
		failedChecks,
		avgResponseTime,
		minResponseTime,
		maxResponseTime,
		p95ResponseTime,
		uptimePercentage,
	};
}

/**
 * Aggregate check-log stats over an explicit `[since, until]` ISO window.
 * `until` omitted ⇒ open-ended (up to now). Powers both the rolling REST
 * stats endpoint and the calendar-month SLA report.
 */
export const getMonitorStatsForWindow = async (
	monitorId: string,
	userId: string,
	since: string,
	until?: string,
): Promise<MonitorStats> => {
	const conditions = [
		eq(uptimeCheckLog.uptimeMonitorId, monitorId),
		ownedMonitorExists(monitorId, userId),
		gte(uptimeCheckLog.createdAt, since),
	];
	if (until) {
		conditions.push(lte(uptimeCheckLog.createdAt, until));
	}

	const logs = await db.query.uptimeCheckLog.findMany({
		columns: {
			status: true,
			responseTime: true,
		},
		where: and(...conditions),
	});

	return computeStats(logs);
};

export const getMonitorStats = async (
	monitorId: string,
	userId: string,
	days = 30,
): Promise<MonitorStats> => {
	const since = new Date(
		Date.now() - days * 24 * 60 * 60 * 1000,
	).toISOString();
	return getMonitorStatsForWindow(monitorId, userId, since);
};

/**
 * Per-day uptime series over an explicit `[since, until]` ISO window. Only days
 * with at least one check appear; the report renderer decides how to display
 * gaps. Days are keyed by their ISO date (UTC).
 */
export const getMonitorDailyUptime = async (
	monitorId: string,
	userId: string,
	since: string,
	until: string,
): Promise<DailyUptimeEntry[]> => {
	const logs = await db.query.uptimeCheckLog.findMany({
		columns: {
			createdAt: true,
			status: true,
		},
		where: and(
			eq(uptimeCheckLog.uptimeMonitorId, monitorId),
			ownedMonitorExists(monitorId, userId),
			gte(uptimeCheckLog.createdAt, since),
			lte(uptimeCheckLog.createdAt, until),
		),
	});

	const dataMap = new Map<string, { total: number; up: number }>();
	for (const log of logs) {
		const date = dateKeyFromIso(log.createdAt);
		const day = dataMap.get(date) ?? { total: 0, up: 0 };
		day.total += 1;
		if (log.status === "up") day.up += 1;
		dataMap.set(date, day);
	}

	return [...dataMap.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, { total, up }]) => ({
			date,
			totalChecks: total,
			uptimePercentage: Math.round((up / total) * 10000) / 100,
		}));
};

/**
 * Incident roll-up over an explicit `[since, until]` ISO window. Counts
 * incidents that started within the window; downtime uses the stored
 * `durationSeconds` for resolved incidents and `until - startedAt` for an
 * incident still ongoing at report time.
 */
export const getMonitorIncidentSummary = async (
	monitorId: string,
	userId: string,
	since: string,
	until: string,
): Promise<IncidentSummary> => {
	const incidents = await db.query.uptimeIncident.findMany({
		where: and(
			eq(uptimeIncident.uptimeMonitorId, monitorId),
			ownedMonitorExists(monitorId, userId),
			gte(uptimeIncident.startedAt, since),
			lte(uptimeIncident.startedAt, until),
		),
	});

	const untilMs = new Date(until).getTime();
	let totalDowntimeSeconds = 0;
	let longestIncidentSeconds = 0;

	for (const incident of incidents) {
		const seconds =
			incident.durationSeconds ??
			Math.max(
				0,
				Math.round((untilMs - new Date(incident.startedAt).getTime()) / 1000),
			);
		totalDowntimeSeconds += seconds;
		if (seconds > longestIncidentSeconds) {
			longestIncidentSeconds = seconds;
		}
	}

	return {
		count: incidents.length,
		totalDowntimeSeconds,
		longestIncidentSeconds,
	};
};

export const getCheckLogs = async (
	monitorId: string,
	userId: string,
	options?: {
		limit?: number;
		offset?: number;
		startDate?: string;
		endDate?: string;
	},
): Promise<{
	logs: Array<typeof uptimeCheckLog.$inferSelect>;
	total: number;
}> => {
	const limit = options?.limit ?? 100;
	const offset = options?.offset ?? 0;

	const conditions = [
		eq(uptimeCheckLog.uptimeMonitorId, monitorId),
		ownedMonitorExists(monitorId, userId),
	];

	if (options?.startDate) {
		conditions.push(gte(uptimeCheckLog.createdAt, options.startDate));
	}

	if (options?.endDate) {
		conditions.push(lte(uptimeCheckLog.createdAt, options.endDate));
	}

	const whereClause = and(...conditions);

	const [countResult] = await db
		.select({ total: count(uptimeCheckLog.checkLogId) })
		.from(uptimeCheckLog)
		.where(whereClause);

	/* v8 ignore next -- COUNT(*) always returns exactly one row */
	const total = Number(countResult?.total ?? 0);

	const logs = await db.query.uptimeCheckLog.findMany({
		where: whereClause,
		orderBy: [desc(uptimeCheckLog.createdAt)],
		limit,
		offset,
	});

	return { logs, total };
};
