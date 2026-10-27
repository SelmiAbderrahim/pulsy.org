import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
	db,
	uptimeCheckLog,
	uptimeIncident,
} from "@pulsy/db";
import {
	createTestMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";
import {
	getCheckLogs,
	getMonitorDailyUptime,
	getMonitorIncidentSummary,
	getMonitorIncidentsForWindow,
	getMonitorStats,
	getMonitorStatsForWindow,
	getOwnedUptimeAggregates,
	getUptimeBarData,
	summarizeWindowIncidents,
} from "../stats-service";

useCleanDatabase();

let userId: string;
let monitorId: string;

beforeEach(async () => {
	const u = await createTestUser();
	userId = u.id;
	const m = await createTestMonitor(userId);
	monitorId = m.uptimeMonitorId;
});

describe("getOwnedUptimeAggregates", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z"));
	});

	afterEach(() => vi.useRealTimers());

	it("excludes future samples from rolling monitor statistics", async () => {
		await insertLog("up", 100, "2026-10-26T12:00:00.000Z");
		await insertLog("down", 900, "2026-10-26T12:00:00.001Z");
		const stats = await getMonitorStats(monitorId, userId);
		expect(stats).toMatchObject({ totalChecks: 1, successfulChecks: 1, failedChecks: 0, uptimePercentage: 100, avgResponseTime: 100 });
	});

	it("combines complete UTC days with exact rolling-window edges without double counting", async () => {
		await insertLog("down", null, "2026-10-23T11:59:59.999Z");
		await insertLog("up", 100, "2026-10-23T12:00:00.000Z");
		await insertLog("down", null, "2026-10-23T23:59:59.999Z");
		await insertLog("degraded", 200, "2026-10-24T00:00:00.000Z");
		await insertLog("up", 100, "2026-10-25T23:59:59.999Z");
		await insertLog("down", null, "2026-10-26T00:00:00.000Z");
		await insertLog("up", 100, "2026-10-26T12:00:00.000Z");
		await insertLog("down", null, "2026-10-26T12:00:00.001Z");

		const aggregates = await getOwnedUptimeAggregates(userId, 3);
		expect(aggregates.size).toBe(1);
		expect(aggregates.get(monitorId)).toEqual({
			uptimeChecks: 6,
			successfulChecks: 3,
			degradedChecks: 1,
			uptimePercentage: 50,
			availabilityPercentage: 66.67,
			slowPercentage: 16.67,
		});
	});

	it("counts a short rolling window within one UTC day", async () => {
		await insertLog("down", null, "2026-10-26T05:59:59.999Z");
		await insertLog("degraded", 100, "2026-10-26T06:00:00.000Z");
		await insertLog("up", 100, "2026-10-26T12:00:00.000Z");
		expect((await getOwnedUptimeAggregates(userId, 0.25)).get(monitorId)).toEqual({
			uptimeChecks: 2,
			successfulChecks: 1,
			degradedChecks: 1,
			uptimePercentage: 50,
			availabilityPercentage: 100,
			slowPercentage: 50,
		});
	});

	it("omits unobserved, stale and future-only monitors while retaining genuine zero uptime", async () => {
		expect((await getOwnedUptimeAggregates(userId)).size).toBe(0);
		await insertLog("up", 100, "2026-09-01T00:00:00.000Z");
		await insertLog("up", 100, "2026-10-27T00:00:00.000Z");
		expect((await getOwnedUptimeAggregates(userId)).size).toBe(0);
		await insertLog("down", null, "2026-10-25T12:00:00.000Z");
		expect((await getOwnedUptimeAggregates(userId)).get(monitorId)).toEqual({
			uptimeChecks: 1,
			successfulChecks: 0,
			degradedChecks: 0,
			uptimePercentage: 0,
			availabilityPercentage: 0,
			slowPercentage: 0,
		});
	});

	it("keeps complete-day aggregates consistent after corrections, date moves and deletion", async () => {
		await insertLog("up", 100, "2026-10-24T12:00:00.000Z");
		await insertLog("up", 100, "2026-10-25T12:00:00.000Z");
		expect((await getOwnedUptimeAggregates(userId, 3)).get(monitorId)?.uptimePercentage).toBe(100);
		await db.update(uptimeCheckLog).set({ status: "degraded" })
			.where(eq(uptimeCheckLog.uptimeMonitorId, monitorId));
		expect((await getOwnedUptimeAggregates(userId, 3)).get(monitorId)).toMatchObject({
			uptimeChecks: 2, successfulChecks: 0, degradedChecks: 2,
			uptimePercentage: 0, availabilityPercentage: 100, slowPercentage: 100,
		});
		await db.update(uptimeCheckLog).set({ createdAt: "2026-10-20T12:00:00.000Z" })
			.where(eq(uptimeCheckLog.uptimeMonitorId, monitorId));
		expect((await getOwnedUptimeAggregates(userId, 3)).size).toBe(0);
		expect((await getOwnedUptimeAggregates(userId, 30)).get(monitorId)?.uptimeChecks).toBe(2);
		await db.delete(uptimeCheckLog).where(eq(uptimeCheckLog.uptimeMonitorId, monitorId));
		expect((await getOwnedUptimeAggregates(userId)).size).toBe(0);
	});

	it("restricts both complete-day and partial-day checks to the owner and requested monitor ids", async () => {
		await insertLog("up", 100, "2026-10-24T12:00:00.000Z");
		await insertLog("up", 100, "2026-10-26T11:00:00.000Z");
		const second = await createTestMonitor(userId);
		const other = await createTestUser();
		const foreign = await createTestMonitor(other.id);
		await db.insert(uptimeCheckLog).values([
			{ uptimeMonitorId: second.uptimeMonitorId, status: "down", createdAt: "2026-10-25T12:00:00.000Z" },
			{ uptimeMonitorId: foreign.uptimeMonitorId, status: "down", createdAt: "2026-10-24T12:00:00.000Z" },
			{ uptimeMonitorId: foreign.uptimeMonitorId, status: "down", createdAt: "2026-10-26T11:00:00.000Z" },
		]);
		expect([...(await getOwnedUptimeAggregates(userId)).keys()].sort()).toEqual([monitorId, second.uptimeMonitorId].sort());
		const selected = await getOwnedUptimeAggregates(userId, 30, [monitorId, foreign.uptimeMonitorId]);
		expect([...selected.keys()]).toEqual([monitorId]);
		expect(selected.get(monitorId)?.uptimeChecks).toBe(2);
		expect((await getOwnedUptimeAggregates(other.id, 30, [monitorId])).size).toBe(0);
		expect((await getOwnedUptimeAggregates(userId, 30, [])).size).toBe(0);
		expect((await getOwnedUptimeAggregates(userId, 30, ["missing"])).size).toBe(0);
	});
});

