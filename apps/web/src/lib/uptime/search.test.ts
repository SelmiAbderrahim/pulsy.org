import { describe, expect, it } from "vitest";
import type { UptimeMonitor } from "@/types/uptime";
import { filterMonitors } from "./search";

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

describe("filterMonitors()", () => {
	const monitors = [
		monitor({ uptimeMonitorId: "1", name: "Prod API", url: "https://api.example.com", tags: ["prod"] }),
		monitor({ uptimeMonitorId: "2", name: "Staging", url: "https://staging.example.com", tags: ["staging"] }),
		monitor({ uptimeMonitorId: "3", name: "Marketing", url: "https://example.com", tags: [] }),
	];

	it("returns all monitors for an empty or whitespace query", () => {
		expect(filterMonitors(monitors, "")).toHaveLength(3);
		expect(filterMonitors(monitors, "   ")).toHaveLength(3);
	});

	it("matches by name, case-insensitively", () => {
		const result = filterMonitors(monitors, "prod");
		expect(result.map((m) => m.uptimeMonitorId)).toEqual(["1"]);
		expect(filterMonitors(monitors, "MARKETING")).toHaveLength(1);
	});

	it("matches by url", () => {
		expect(filterMonitors(monitors, "staging.example")).toHaveLength(1);
	});

	it("matches by tag", () => {
		expect(filterMonitors(monitors, "staging").map((m) => m.uptimeMonitorId)).toContain("2");
	});

	it("returns an empty array when nothing matches", () => {
		expect(filterMonitors(monitors, "nonexistent")).toHaveLength(0);
	});

	it("tolerates monitors without tags", () => {
		const withoutTags = [monitor({ uptimeMonitorId: "4", name: "X", tags: undefined as unknown as string[] })];
		expect(filterMonitors(withoutTags, "zzz")).toHaveLength(0);
	});
});
