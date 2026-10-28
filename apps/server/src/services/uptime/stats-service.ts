import {
	db,
	uptimeCheckDay,
	uptimeCheckLog,
	uptimeIncident,
	uptimeMonitor,
} from "@pulsy/db";
import { eq, and, gte, lte, lt, desc, count, exists, sum, inArray, isNull, or } from "drizzle-orm";
import { availabilityPercent, slowSharePercent } from "@pulsy/db/status-math";

export interface MonitorStats {
	totalChecks: number;
	successfulChecks: number;
	failedChecks: number;
	degradedChecks: number;
	avgResponseTime: number | null;
	minResponseTime: number | null;
	maxResponseTime: number | null;
	p95ResponseTime: number | null;
	uptimePercentage: number | null;
	availabilityPercentage: number | null;
	slowPercentage: number | null;
}

export interface DailyUptimeEntry {
	date: string;
	uptimePercentage: number;
	totalChecks: number;
}

export interface UptimeBarEntry {
	date: string;
	status: "up" | "down" | "degraded" | "partial" | "unknown";
	uptimePercent: number | null;
	totalChecks: number;
}

export interface IncidentSummary {
	count: number;
	totalDowntimeSeconds: number;
	longestIncidentSeconds: number;
}

export interface OwnedUptimeAggregate {
	uptimeChecks: number;
	successfulChecks: number;
	degradedChecks: number;
	uptimePercentage: number;
	availabilityPercentage: number;
	slowPercentage: number;
}

export interface WindowIncident {
	incidentId: string;
	status: string;
	startedAt: string;
	resolvedAt: string | null;
	downtimeSeconds: number;
}

/** Check success counts only up samples; no observations means unknown. */
export const checkSuccessPercent = (up: number, total: number): number | null =>
	total > 0 ? Math.round((up / total) * 10_000) / 100 : null;

/**
 * Aggregate owned checks using rollups for complete UTC days and raw logs only
 * for the two partial edge days. Both rolling-window boundaries are inclusive;
 * future samples are excluded and monitors without observations are omitted.
 */
export async function getOwnedUptimeAggregates(
	userId: string,
	days = 30,
	monitorIds?: string[],
): Promise<Map<string, OwnedUptimeAggregate>> {
	if (monitorIds?.length === 0) return new Map();

	const until = new Date().toISOString();
	const since = new Date(Date.parse(until) - days * 86_400_000).toISOString();
	const fullStart = new Date(Date.parse(since.slice(0, 10)) + 86_400_000).toISOString();
	const fullEnd = `${until.slice(0, 10)}T00:00:00.000Z`;
	const hasFullDays = fullStart < fullEnd;

	// Filter IDs on the owned relation so a fresh database can use parameterized
	// child indexes rather than rescan every matching check for each monitor.
	const daily = hasFullDays
		? await db.select({
			monitorId: uptimeCheckDay.monitorId,
			status: uptimeCheckDay.status,
			checks: sum(uptimeCheckDay.checks),
		}).from(uptimeCheckDay)
			.innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeCheckDay.monitorId))
			.where(and(
				eq(uptimeMonitor.userId, userId),
				gte(uptimeCheckDay.day, fullStart.slice(0, 10)),
				lt(uptimeCheckDay.day, fullEnd.slice(0, 10)),
				monitorIds ? inArray(uptimeMonitor.uptimeMonitorId, monitorIds) : undefined,
			))
			.groupBy(uptimeCheckDay.monitorId, uptimeCheckDay.status)
		: [];
	const edges = await db.select({
		monitorId: uptimeCheckLog.uptimeMonitorId,
		status: uptimeCheckLog.status,
		checks: count(),
	}).from(uptimeCheckLog)
		.innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeCheckLog.uptimeMonitorId))
		.where(and(
			eq(uptimeMonitor.userId, userId),
			gte(uptimeCheckLog.createdAt, since),
			lte(uptimeCheckLog.createdAt, until),
			hasFullDays
				? or(lt(uptimeCheckLog.createdAt, fullStart), gte(uptimeCheckLog.createdAt, fullEnd))
				: undefined,
			monitorIds ? inArray(uptimeMonitor.uptimeMonitorId, monitorIds) : undefined,
		))
		.groupBy(uptimeCheckLog.uptimeMonitorId, uptimeCheckLog.status);

	const counts = new Map<string, { total: number; up: number; degraded: number }>();
	for (const group of [...daily, ...edges]) {
		const value = counts.get(group.monitorId) ?? { total: 0, up: 0, degraded: 0 };
		const checks = Number(group.checks);
		value.total += checks;
		if (group.status === "up") value.up += checks;
		if (group.status === "degraded") value.degraded += checks;
		counts.set(group.monitorId, value);
	}

	const result = new Map<string, OwnedUptimeAggregate>();
	for (const [id, value] of counts) {
		if (value.total <= 0) continue;
		result.set(id, {
			uptimeChecks: value.total,
			successfulChecks: value.up,
			degradedChecks: value.degraded,
			uptimePercentage: checkSuccessPercent(value.up, value.total)!,
			// A positive total guarantees both shared percentage helpers return numbers.
			availabilityPercentage: availabilityPercent(value.up, value.degraded, value.total)!,
			slowPercentage: slowSharePercent(value.degraded, value.total)!,
		});
	}
	return result;
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
	const degradedChecks = logs.filter((log) => log.status === "degraded").length;
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

	// No observations are unknown; a measured zero remains a real zero.
	const uptimePercentage = checkSuccessPercent(successfulChecks, totalChecks);

	return {
		totalChecks,
		successfulChecks,
		failedChecks,
		degradedChecks,
		avgResponseTime,
		minResponseTime,
		maxResponseTime,
		p95ResponseTime,
		uptimePercentage,
		availabilityPercentage: availabilityPercent(successfulChecks, degradedChecks, totalChecks),
		slowPercentage: slowSharePercent(degradedChecks, totalChecks),
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
	conditions.push(lte(uptimeCheckLog.createdAt, until ?? new Date().toISOString()));

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
	const until = new Date().toISOString();
	const since = new Date(
		Date.parse(until) - days * 24 * 60 * 60 * 1000,
	).toISOString();
	return getMonitorStatsForWindow(monitorId, userId, since, until);
};