describe("getUptimeBarData", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z"));
	});
	afterEach(() => vi.useRealTimers());

	it("returns exactly the requested UTC dates and leaves unobserved days unknown", async () => {
		expect(await getUptimeBarData(monitorId, userId, 3)).toEqual([
			{ date: "2026-10-24", status: "unknown", uptimePercent: null, totalChecks: 0 },
			{ date: "2026-10-25", status: "unknown", uptimePercent: null, totalChecks: 0 },
			{ date: "2026-10-26", status: "unknown", uptimePercent: null, totalChecks: 0 },
		]);
	});

	it("classifies up, down, partial and degraded days from every recorded check", async () => {
		await db.insert(uptimeCheckLog).values([
			{ uptimeMonitorId: monitorId, status: "up", createdAt: "2026-10-21T12:00:00.000Z" },
			{ uptimeMonitorId: monitorId, status: "down", createdAt: "2026-10-22T12:00:00.000Z" },
			{ uptimeMonitorId: monitorId, status: "up", createdAt: "2026-10-23T12:00:00.000Z" },
			{ uptimeMonitorId: monitorId, status: "down", createdAt: "2026-10-23T13:00:00.000Z" },
			{ uptimeMonitorId: monitorId, status: "up", createdAt: "2026-10-24T12:00:00.000Z" },
			{ uptimeMonitorId: monitorId, status: "degraded", createdAt: "2026-10-24T13:00:00.000Z" },
			{ uptimeMonitorId: monitorId, status: "degraded", createdAt: "2026-10-25T12:00:00.000Z" },
			{ uptimeMonitorId: monitorId, status: "degraded", createdAt: "2026-10-26T11:00:00.000Z" },
			{ uptimeMonitorId: monitorId, status: "down", createdAt: "2026-10-26T12:00:00.000Z" },
		]);
		expect(await getUptimeBarData(monitorId, userId, 6)).toEqual([
			{ date: "2026-10-21", status: "up", uptimePercent: 100, totalChecks: 1 },
			{ date: "2026-10-22", status: "down", uptimePercent: 0, totalChecks: 1 },
			{ date: "2026-10-23", status: "partial", uptimePercent: 50, totalChecks: 2 },
			{ date: "2026-10-24", status: "degraded", uptimePercent: 50, totalChecks: 2 },
			{ date: "2026-10-25", status: "degraded", uptimePercent: 0, totalChecks: 1 },
			{ date: "2026-10-26", status: "down", uptimePercent: 0, totalChecks: 2 },
		]);
	});

	it("includes first-day midnight and now, excludes older and future checks and never caps coverage at 100 checks", async () => {
		await insertLog("up", 100, "2026-10-23T23:59:59.999Z");
		await db.insert(uptimeCheckLog).values(Array.from({ length: 120 }, () => ({
			uptimeMonitorId: monitorId, status: "down" as const, createdAt: "2026-10-24T00:00:00.000Z",
		})));
		await insertLog("down", null, "2026-10-26T00:00:00.000Z");
		await insertLog("down", null, "2026-10-26T12:00:00.000Z");
		await insertLog("up", 100, "2026-10-26T12:00:00.001Z");
		expect(await getUptimeBarData(monitorId, userId, 3)).toEqual([
			{ date: "2026-10-24", status: "down", uptimePercent: 0, totalChecks: 120 },
			{ date: "2026-10-25", status: "unknown", uptimePercent: null, totalChecks: 0 },
			{ date: "2026-10-26", status: "down", uptimePercent: 0, totalChecks: 2 },
		]);
	});

	it("does not disclose complete-day or current-day checks to a different owner", async () => {
		await insertLog("down", null, "2026-10-24T00:00:00.000Z");
		await insertLog("down", null, "2026-10-26T12:00:00.000Z");
		const other = await createTestUser();
		expect(await getUptimeBarData(monitorId, other.id, 3)).toEqual([
			{ date: "2026-10-24", status: "unknown", uptimePercent: null, totalChecks: 0 },
			{ date: "2026-10-25", status: "unknown", uptimePercent: null, totalChecks: 0 },
			{ date: "2026-10-26", status: "unknown", uptimePercent: null, totalChecks: 0 },
		]);
	});

	it.each([
		["2024-03-01T00:30:00.000Z", ["2024-02-28", "2024-02-29", "2024-03-01"]],
		["2026-11-02T00:30:00.000Z", ["2026-10-31", "2026-11-01", "2026-11-02"]],
	] as const)("uses UTC calendar buckets at leap and DST boundaries (%s)", async (now, dates) => {
		vi.setSystemTime(new Date(now));
		expect((await getUptimeBarData(monitorId, userId, 3)).map(entry => entry.date)).toEqual([...dates]);
	});
});

