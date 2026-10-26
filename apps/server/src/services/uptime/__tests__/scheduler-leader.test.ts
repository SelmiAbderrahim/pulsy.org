import { scheduledJobs } from "node-schedule";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeMonitor } from "@pulsy/db";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { startSchedulerLeadership, type SchedulerLeadership } from "../scheduler-leader";
import { cancelAllMonitorChecks, reconcileScheduledMonitors, scheduleMonitorCheck, setSchedulingEnabled } from "../scheduler-service";

useCleanDatabase();

const started: SchedulerLeadership[] = [];
function leader(retryMs = 40) {
	const events: string[] = [];
	const handle = startSchedulerLeadership({ retryMs, onElected: () => void events.push("elected"), onLost: () => void events.push("lost") });
	started.push(handle);
	return { handle, events };
}
const until = async (condition: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!condition() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); };

afterEach(async () => {
	while (started.length) await started.pop()!.stop();
	cancelAllMonitorChecks();
	setSchedulingEnabled(true);
});

describe("scheduler leader election", () => {
	it("a lone process is elected and releases leadership on stop", async () => {
		const a = leader();
		await until(() => a.handle.isLeader());
		expect(a.handle.isLeader()).toBe(true);
		expect(a.events).toEqual(["elected"]);
		await a.handle.stop();
		expect(a.handle.isLeader()).toBe(false);
		expect(a.events).toEqual(["elected", "lost"]);
	});

	it("only one of two replicas leads, and the other takes over when the leader goes away", async () => {
		const first = leader();
		await until(() => first.handle.isLeader());
		const second = leader();
		await new Promise((r) => setTimeout(r, 200)); // several retry ticks
		expect([first.handle.isLeader(), second.handle.isLeader()]).toEqual([true, false]);
		expect(second.events).toEqual([]);
		await first.handle.stop(); // closes the lock-holding connection
		await until(() => second.handle.isLeader());
		expect(second.handle.isLeader()).toBe(true);
		expect(second.events).toEqual(["elected"]);
	});

	it("a crashed leader session (connection killed) never leaves two leaders or none", async () => {
		const first = leader(); await until(() => first.handle.isLeader());
		const second = leader();
		await new Promise((r) => setTimeout(r, 120));
		// Terminate the database session that holds the advisory lock, as a network drop or DB restart would.
		await db.execute(sql`select pg_terminate_backend(pid) from pg_locks where locktype = 'advisory' and database = (select oid from pg_database where datname = current_database()) and objsubid = 1 and ((classid::bigint << 32) | objid::bigint) = 7450121004`);
		await until(() => first.handle.isLeader() !== second.handle.isLeader(), 4000);
		await new Promise((r) => setTimeout(r, 300)); // settle: ticks keep re-checking
		expect(first.handle.isLeader() !== second.handle.isLeader()).toBe(true); // exactly one
		const losses = first.events.filter((event) => event === "lost").length + second.events.filter((event) => event === "lost").length;
		const elections = first.events.filter((event) => event === "elected").length + second.events.filter((event) => event === "elected").length;
		expect(elections - losses).toBe(1); // every election beyond the survivor's was matched by a loss
	});

	it("keeps leading across many ticks without being re-elected", async () => {
		const a = leader(20);
		await until(() => a.handle.isLeader());
		await new Promise((r) => setTimeout(r, 250));
		expect(a.events).toEqual(["elected"]);
	});
});

describe("leader-side scheduling", () => {
	const jobFor = (id: string) => scheduledJobs[`uptime-${id}`];

	it("reconcile schedules active HTTP monitors, follows interval changes and pauses, and ignores heartbeats", async () => {
		const user = await createTestUser();
		const http = await createTestMonitor(user.id, { interval: 300 });
		const paused = await createTestMonitor(user.id, { active: false });
		const heartbeat = await createTestMonitor(user.id, { monitorType: "heartbeat" });
		expect(await reconcileScheduledMonitors()).toEqual({ scheduled: 1, cancelled: 0 });
		expect(jobFor(http.uptimeMonitorId)).toBeDefined();
		expect(jobFor(paused.uptimeMonitorId)).toBeUndefined();
		expect(jobFor(heartbeat.uptimeMonitorId)).toBeUndefined();
		expect(await reconcileScheduledMonitors()).toEqual({ scheduled: 0, cancelled: 0 }); // steady state: no churn

		// Edited through another replica: interval changed in the database only.
		await db.update(uptimeMonitor).set({ interval: 60 }).where(eq(uptimeMonitor.uptimeMonitorId, http.uptimeMonitorId));
		expect(await reconcileScheduledMonitors()).toEqual({ scheduled: 1, cancelled: 0 });
		// Paused through another replica.
		await db.update(uptimeMonitor).set({ active: false }).where(eq(uptimeMonitor.uptimeMonitorId, http.uptimeMonitorId));
		expect(await reconcileScheduledMonitors()).toEqual({ scheduled: 0, cancelled: 1 });
		expect(jobFor(http.uptimeMonitorId)).toBeUndefined();
	});

	it("a follower schedules nothing, and a monitor created there is picked up once it leads", async () => {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id);
		setSchedulingEnabled(false);
		scheduleMonitorCheck(monitor);
		expect(jobFor(monitor.uptimeMonitorId)).toBeUndefined();
		expect(await reconcileScheduledMonitors()).toEqual({ scheduled: 0, cancelled: 0 });
		setSchedulingEnabled(true);
		expect(await reconcileScheduledMonitors()).toEqual({ scheduled: 1, cancelled: 0 });
		expect(jobFor(monitor.uptimeMonitorId)).toBeDefined();
	});

	it("losing leadership cancels every per-monitor job", async () => {
		const user = await createTestUser();
		const a = await createTestMonitor(user.id);
		const b = await createTestMonitor(user.id);
		await reconcileScheduledMonitors();
		expect([jobFor(a.uptimeMonitorId), jobFor(b.uptimeMonitorId)].every(Boolean)).toBe(true);
		cancelAllMonitorChecks();
		expect([jobFor(a.uptimeMonitorId), jobFor(b.uptimeMonitorId)].some(Boolean)).toBe(false);
		vi.restoreAllMocks();
	});
});
