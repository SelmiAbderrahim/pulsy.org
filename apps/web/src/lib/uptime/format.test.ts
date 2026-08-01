import { describe, expect, it } from "vitest";
import type { UptimeMonitor } from "@/types/uptime";
import {
	compareMonitors,
	formatRelativeTime,
	responseTimeTone,
} from "./format";

function monitor(overrides: Partial<UptimeMonitor>): UptimeMonitor {
	return {
		uptimeMonitorId: "id",
		name: "Monitor",
		url: "https://example.com",
		method: "GET",
		expectedStatus: 200,
		timeout: 10000,
		interval: 300,
		active: true,
		status: "up",
		httpStatus: null,
		responseTime: null,
		lastCheckedAt: null,
		nextCheckAt: null,
		tlsExpiresAt: null,
		tlsExpiresInDays: null,
		consecutiveFailures: 0,
		failureThreshold: 3,
		uptimePercentage: null,
		tags: [],
		isPublic: false,
		statusPageTitle: null,
		statusPageDescription: null,
		userId: "user",
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	} as UptimeMonitor;
}

function sortIds(
	monitors: UptimeMonitor[],
	sort?: Parameters<typeof compareMonitors>[2],
	dir?: Parameters<typeof compareMonitors>[3],
): string[] {
	return [...monitors]
		.sort((a, b) => compareMonitors(a, b, sort, dir))
		.map((m) => m.uptimeMonitorId);
}

describe("compareMonitors()", () => {
	it("default sort pins worst health to the top, tie-broken by name", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "up", status: "up", name: "b" }),
			monitor({ uptimeMonitorId: "pending", status: "pending", name: "a" }),
			monitor({ uptimeMonitorId: "down", status: "down", name: "z" }),
			monitor({ uptimeMonitorId: "degraded", status: "degraded", name: "m" }),
		];
		expect(sortIds(monitors)).toEqual(["down", "degraded", "pending", "up"]);
	});

	it("default sort tie-breaks equal statuses by name", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "2", status: "up", name: "Beta" }),
			monitor({ uptimeMonitorId: "1", status: "up", name: "Alpha" }),
		];
		expect(sortIds(monitors)).toEqual(["1", "2"]);
	});

	it("treats unknown statuses as the pending tier", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "unknown", status: "mystery" as never, name: "a" }),
			monitor({ uptimeMonitorId: "pending", status: "pending", name: "b" }),
			monitor({ uptimeMonitorId: "down", status: "down", name: "c" }),
		];
		// unknown & pending share rank 2 → ordered by name (a before b); down first.
		expect(sortIds(monitors)).toEqual(["down", "unknown", "pending"]);
	});

	it("sorts by name honoring direction", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "b", name: "Beta" }),
			monitor({ uptimeMonitorId: "a", name: "Alpha" }),
		];
		expect(sortIds(monitors, "name", "asc")).toEqual(["a", "b"]);
		expect(sortIds(monitors, "name", "desc")).toEqual(["b", "a"]);
	});

	it("defaults direction to asc when omitted", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "b", name: "Beta" }),
			monitor({ uptimeMonitorId: "a", name: "Alpha" }),
		];
		expect(sortIds(monitors, "name")).toEqual(["a", "b"]);
	});

	it("sorts by status column honoring direction", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "up", status: "up", name: "a" }),
			monitor({ uptimeMonitorId: "down", status: "down", name: "b" }),
		];
		expect(sortIds(monitors, "status", "asc")).toEqual(["down", "up"]);
		expect(sortIds(monitors, "status", "desc")).toEqual(["up", "down"]);
	});

	it("sorts by response time, nulls last in both directions", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "slow", responseTime: 900 }),
			monitor({ uptimeMonitorId: "none", responseTime: null }),
			monitor({ uptimeMonitorId: "fast", responseTime: 20 }),
		];
		expect(sortIds(monitors, "response", "asc")).toEqual(["fast", "slow", "none"]);
		expect(sortIds(monitors, "response", "desc")).toEqual(["slow", "fast", "none"]);
	});

	it("keeps both-null response comparisons stable", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "1", responseTime: null }),
			monitor({ uptimeMonitorId: "2", responseTime: null }),
		];
		expect(sortIds(monitors, "response", "asc")).toEqual(["1", "2"]);
	});

	it("sorts by uptime, nulls last in both directions", () => {
		const monitors = [
			monitor({ uptimeMonitorId: "mid", uptimePercentage: 95 }),
			monitor({ uptimeMonitorId: "none", uptimePercentage: null }),
			monitor({ uptimeMonitorId: "high", uptimePercentage: 99.9 }),
		];
		expect(sortIds(monitors, "uptime", "asc")).toEqual(["mid", "high", "none"]);
		expect(sortIds(monitors, "uptime", "desc")).toEqual(["high", "mid", "none"]);
	});
});

describe("responseTimeTone()", () => {
	it("returns null for no measurement", () => {
		expect(responseTimeTone(null)).toBeNull();
	});
	it("buckets by threshold", () => {
		expect(responseTimeTone(0)).toBe("good");
		expect(responseTimeTone(299)).toBe("good");
		expect(responseTimeTone(300)).toBe("warn");
		expect(responseTimeTone(999)).toBe("warn");
		expect(responseTimeTone(1000)).toBe("bad");
		expect(responseTimeTone(5000)).toBe("bad");
	});
});

describe("formatRelativeTime()", () => {
	const now = new Date("2026-07-01T12:00:00.000Z").getTime();

	it("returns em dash for null or invalid input", () => {
		expect(formatRelativeTime(null, "en", now)).toBe("—");
		expect(formatRelativeTime("not-a-date", "en", now)).toBe("—");
	});

	it("formats seconds, minutes, hours, and days ago", () => {
		expect(formatRelativeTime("2026-07-01T11:59:55.000Z", "en", now)).toContain(
			"second",
		);
		expect(formatRelativeTime("2026-07-01T11:55:00.000Z", "en", now)).toContain(
			"minute",
		);
		expect(formatRelativeTime("2026-07-01T09:00:00.000Z", "en", now)).toContain(
			"hour",
		);
		expect(formatRelativeTime("2026-06-28T12:00:00.000Z", "en", now)).toContain(
			"day",
		);
	});

	it("is locale aware", () => {
		// French for "minute(s)" contains "minute" too; assert it differs from en 'ago'.
		const fr = formatRelativeTime("2026-07-01T11:55:00.000Z", "fr", now);
		expect(fr).not.toContain("ago");
	});
});