describe("incident report windows", () => {
	const since = "2026-10-01T00:00:00.000Z";
	const until = "2026-10-02T00:00:00.000Z";

	it("includes an incident crossing the start and clips downtime to the report window", async () => {
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: monitorId, status: "resolved",
			startedAt: "2026-09-30T23:00:00.000Z", resolvedAt: "2026-10-01T05:00:00.000Z", durationSeconds: 21_600,
		});
		expect(await getMonitorIncidentSummary(monitorId, userId, since, until)).toEqual({
			count: 1, totalDowntimeSeconds: 18_000, longestIncidentSeconds: 18_000,
		});
	});

	it("clips an incident resolved after the report end", async () => {
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: monitorId, status: "resolved",
			startedAt: "2026-10-01T23:00:00.000Z", resolvedAt: "2026-10-02T03:00:00.000Z", durationSeconds: 14_400,
		});
		expect(await getMonitorIncidentSummary(monitorId, userId, since, until)).toEqual({
			count: 1, totalDowntimeSeconds: 3600, longestIncidentSeconds: 3600,
		});
	});

	it("clips an ongoing incident that began before the report start", async () => {
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: monitorId, status: "ongoing", startedAt: "2026-09-30T12:00:00.000Z",
		});
		expect(await getMonitorIncidentSummary(monitorId, userId, since, until)).toEqual({
			count: 1, totalDowntimeSeconds: 86_400, longestIncidentSeconds: 86_400,
		});
	});

	it("returns ordered incident projections, omits nonoverlapping incidents and preserves stored in-window durations", async () => {
		const rows = await db.insert(uptimeIncident).values([
			{ uptimeMonitorId: monitorId, status: "resolved", startedAt: "2026-10-01T09:00:00.000Z", resolvedAt: "2026-10-01T09:01:00.000Z", durationSeconds: 45 },
			{ uptimeMonitorId: monitorId, status: "resolved", startedAt: "2026-09-30T23:00:00.000Z", resolvedAt: "2026-10-01T01:00:00.000Z", durationSeconds: 7200 },
			{ uptimeMonitorId: monitorId, status: "resolved", startedAt: "2026-09-29T00:00:00.000Z", resolvedAt: "2026-09-29T01:00:00.000Z", durationSeconds: 3600 },
			{ uptimeMonitorId: monitorId, status: "resolved", startedAt: "2026-10-03T00:00:00.000Z", resolvedAt: "2026-10-03T01:00:00.000Z", durationSeconds: 3600 },
		]).returning();
		const incidents = await getMonitorIncidentsForWindow(monitorId, userId, since, until);
		expect(incidents).toEqual([
			{ incidentId: rows[1]!.incidentId, status: "resolved", startedAt: "2026-09-30T23:00:00.000Z", resolvedAt: "2026-10-01T01:00:00.000Z", downtimeSeconds: 3600 },
			{ incidentId: rows[0]!.incidentId, status: "resolved", startedAt: "2026-10-01T09:00:00.000Z", resolvedAt: "2026-10-01T09:01:00.000Z", downtimeSeconds: 45 },
		]);
		expect(summarizeWindowIncidents(incidents)).toEqual({ count: 2, totalDowntimeSeconds: 3645, longestIncidentSeconds: 3600 });
		expect(await getMonitorIncidentSummary(monitorId, userId, since, until)).toEqual({ count: 2, totalDowntimeSeconds: 3645, longestIncidentSeconds: 3600 });
	});

	it("returns no incident projections or downtime to a different owner", async () => {
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: monitorId, status: "ongoing", startedAt: "2026-09-30T12:00:00.000Z",
		});
		const other = await createTestUser();
		expect(await getMonitorIncidentsForWindow(monitorId, other.id, since, until)).toEqual([]);
		expect(await getMonitorIncidentSummary(monitorId, other.id, since, until)).toEqual({ count: 0, totalDowntimeSeconds: 0, longestIncidentSeconds: 0 });
		expect(summarizeWindowIncidents([])).toEqual({ count: 0, totalDowntimeSeconds: 0, longestIncidentSeconds: 0 });
	});
});

