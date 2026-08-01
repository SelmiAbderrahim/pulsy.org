import { beforeEach, describe, expect, it } from "vitest";
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
	getMonitorStats,
	getMonitorStatsForWindow,
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

	it("returns nulls and 100% when there are no checks", async () => {
		const stats = await getMonitorStats(monitorId, userId);
		expect(stats.totalChecks).toBe(0);
		expect(stats.avgResponseTime).toBeNull();
		expect(stats.minResponseTime).toBeNull();
		expect(stats.maxResponseTime).toBeNull();
		expect(stats.p95ResponseTime).toBeNull();
		expect(stats.uptimePercentage).toBe(100);
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