/**
 * Fixed UTC calendar buckets for the owner's daily chart, including unknown
 * days. Complete days use trigger-maintained rollups; today's checks are
 * bounded at the captured current time so future samples cannot affect it.
 */
export async function getUptimeBarData(
	monitorId: string,
	userId: string,
	days = 90,
): Promise<UptimeBarEntry[]> {
	const now = new Date();
	const until = now.toISOString();
	const today = `${until.slice(0, 10)}T00:00:00.000Z`;
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1));
	const since = start.toISOString();
	const completeDays = await db.select({
		day: uptimeCheckDay.day,
		status: uptimeCheckDay.status,
		checks: sum(uptimeCheckDay.checks),
	}).from(uptimeCheckDay)
		.innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeCheckDay.monitorId))
		.where(and(
			eq(uptimeMonitor.userId, userId),
			eq(uptimeCheckDay.monitorId, monitorId),
			gte(uptimeCheckDay.day, since.slice(0, 10)),
			lt(uptimeCheckDay.day, today.slice(0, 10)),
		))
		.groupBy(uptimeCheckDay.day, uptimeCheckDay.status);
	const currentDay = await db.select({
		status: uptimeCheckLog.status,
		checks: count(),
	}).from(uptimeCheckLog)
		.innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeCheckLog.uptimeMonitorId))
		.where(and(
			eq(uptimeMonitor.userId, userId),
			eq(uptimeCheckLog.uptimeMonitorId, monitorId),
			gte(uptimeCheckLog.createdAt, today),
			lte(uptimeCheckLog.createdAt, until),
		))
		.groupBy(uptimeCheckLog.status);

	const counts = new Map<string, { total: number; up: number; down: number; degraded: number }>();
	for (const group of [
		...completeDays,
		...currentDay.map(group => ({ ...group, day: until.slice(0, 10) })),
	]) {
		const value = counts.get(group.day) ?? { total: 0, up: 0, down: 0, degraded: 0 };
		const checks = Number(group.checks);
		value.total += checks;
		if (group.status === "up") value.up += checks;
		if (group.status === "down") value.down += checks;
		if (group.status === "degraded") value.degraded += checks;
		counts.set(group.day, value);
	}

	const result: UptimeBarEntry[] = [];
	for (let offset = 0; offset < days; offset++) {
		const date = new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
		const value = counts.get(date);
		if (!value || value.total <= 0) {
			result.push({ date, status: "unknown", uptimePercent: null, totalChecks: 0 });
			continue;
		}
		let status: UptimeBarEntry["status"];
		if (value.down === 0 && value.degraded === 0) status = "up";
		else if (value.up === 0) status = value.down > 0 ? "down" : "degraded";
		else status = value.down > 0 ? "partial" : "degraded";
		result.push({ date, status, uptimePercent: checkSuccessPercent(value.up, value.total), totalChecks: value.total });
	}
	return result;
}

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
			uptimePercentage: checkSuccessPercent(up, total)!,
		}));
};

/**
 * Incident projections overlapping the report window, oldest first. Downtime
 * is clipped at the window edges; stored durations remain authoritative for
 * incidents wholly within the window.
 */
export const getMonitorIncidentsForWindow = async (
	monitorId: string,
	userId: string,
	since: string,
	until: string,
): Promise<WindowIncident[]> => {
	const incidents = await db.query.uptimeIncident.findMany({
		where: and(
			eq(uptimeIncident.uptimeMonitorId, monitorId),
			ownedMonitorExists(monitorId, userId),
			lte(uptimeIncident.startedAt, until),
			or(isNull(uptimeIncident.resolvedAt), gte(uptimeIncident.resolvedAt, since)),
		),
		orderBy: [uptimeIncident.startedAt],
	});

	const sinceMs = new Date(since).getTime();
	const untilMs = new Date(until).getTime();
	return incidents.map((incident) => {
		const startMs = new Date(incident.startedAt).getTime();
		const endMs = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : untilMs;
		const crossesBoundary = startMs < sinceMs || endMs > untilMs;
		const downtimeSeconds = !crossesBoundary && incident.durationSeconds != null
			? incident.durationSeconds
			: Math.max(0, Math.round((Math.min(endMs, untilMs) - Math.max(startMs, sinceMs)) / 1000));
		return {
			incidentId: incident.incidentId,
			status: incident.status,
			startedAt: incident.startedAt,
			resolvedAt: incident.resolvedAt,
			downtimeSeconds,
		};
	});
};

/** Report totals and exported incident rows use the same clipped durations. */
export function summarizeWindowIncidents(incidents: readonly WindowIncident[]): IncidentSummary {
	return {
		count: incidents.length,
		totalDowntimeSeconds: incidents.reduce((total, incident) => total + incident.downtimeSeconds, 0),
		longestIncidentSeconds: incidents.reduce((longest, incident) => Math.max(longest, incident.downtimeSeconds), 0),
	};
}

export const getMonitorIncidentSummary = async (
	monitorId: string,
	userId: string,
	since: string,
	until: string,
): Promise<IncidentSummary> => summarizeWindowIncidents(
	await getMonitorIncidentsForWindow(monitorId, userId, since, until),
);

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