type CheckStatus = "up" | "down" | "degraded";

async function insertLog(
	status: CheckStatus,
	responseTime: number | null,
	createdAt?: string,
): Promise<void> {
	await db.insert(uptimeCheckLog).values({
		uptimeMonitorId: monitorId,
		status,
		responseTime,
		httpStatus: status === "up" ? 200 : 503,
		...(createdAt ? { createdAt } : {}),
	});
}

function dayIso(daysAgo: number): string {
	return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

describe("getMonitorStats", () => {
	it("aggregates counts and response-time min/avg/max", async () => {
		await insertLog("up", 100);
		await insertLog("up", 300);
		await insertLog("down", null);

		const stats = await getMonitorStats(monitorId, userId);
		expect(stats.totalChecks).toBe(3);
		expect(stats.successfulChecks).toBe(2);
		expect(stats.failedChecks).toBe(1);
		expect(stats.minResponseTime).toBe(100);
		expect(stats.maxResponseTime).toBe(300);
		expect(stats.avgResponseTime).toBe(200);
		expect(stats.uptimePercentage).toBeCloseTo(66.67, 1);
	});

	it("keeps check success and timings unknown when there are no checks", async () => {
		const stats = await getMonitorStats(monitorId, userId);
		expect(stats.totalChecks).toBe(0);
		expect(stats.avgResponseTime).toBeNull();
		expect(stats.minResponseTime).toBeNull();
		expect(stats.maxResponseTime).toBeNull();
		expect(stats.p95ResponseTime).toBeNull();
		expect(stats.uptimePercentage).toBeNull();
	});

	it("distinguishes degraded checks from failures while counting both in check success", async () => {
		await insertLog("up", 100, dayIso(1));
		await insertLog("degraded", 300, dayIso(1));
		await insertLog("down", null, dayIso(1));
		const stats = await getMonitorStats(monitorId, userId);
		expect(stats).toMatchObject({
			totalChecks: 3, successfulChecks: 1, degradedChecks: 1, failedChecks: 1,
			uptimePercentage: 33.33, availabilityPercentage: 66.67, slowPercentage: 33.33,
		});
	});

	it("computes the p95 response time from the sorted samples", async () => {
		// 20 samples 10..200 → ceil(0.95*20)-1 = index 18 → 190.
		for (let i = 1; i <= 20; i++) await insertLog("up", i * 10);
		const stats = await getMonitorStats(monitorId, userId);
		expect(stats.p95ResponseTime).toBe(190);
	});
});

describe("getMonitorStatsForWindow", () => {
	it("only counts checks inside [since, until]", async () => {
		await insertLog("up", 100, dayIso(10));
		await insertLog("up", 100, dayIso(1));
		const stats = await getMonitorStatsForWindow(
			monitorId,
			userId,
			dayIso(5),
			dayIso(0),
		);
		expect(stats.totalChecks).toBe(1);
	});
});

describe("getMonitorDailyUptime", () => {
	it("returns one sorted entry per day with at least one check", async () => {
		await insertLog("up", 100, dayIso(2));
		await insertLog("up", 100, dayIso(1));
		await insertLog("down", null, dayIso(1));
		const series = await getMonitorDailyUptime(
			monitorId,
			userId,
			dayIso(3),
			dayIso(0),
		);
		expect(series).toHaveLength(2);
		// Ascending by date.
		expect(series[0]!.date < series[1]!.date).toBe(true);
		// The two-check day is 50% up.
		const day1 = series.find((d) => d.date === dayIso(1).slice(0, 10));
		expect(day1?.uptimePercentage).toBe(50);
		expect(day1?.totalChecks).toBe(2);
	});

	it("returns an empty series when the window has no checks", async () => {
		const series = await getMonitorDailyUptime(
			monitorId,
			userId,
			dayIso(3),
			dayIso(0),
		);
		expect(series).toEqual([]);
	});
});

describe("getMonitorIncidentSummary", () => {
	it("sums downtime and finds the longest within the window", async () => {
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: monitorId,
			status: "resolved",
			startedAt: dayIso(5),
			resolvedAt: dayIso(5),
			durationSeconds: 120,
		});
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: monitorId,
			status: "resolved",
			startedAt: dayIso(3),
			resolvedAt: dayIso(3),
			durationSeconds: 300,
		});
		const summary = await getMonitorIncidentSummary(
			monitorId,
			userId,
			dayIso(7),
			dayIso(0),
		);
		expect(summary.count).toBe(2);
		expect(summary.totalDowntimeSeconds).toBe(420);
		expect(summary.longestIncidentSeconds).toBe(300);
	});

	it("derives downtime for an ongoing incident from `until`", async () => {
		const until = dayIso(0);
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: monitorId,
			status: "ongoing",
			startedAt: dayIso(1),
			durationSeconds: null,
		});
		const summary = await getMonitorIncidentSummary(
			monitorId,
			userId,
			dayIso(2),
			until,
		);
		expect(summary.count).toBe(1);
		// ~1 day of downtime, derived from until - startedAt.
		expect(summary.totalDowntimeSeconds).toBeGreaterThan(80_000);
		expect(summary.longestIncidentSeconds).toBe(
			summary.totalDowntimeSeconds,
		);
	});

	it("excludes incidents that started outside the window", async () => {
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: monitorId,
			status: "resolved",
			startedAt: dayIso(30),
			resolvedAt: dayIso(30),
			durationSeconds: 60,
		});
		const summary = await getMonitorIncidentSummary(
			monitorId,
			userId,
			dayIso(7),
			dayIso(0),
		);
		expect(summary.count).toBe(0);
		expect(summary.totalDowntimeSeconds).toBe(0);
		expect(summary.longestIncidentSeconds).toBe(0);
	});
});

