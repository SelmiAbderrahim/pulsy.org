import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeMonitor, uptimeCheckLog, uptimeStatusChange, uptimeNotificationLog, uptimeMaintenance, uptimeDeferredAlert } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { createTestChannel, createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { dispatchNotifications } from "../notification-service";
import { runManualCheck } from "../monitor-operations";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("../scheduler-service", () => ({ scheduleMonitorCheck: vi.fn(), cancelMonitorCheck: vi.fn(), rescheduleMonitorCheck: vi.fn(), withMonitorCheckSlot: async <T,>(work: () => Promise<T>) => work() }));
useCleanDatabase();
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const service = await import("../maintenance-service").catch(() => null);
const at = "2026-10-09T10:00:00.000Z";
const window = { name: "Deployment", reason: "Private task", startsAt: at, endsAt: "2026-10-09T11:00:00.000Z", timezone: "Europe/Berlin", recurrence: "once" as const };

describe("durable maintenance and snooze", () => {
	it("edits only owned future schedules with conflict protection and unchanged membership", async () => {
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
		const owner = await createTestUser(); const other = await createTestUser(); const monitor = await createTestMonitor(owner.id);
		const caller = authedCaller(owner);
		const config = { ...window, startsAt: "2026-10-10T10:00:00.000Z", endsAt: "2026-10-10T11:00:00.000Z", recurrence: "daily" as const };
		const saved = await caller.uptimeMonitor.maintenance.create({ config, monitorIds: [monitor.uptimeMonitorId] });
		const input = { id: saved.id, config: { ...config, name: "Updated deployment" }, expected: config };
		await expect(authedCaller(other).uptimeMonitor.maintenance.update(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
		const results = await Promise.allSettled([caller.uptimeMonitor.maintenance.update(input), caller.uptimeMonitor.maintenance.update({ ...input, config: { ...config, name: "Other draft" } })]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
		const [current] = await caller.uptimeMonitor.maintenance.list();
		expect(current?.monitorIds).toEqual([monitor.uptimeMonitorId]);
		vi.setSystemTime(new Date(config.startsAt));
		await expect(caller.uptimeMonitor.maintenance.update({ id: saved.id, config, expected: { ...config, name: current!.name } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
	it("keeps cached calendars accurate after expiry, clock reversal, config edits and cancellation", () => {
		const scope = { ...window, id: "cached", userId: "owner", monitorIds: ["m"], kind: "maintenance" as const, enabled: true, createdAt: at, recurrence: "daily" as const };
		expect(service!.effectiveSuppression([scope], "m", new Date("2026-10-09T10:30:00Z"))?.until).toBe(window.endsAt);
		expect(service!.effectiveSuppression([scope], "m", new Date(window.endsAt))).toBeNull();
		expect(service!.effectiveSuppression([scope], "m", new Date("2026-10-10T10:30:00Z"))?.until).toBe("2026-10-10T11:00:00.000Z");
		expect(service!.effectiveSuppression([scope], "m", new Date("2026-10-09T10:30:00Z"))?.until).toBe(window.endsAt);
		expect(service!.effectiveSuppression([{ ...scope, enabled: false }], "m", new Date(at))).toBeNull();
		expect(service!.effectiveSuppression([{ ...scope, monitorIds: ["other"] }], "m", new Date(at))).toBeNull();
		expect(service!.effectiveSuppression([{ ...scope, endsAt: "2026-10-09T10:15:00Z" }], "m", new Date("2026-10-09T10:30:00Z"))).toBeNull();
		const preview = service!.previewMaintenance(scope, new Date("2026-10-10T11:00:00Z"));
		expect(preview).toHaveLength(5); expect(preview[0]?.startsAt).toBe("2026-10-11T10:00:00.000Z");
		expect(service!.effectiveSuppressions([scope], new Date(at)).get("m")).toEqual(service!.effectiveSuppression([scope], "m", new Date(at)));
	});
	it("rechecks suppression at the send boundary even for a resumed delivery", async () => {
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
		const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { status: "down" });
		await createTestChannel(monitor.uptimeMonitorId);
		await authedCaller(owner).uptimeMonitor.maintenance.create({ config: window, monitorIds: [monitor.uptimeMonitorId] });
		const [change] = await db.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down", createdAt: at }).returning();
		const spy = vi.spyOn(globalThis, "fetch"); const suppressed = vi.fn();
		await dispatchNotifications(monitor, change!, { resumeSuppressed: true, onSuppressed: suppressed });
		expect(spy).not.toHaveBeenCalled(); expect(suppressed).toHaveBeenCalledOnce();
		expect(await db.select().from(uptimeNotificationLog)).toHaveLength(0);
	});
	it("bounds concurrent schedule creation without counting expired schedules", async () => {
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
		const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id);
		await db.insert(uptimeMaintenance).values(Array.from({ length: 199 }, () => ({ ...window, userId: owner.id, monitorIds: [monitor.uptimeMonitorId] })));
		await db.insert(uptimeMaintenance).values({ ...window, startsAt: "2026-10-08T10:00:00Z", endsAt: "2026-10-08T11:00:00Z", userId: owner.id, monitorIds: [monitor.uptimeMonitorId] });
		const caller = authedCaller(owner);
		const results = await Promise.allSettled(Array.from({ length: 4 }, () => caller.uptimeMonitor.maintenance.create({ config: window, monitorIds: [monitor.uptimeMonitorId] })));
		expect(results.filter(value => value.status === "fulfilled")).toHaveLength(1);
		expect(await service!.loadMaintenance(owner.id)).toHaveLength(200);
	});
	it("keeps only minimal current-outage provenance beyond operational retention", async () => {
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
		const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { status: "down", notificationOutageId: "current" });
		const snapshot = { statusChangeId: "current", uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down", httpStatus: 500, responseTime: 120, reason: "Old transition reason", createdAt: at, webhookBodies: { fixture: "Old delivery bytes" } };
		await db.insert(uptimeDeferredAlert).values(["current", "old"].map(statusChangeId => ({ userId: owner.id, monitorId: monitor.uptimeMonitorId, statusChangeId, snapshot: { ...snapshot, statusChangeId }, state: "failed" as const, suppressionIds: ["window"], dueAt: at, createdAt: at, finishedTargets: ["failed"], deliveredTargets: [] })));
		vi.setSystemTime(new Date("2026-12-10T00:00:00Z"));
		await service!.cleanupMaintenanceHistory(30);
		const jobs = await db.select().from(uptimeDeferredAlert);
		expect(jobs).toHaveLength(1); expect(jobs[0]?.historyPruned).toBe(true); expect(jobs[0]?.snapshot.reason).toBeNull(); expect(jobs[0]?.snapshot).not.toHaveProperty("webhookBodies");
		expect(await service!.recoveryDeliveryTargets(monitor, "2026-12-10T01:00:00Z")).toEqual([]);
		await db.update(uptimeMonitor).set({ notificationOutageId: "new" }).where(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId));
		await service!.cleanupMaintenanceHistory(30);
		expect(await db.select().from(uptimeDeferredAlert)).toHaveLength(0);
	});
	it("rechecks later deliveries when a new window starts while an earlier job is sending", async () => {
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
		const owner = await createTestUser(); const caller = authedCaller(owner);
		const monitors = [await createTestMonitor(owner.id, { status: "down" }), await createTestMonitor(owner.id, { status: "down" })];
		for (const monitor of monitors) {
			await createTestChannel(monitor.uptimeMonitorId);
			await caller.uptimeMonitor.maintenance.create({ config: window, monitorIds: [monitor.uptimeMonitorId] });
			const [change] = await db.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down", createdAt: at }).returning();
			await dispatchNotifications(monitor, change!);
		}
		await caller.uptimeMonitor.maintenance.create({ config: { ...window, startsAt: "2026-10-09T11:01:00Z", endsAt: "2026-10-09T12:00:00Z" }, monitorIds: monitors.map(m => m.uptimeMonitorId) });
		vi.setSystemTime(new Date("2026-10-09T11:00:00Z"));
		const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
			vi.setSystemTime(new Date("2026-10-09T11:02:00Z")); return new Response("received");
		});
		await service!.resumeSuppressedNotifications();
		expect(spy).toHaveBeenCalledTimes(1);
		expect((await caller.uptimeMonitor.maintenance.deliveries()).filter(job => job.state === "pending")).toHaveLength(1);
	});
	it("keeps terminal target decisions when a different target audit cannot be written", async () => {
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
		const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { status: "down" });
		const permanent = await createTestChannel(monitor.uptimeMonitorId, { webhookUrl: "https://fixture.test/permanent" });
		await createTestChannel(monitor.uptimeMonitorId, { webhookUrl: "https://fixture.test/other" });
		const caller = authedCaller(owner);
		await caller.uptimeMonitor.maintenance.create({ config: window, monitorIds: [monitor.uptimeMonitorId] });
		const [change] = await db.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down", createdAt: at }).returning();
		await dispatchNotifications(monitor, change!);
		vi.setSystemTime(new Date("2026-10-09T11:00:00Z"));
		let failAudit = true;
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async url => {
			if (String(url).endsWith("/permanent")) return new Response("permanent", { status: 405 });
			await vi.waitFor(async () => expect(await db.query.uptimeNotificationLog.findFirst({ where: eq(uptimeNotificationLog.channelId, permanent.channelId) })).toBeDefined());
			return new Response("received");
		});
		await service!.resumeSuppressedNotifications({ onResult: result => {
			if (failAudit && !result.ok && !result.retryable) throw new Error("fixture interrupted batch after permanent audit commit");
		} });
		failAudit = false; vi.setSystemTime(new Date("2026-10-09T11:05:00Z"));
		await service!.resumeSuppressedNotifications();
		expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith("/permanent"))).toHaveLength(1);
	});
	it("never sends a recovery for an undelivered outage after disposable history expires", async () => {
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
		const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { status: "down" });
		await createTestChannel(monitor.uptimeMonitorId);
		await authedCaller(owner).uptimeMonitor.maintenance.create({ config: window, monitorIds: [monitor.uptimeMonitorId] });
		const [change] = await db.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down", createdAt: at }).returning();
		await dispatchNotifications(monitor, change!);
		await db.delete(uptimeStatusChange).where(eq(uptimeStatusChange.statusChangeId, change!.statusChangeId));
		const spy = vi.spyOn(globalThis, "fetch");
		await dispatchNotifications(monitor, { ...change!, statusBefore: "down", statusAfter: "up", createdAt: "2026-12-10T00:00:00Z" });
		expect(spy).not.toHaveBeenCalled();
	});
	it("sends recovery only to corresponding recipients that received the suppressed outage", async () => {
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
		const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { status: "down" });
		await createTestChannel(monitor.uptimeMonitorId, { webhookUrl: "https://fixture.test/received" });
		await createTestChannel(monitor.uptimeMonitorId, { webhookUrl: "https://fixture.test/failed" });
		await authedCaller(owner).uptimeMonitor.maintenance.create({ config: window, monitorIds: [monitor.uptimeMonitorId] });
		const [change] = await db.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down", createdAt: at }).returning();
		await dispatchNotifications(monitor, change!);
		vi.setSystemTime(new Date("2026-10-09T11:00:00Z"));
		const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async url => new Response("fixture", { status: String(url).endsWith("/failed") ? 405 : 200 }));
		await service!.resumeSuppressedNotifications();
		await db.delete(uptimeNotificationLog); // receipt provenance must survive log retention
		await createTestChannel(monitor.uptimeMonitorId, { webhookUrl: "https://fixture.test/new" });
		spy.mockClear();
		await dispatchNotifications(monitor, { ...change!, statusBefore: "down", statusAfter: "up", createdAt: "2026-10-09T11:10:00Z" });
		expect(spy.mock.calls.map(([url]) => String(url))).toEqual(["https://fixture.test/received"]);
	});
	it("excludes expired windows from the hot path and prunes terminal history with bounded provenance", async () => {
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
		const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { status: "down" });
		await authedCaller(owner).uptimeMonitor.maintenance.create({ config: window, monitorIds: [monitor.uptimeMonitorId] });
		vi.setSystemTime(new Date("2026-12-10T00:00:00Z"));
		expect(await service!.loadMaintenance(owner.id)).toHaveLength(0);
		const maintenanceService = service as typeof service & { cleanupMaintenanceHistory: (retentionDays: number) => Promise<void> };
		expect(maintenanceService!.cleanupMaintenanceHistory).toBeTypeOf("function");
		await maintenanceService!.cleanupMaintenanceHistory(30);
		expect(await db.select().from(uptimeMaintenance)).toHaveLength(0);
	});
	it("persists a newly suppressed retry instead of sending during a window that began in backoff", async () => {
		expect(service).not.toBeNull();
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
		const owner = await createTestUser(); const caller = authedCaller(owner);
		const monitor = await createTestMonitor(owner.id, { status: "down" });
		await createTestChannel(monitor.uptimeMonitorId);
		const [change] = await db.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down", createdAt: at }).returning();
		const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("temporary", { status: 503 }));
		await dispatchNotifications(monitor, change!, { delaysMs: [1], sleep: async () => {
			await caller.uptimeMonitor.maintenance.create({ config: window, monitorIds: [monitor.uptimeMonitorId] });
		} });
		expect(spy).toHaveBeenCalledTimes(1);
		expect((await caller.uptimeMonitor.maintenance.deliveries())[0]?.state).toBe("pending");
	});
	it("receives one post-expiry alert at a local sink and retries only transient failed targets", async () => {
		expect(service).not.toBeNull();
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
		const receipts = new Map<string, number>();
		let transientFails = true;
		const sink = createServer((request, response) => {
			const path = request.url!; receipts.set(path, (receipts.get(path) ?? 0) + 1);
			request.resume(); response.statusCode = path === "/permanent" ? 405 : path === "/transient" && transientFails ? 503 : 200; response.end("fixture");
		});
		await new Promise<void>(resolve => sink.listen(0, "127.0.0.1", resolve));
		try {
			const owner = await createTestUser();
			const monitor = await createTestMonitor(owner.id, { status: "down" });
			for (const path of ["/received", "/transient", "/permanent"]) await createTestChannel(monitor.uptimeMonitorId, { webhookUrl: `http://127.0.0.1:${(sink.address() as AddressInfo).port}${path}` });
			await authedCaller(owner).uptimeMonitor.maintenance.create({ config: window, monitorIds: [monitor.uptimeMonitorId] });
			const [change] = await db.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down", createdAt: at }).returning();
			await dispatchNotifications(monitor, change!);
			await dispatchNotifications(monitor, change!);
			expect(receipts.size).toBe(0);
			vi.setSystemTime(new Date("2026-10-09T11:00:00Z"));
			await Promise.all([service!.resumeSuppressedNotifications(), service!.resumeSuppressedNotifications()]);
			expect([...receipts.values()]).toEqual([1, 1, 1]);
			transientFails = false;
			vi.setSystemTime(new Date("2026-10-09T11:00:30Z"));
			await service!.resumeSuppressedNotifications();
			expect(receipts.get("/received")).toBe(1);
			expect(receipts.get("/permanent")).toBe(1);
			expect(receipts.get("/transient")).toBe(2);
			expect((await authedCaller(owner).uptimeMonitor.maintenance.deliveries())[0]?.state).toBe("failed");
			// Permanent target failure stays visible despite the other targets succeeding.
			expect(await db.select().from(uptimeNotificationLog)).toHaveLength(4);
		} finally { sink.closeAllConnections(); await new Promise<void>(resolve => sink.close(() => resolve())); }
	});

	it("resumes only selected snoozed monitors and forbids cross-account cancellation", async () => {
		expect(service).not.toBeNull();
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
		const owner = await createTestUser(); const caller = authedCaller(owner);
		const first = await createTestMonitor(owner.id); const second = await createTestMonitor(owner.id);
		const snooze = await caller.uptimeMonitor.maintenance.snooze({ monitorIds: [first.uptimeMonitorId, second.uptimeMonitorId], endsAt: window.endsAt });
		await expect(authedCaller(await createTestUser()).uptimeMonitor.maintenance.cancel({ id: snooze.id })).rejects.toThrow();
		await caller.uptimeMonitor.maintenance.resumeSnooze({ monitorIds: [first.uptimeMonitorId] });
		const list = await caller.uptimeMonitor.maintenance.list();
		expect(list[0]?.monitorIds).toEqual([second.uptimeMonitorId]);
		expect((await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: first.uptimeMonitorId })).alertSuppression).toBeNull();
		expect((await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: second.uptimeMonitorId })).alertSuppression?.until).toBe(window.endsAt);
	});

	it("keeps start inclusive/end exclusive and preserves weekly local time across the fall offset change", () => {
		expect(service).not.toBeNull();
		const times = service!.previewMaintenance({ ...window, startsAt: "2026-10-19T07:00:00.000Z", endsAt: "2026-10-19T08:00:00.000Z", recurrence: "weekly" }, new Date("2026-10-18T00:00:00Z"));
		expect(times.slice(0, 2).map(value => value.startsAt)).toEqual(["2026-10-19T07:00:00.000Z", "2026-10-26T08:00:00.000Z"]);
		const scope = { ...window, id: "w", userId: "u", monitorIds: ["m"], kind: "maintenance" as const, enabled: true, createdAt: at };
		expect(service!.effectiveSuppression([scope], "m", new Date(at))).not.toBeNull();
		expect(service!.effectiveSuppression([scope], "m", new Date(window.endsAt))).toBeNull();
	});
	it("previews timezone recurrence across DST without a custom cron parser", () => {
		expect(service).not.toBeNull();
		const times = service!.previewMaintenance({ ...window, startsAt: "2026-03-28T01:30:00.000Z", endsAt: "2026-03-28T02:30:00.000Z", recurrence: "daily" }, new Date("2026-03-28T00:00:00Z"));
		expect(times[0]?.startsAt).toBe("2026-03-28T01:30:00.000Z");
		// 02:30 local does not exist on the spring-forward day; skip it.
		expect(times[1]?.startsAt).toBe("2026-03-30T00:30:00.000Z");
		expect(times[1]?.endsAt).toBe("2026-03-30T01:30:00.000Z");
	});

	it("runs a daily local-time window exactly once per local day across both DST changes, never twice on the repeated fall-back hour", () => {
		expect(service).not.toBeNull();
		const localDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(iso));
		const localTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
		// 10:30 local is unambiguous: the occurrence list must stay on 10:30 local through the 2026-10-25 change.
		const autumn = service!.previewMaintenance({ ...window, startsAt: "2026-10-22T08:30:00.000Z", endsAt: "2026-10-22T09:30:00.000Z", recurrence: "daily" }, new Date("2026-10-22T00:00:00Z"));
		const days = autumn.slice(0, 5).map((value) => localDay(value.startsAt));
		expect(new Set(days).size).toBe(days.length);
		expect(days).toEqual(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"]);
		for (const value of autumn.slice(0, 5)) expect(localTime(value.startsAt)).toBe("10:30");
		// 02:30 local happens twice on 2026-10-25 (02:30 CEST then 02:30 CET): still only one window that day.
		const ambiguous = service!.previewMaintenance({ ...window, startsAt: "2026-10-22T00:30:00.000Z", endsAt: "2026-10-22T01:30:00.000Z", recurrence: "daily" }, new Date("2026-10-22T00:00:00Z"));
		const ambiguousDays = ambiguous.slice(0, 5).map((value) => localDay(value.startsAt));
		expect(ambiguousDays.filter((day) => day === "2026-10-25")).toHaveLength(1);
		expect(new Set(ambiguousDays).size).toBe(ambiguousDays.length);
		// Asked between the two 02:30s of that day, the repeat is not offered as an upcoming window.
		const between = service!.previewMaintenance({ ...window, startsAt: "2026-10-22T00:30:00.000Z", endsAt: "2026-10-22T01:30:00.000Z", recurrence: "daily" }, new Date("2026-10-25T01:40:00Z"));
		expect(between[0] && localDay(between[0].startsAt)).toBe("2026-10-26");
	});

	it("rejects another owner's selected monitors and invalid times before writing", async () => {
		const owner = await createTestUser();
		const foreign = await createTestMonitor((await createTestUser()).id);
		const caller = authedCaller(owner);
		await expect(caller.uptimeMonitor.maintenance.create({ config: window, monitorIds: [foreign.uptimeMonitorId] })).rejects.toThrow();
		await expect(caller.uptimeMonitor.maintenance.preview({ ...window, endsAt: at })).rejects.toThrow();
		await expect(caller.uptimeMonitor.maintenance.preview({ ...window, timezone: "invalid-zone" })).rejects.toThrow();
	});

	it("leaves measured checks and incidents intact and keeps suppression until the last overlap ends", async () => {
		expect(service).not.toBeNull();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(at));
		const owner = await createTestUser();
		const monitor = await createTestMonitor(owner.id, { status: "up", failureThreshold: 1 });
		await createTestChannel(monitor.uptimeMonitorId);
		const caller = authedCaller(owner);
		await caller.uptimeMonitor.maintenance.create({ config: window, monitorIds: [monitor.uptimeMonitorId] });
		await caller.uptimeMonitor.maintenance.snooze({ monitorIds: [monitor.uptimeMonitorId], endsAt: "2026-10-09T12:00:00.000Z", reason: "Personal snooze" });
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("failed", { status: 503 }));
		const checked = await runManualCheck(monitor);
		expect(checked.status).toBe("down");
		await vi.waitFor(async () => expect((await caller.uptimeMonitor.maintenance.deliveries()).length).toBe(1));
		expect(await db.select().from(uptimeCheckLog)).toHaveLength(1);
		expect(await db.select().from(uptimeNotificationLog)).toHaveLength(0);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		vi.setSystemTime(new Date("2026-10-09T11:00:00Z"));
		await service!.resumeSuppressedNotifications();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
		fetchSpy.mockResolvedValue(new Response("accepted", { status: 200 }));
		await service!.resumeSuppressedNotifications();
		await service!.resumeSuppressedNotifications();
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect((await db.select().from(uptimeNotificationLog))[0]?.outcome).toBe("sent");
		expect((await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId)))[0]?.status).toBe("down");
	});

	it("cancels a recovered suppressed outage without a false recovery alert", async () => {
		expect(service).not.toBeNull();
		vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
		const owner = await createTestUser();
		const monitor = await createTestMonitor(owner.id, { status: "down" });
		await createTestChannel(monitor.uptimeMonitorId);
		await authedCaller(owner).uptimeMonitor.maintenance.create({ config: window, monitorIds: [monitor.uptimeMonitorId] });
		const [down] = await db.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down", createdAt: at }).returning();
		await dispatchNotifications(monitor, down!);
		await db.update(uptimeMonitor).set({ status: "up" }).where(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId));
		const [up] = await db.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "down", statusAfter: "up", createdAt: "2026-10-09T10:30:00.000Z" }).returning();
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		await dispatchNotifications(monitor, up!);
		vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
		await service!.resumeSuppressedNotifications();
		expect(fetchSpy).not.toHaveBeenCalled();
		expect((await authedCaller(owner).uptimeMonitor.maintenance.deliveries())[0]?.state).toBe("cancelled");
	});
});
