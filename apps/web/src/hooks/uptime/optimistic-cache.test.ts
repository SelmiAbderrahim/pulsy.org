import { describe, expect, it } from "vitest";
import { createTestQueryClient } from "@/test/query-wrapper";
import type { UptimeDashboardSummary, UptimeMonitor } from "@/types/uptime";
import { summarizeMonitors } from "@/lib/uptime/monitor-summary";
import { addCachedMonitors, changeCachedMonitors, removeCachedRows } from "./optimistic-cache";
import { uptimeKeys } from "./queryKeys";

function monitor(id: string, status: string, active = true): UptimeMonitor {
	return { uptimeMonitorId: id, name: id, status, active, responseTime: status === "up" ? 100 : null, uptimePercentage: status === "up" ? 100 : 0 } as unknown as UptimeMonitor;
}

const fleet = () => [monitor("a", "up"), monitor("b", "down"), monitor("c", "degraded"), monitor("d", "pending"), monitor("e", "up", false)];

function seed() {
	const client = createTestQueryClient();
	const rows = fleet();
	client.setQueryData(uptimeKeys.monitors.lists(), rows);
	client.setQueryData(uptimeKeys.dashboard.summary(), { ...summarizeMonitors(rows), activeMonitors: 4, avgResponseTime: 100 } as UptimeDashboardSummary);
	return client;
}
const list = (client: ReturnType<typeof seed>) => client.getQueryData<UptimeMonitor[]>(uptimeKeys.monitors.lists())!;
const summary = (client: ReturnType<typeof seed>) => client.getQueryData<UptimeDashboardSummary>(uptimeKeys.dashboard.summary())!;

describe("changeCachedMonitors", () => {
	it("moves the list and the dashboard counters together when rows are deleted", async () => {
		const client = seed();
		await changeCachedMonitors(client, ["a", "b"], () => null);
		expect(list(client).map(row => row.uptimeMonitorId)).toEqual(["c", "d", "e"]);
		expect(summary(client).totalMonitors).toBe(list(client).length);
		expect(summary(client)).toMatchObject({ monitorsUp: 0, monitorsDown: 0, monitorsDegraded: 1, monitorsPending: 1, monitorsPaused: 1 });
	});

	it("keeps the sum of states equal to Total after every step", async () => {
		const client = seed();
		for (const id of ["a", "b", "c", "d", "e"]) {
			await changeCachedMonitors(client, [id], () => null);
			const s = summary(client);
			expect(s.monitorsUp + s.monitorsDown + s.monitorsDegraded + s.monitorsPending + s.monitorsPaused).toBe(s.totalMonitors);
			expect(s.totalMonitors).toBe(list(client).length);
		}
	});

	it("restores only the failed ids and their counters when the undo is scoped", async () => {
		const client = seed();
		const undo = await changeCachedMonitors(client, ["a", "b", "c"], () => null);
		undo(["b"]);
		expect(list(client).map(row => row.uptimeMonitorId).sort()).toEqual(["b", "d", "e"]);
		expect(summary(client).totalMonitors).toBe(3);
		expect(summary(client).monitorsDown).toBe(1);
	});

	it("restores everything on a full rollback", async () => {
		const client = seed();
		const before = list(client).map(row => row.uptimeMonitorId).sort();
		const undo = await changeCachedMonitors(client, ["a", "b"], () => null);
		undo();
		expect(list(client).map(row => row.uptimeMonitorId).sort()).toEqual(before);
		expect(summary(client).totalMonitors).toBe(5);
	});

	it("counts a paused monitor as Paused, never as its last measured health", async () => {
		const client = seed();
		await changeCachedMonitors(client, ["a"], row => ({ ...row, active: false }));
		expect(summary(client)).toMatchObject({ monitorsUp: 0, monitorsPaused: 2, totalMonitors: 5 });
	});
});

describe("addCachedMonitors", () => {
	it("grows the list one step at a time without lagging the count, and ignores known ids", () => {
		const client = seed();
		addCachedMonitors(client, [monitor("f", "pending")]);
		expect(list(client)).toHaveLength(6);
		addCachedMonitors(client, [monitor("f", "pending")]);
		expect(list(client)).toHaveLength(6);
	});

	it("does nothing before the list has loaded", () => {
		const client = createTestQueryClient();
		addCachedMonitors(client, [monitor("f", "pending")]);
		expect(client.getQueryData(uptimeKeys.monitors.lists())).toBeUndefined();
	});
});

describe("removeCachedRows", () => {
	type Row = { id: string };
	const key = uptimeKeys.apiKeys.lists();

	it("hides matching rows at once and restores them on rollback", async () => {
		const client = createTestQueryClient();
		client.setQueryData<Row[]>(key, [{ id: "1" }, { id: "2" }]);
		const undo = await removeCachedRows<Row>(client, key, row => row.id === "1");
		expect(client.getQueryData(key)).toEqual([{ id: "2" }]);
		undo();
		expect((client.getQueryData<Row[]>(key) ?? []).map(row => row.id).sort()).toEqual(["1", "2"]);
	});
});