describe("getCheckLogs", () => {
	it("paginates and counts", async () => {
		for (let i = 0; i < 5; i++) await insertLog("up", 100);
		const page = await getCheckLogs(monitorId, userId, {
			limit: 2,
			offset: 1,
		});
		expect(page.total).toBe(5);
		expect(page.logs).toHaveLength(2);
	});

	it("filters by start and end date", async () => {
		await insertLog("up", 100, dayIso(10));
		await insertLog("up", 100, dayIso(1));
		const filtered = await getCheckLogs(monitorId, userId, {
			startDate: dayIso(5),
			endDate: dayIso(0),
		});
		expect(filtered.total).toBe(1);
	});

	it("returns no child rows or aggregates to a different owner", async () => {
		await insertLog("down", null, dayIso(1));
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: monitorId,
			status: "resolved",
			startedAt: dayIso(1),
			resolvedAt: dayIso(1),
			durationSeconds: 60,
		});
		const other = await createTestUser();

		const stats = await getMonitorStats(monitorId, other.id);
		expect(stats.totalChecks).toBe(0);
		expect((await getCheckLogs(monitorId, other.id)).total).toBe(0);
		expect(
			await getMonitorDailyUptime(
				monitorId,
				other.id,
				dayIso(2),
				dayIso(0),
			),
		).toEqual([]);
		expect(
			(
				await getMonitorIncidentSummary(
					monitorId,
					other.id,
					dayIso(2),
					dayIso(0),
				)
			).count,
		).toBe(0);
	});
});
