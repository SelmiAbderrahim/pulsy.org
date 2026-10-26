import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, uptimeMonitor, uptimeServer, uptimeIncident, uptimeStatusChange, uptimeCheckLog, type ServerSample } from "@pulsy/db";
import { createTestUser, createTestChannel, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { receiveServerSample } from "../server-health-service";
import { evaluateServerConditions, scanServerDeadlines, startServerHealthWorker, stopServerHealthWorker } from "../server-health-alerts";
import { scheduledJobs } from "node-schedule";
import { PUBLIC_WEB_URL } from "../../../lib/auth-config";
import { safeFetch } from "../../../lib/ssrf";
import { serverHealthNotice } from "../server-health-notice";
import * as notificationService from "../notification-service";
vi.mock("../../../lib/ssrf", () => ({ safeFetch: vi.fn(async () => new Response("ok", { status: 200 })), isEgressFilteringEnabled: () => false }));
vi.mock("../scheduler-service", () => ({ scheduleMonitorCheck: vi.fn(), cancelMonitorCheck: vi.fn(), rescheduleMonitorCheck: vi.fn() }));
useCleanDatabase();
beforeEach(() => { vi.mocked(safeFetch).mockClear(); });
afterEach(async () => { await stopServerHealthWorker(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const base = (at: Date, sequence: number, patch: Partial<ServerSample> = {}): ServerSample => ({ version: 1, bootId: "a811372b-61f5-444a-9cbe-9a1c651a8e49", sequence, sampledAt: at.toISOString(), agent: { version: "1.0.0", arch: "amd64" }, cpuPercent: 20, memoryPercent: 30, swapPercent: null, load: [0, 0, 0], uptimeSeconds: 100, filesystems: [{ path: "/", usedPercent: 50 }], ...patch });
async function fixture() {
  const owner = await createTestUser(), caller = authedCaller(owner), created = await caller.uptimeMonitor.server.create({ name: "Server" });
  let sequence = 0, now = new Date();
  const scope = and(eq(uptimeMonitor.userId, owner.id), eq(uptimeMonitor.uptimeMonitorId, created.monitor.uptimeMonitorId));
  const read = async () => (await db.select().from(uptimeMonitor).where(scope))[0]!;
  const report = async (patch: Partial<ServerSample> = {}) => { now = new Date(now.getTime() + 60000); const receipt = await receiveServerSample(created.token, base(now, ++sequence, patch), now); expect(receipt.outcome).toBe("accepted"); return read(); };
  return { owner, caller, ...created, monitorId: created.monitor.uptimeMonitorId, read, report, at: () => now, advance: (milliseconds: number) => { now = new Date(now.getTime() + milliseconds); } };
}
describe("persisted server conditions and direct notification delivery", () => {
  it("requires three violations and two healthy reports independently; missing metrics do not recover", async () => {
    const f = await fixture();
    expect((await f.report({ cpuPercent: 95, memoryPercent: 96 })).status).toBe("up");
    expect((await f.report({ cpuPercent: 95, memoryPercent: 96 })).status).toBe("up");
    expect((await f.report({ cpuPercent: 95, memoryPercent: 96 })).status).toBe("degraded");
    await f.report({ cpuPercent: 20, memoryPercent: 96 });
    expect((await f.report({ cpuPercent: 20, memoryPercent: 96 })).status).toBe("degraded");
    expect((await f.report({ memoryPercent: null })).status).toBe("degraded");
    expect((await f.report()).status).toBe("degraded");
    expect((await f.report()).status).toBe("up");
    const incidents = await db.select().from(uptimeIncident).where(eq(uptimeIncident.uptimeMonitorId, f.monitorId));
    expect(incidents).toHaveLength(1); expect(incidents[0]?.status).toBe("resolved");
    const [config] = await db.select().from(uptimeServer).where(eq(uptimeServer.userId, f.owner.id));
    expect(config?.conditions.every(condition => !condition.active)).toBe(true);
  });
  it("keeps new monitors pending, detects missing reports across worker invocations and needs two receipts to recover", async () => {
    const f = await fixture();
    await scanServerDeadlines(new Date(Date.now() + 86400000)); expect((await f.read()).status).toBe("pending");
    await f.report();
    await scanServerDeadlines(new Date(f.at().getTime() + 179999)); expect((await f.read()).status).toBe("up");
    await scanServerDeadlines(new Date(f.at().getTime() + 180000)); expect((await f.read()).status).toBe("down");
    await scanServerDeadlines(new Date(f.at().getTime() + 240000));
    expect(await db.select().from(uptimeIncident).where(eq(uptimeIncident.uptimeMonitorId, f.monitorId))).toHaveLength(1);
    // New receipts arrive after the latest deadline evaluation.
    f.advance(240000);
    expect((await f.report()).status).toBe("down");
    expect((await f.report()).status).toBe("up");
    await f.caller.uptimeMonitor.monitor.toggleActive({ uptimeMonitorId: f.monitorId });
    await scanServerDeadlines(new Date(f.at().getTime() + 86400000));
    expect((await f.report({ cpuPercent: 99, memoryPercent: 99 })).status).toBe("up");
    await f.caller.uptimeMonitor.monitor.toggleActive({ uptimeMonitorId: f.monitorId });
    expect((await f.read()).status).toBe("up");
  });
  it("ignores receipts older than a missing-report evaluation without rewinding conditions, rates or state", async () => {
    const f = await fixture(); await f.report(); const lastReceipt = f.at();
    const checkedAt = new Date(lastReceipt.getTime() + 180_000);
    await scanServerDeadlines(checkedAt);
    const [before] = await db.select().from(uptimeServer).where(eq(uptimeServer.monitorId, f.monitorId));
    const earlier = new Date(lastReceipt.getTime() + 120_000);
    expect(await receiveServerSample(f.token, base(earlier, 2), earlier)).toMatchObject({ statusCode: 200, outcome: "ignored" });
    expect((await db.select().from(uptimeServer).where(eq(uptimeServer.monitorId, f.monitorId)))[0]).toEqual(before);
    expect(await f.read()).toMatchObject({ status: "down", lastCheckedAt: checkedAt.toISOString() });
    expect(await db.select().from(uptimeCheckLog).where(eq(uptimeCheckLog.uptimeMonitorId, f.monitorId))).toHaveLength(2);
  });
  it("records cadence-bounded missing samples without inventing receipts or duplicate incidents", async () => {
    const f = await fixture(); await f.report(); const lastReceipt = f.at().toISOString();
    expect(await scanServerDeadlines(new Date(f.at().getTime() + 180_000))).toBe(1);
    expect(await scanServerDeadlines(new Date(f.at().getTime() + 239_999))).toBe(0);
    expect(await scanServerDeadlines(new Date(f.at().getTime() + 240_000))).toBe(1);
    const checks = await db.select().from(uptimeCheckLog).where(eq(uptimeCheckLog.uptimeMonitorId, f.monitorId));
    expect(checks).toHaveLength(3); expect(checks.filter(check => check.status === "down")).toHaveLength(2);
    expect(checks.every(check => check.responseTime === null && check.httpStatus === null)).toBe(true);
    expect(await db.select().from(uptimeIncident).where(eq(uptimeIncident.uptimeMonitorId, f.monitorId))).toHaveLength(1);
    expect(await db.select().from(uptimeStatusChange).where(and(eq(uptimeStatusChange.uptimeMonitorId, f.monitorId), eq(uptimeStatusChange.statusAfter, "down")))).toHaveLength(1);
    expect((await f.caller.uptimeMonitor.server.one({ monitorId: f.monitorId })).lastReceivedAt).toBe(lastReceipt);
  });
  it("drains initial worker scans on shutdown and re-registers without duplicating overdue transitions", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z"));
    const f = await fixture(); await f.report();
    vi.setSystemTime(new Date(f.at().getTime() + 180_000));
    const first = startServerHealthWorker(); const cancel = vi.spyOn(first!, "cancel");
    const second = startServerHealthWorker();
    expect(cancel).toHaveBeenCalledTimes(1); expect(scheduledJobs["uptime-server-deadlines"]).toBe(second);
    await stopServerHealthWorker();
    expect(scheduledJobs["uptime-server-deadlines"]).toBeUndefined();
    expect((await f.read()).status).toBe("down");
    expect(await db.select().from(uptimeIncident).where(eq(uptimeIncident.uptimeMonitorId, f.monitorId))).toHaveLength(1);
    expect((await f.caller.uptimeMonitor.server.one({ monitorId: f.monitorId })).lastReceivedAt).toBe(f.at().toISOString());
  });
  it("returns a committed pressure receipt while notification delivery is stalled", async () => {
    const f = await fixture();
    await f.report({ cpuPercent: 99 }); await f.report({ cpuPercent: 99 });
    let releaseDelivery!: () => void;
    const heldDelivery = new Promise<void>(resolve => { releaseDelivery = resolve; });
    const dispatch = vi.spyOn(notificationService, "dispatchNotifications").mockImplementation(() => heldDelivery);
    let returned = false;
    const receipt = f.report({ cpuPercent: 99 }).then(monitor => { returned = true; return monitor; });
    try {
      await vi.waitFor(() => expect(returned).toBe(true), { timeout: 1000 });
      expect((await receipt).status).toBe("degraded");
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(await db.select().from(uptimeIncident).where(eq(uptimeIncident.uptimeMonitorId, f.monitorId))).toHaveLength(1);
    } finally {
      releaseDelivery();
      await receipt;
      await heldDelivery;
    }
  });
  it("evaluates other missing deadlines and stops the worker while notification delivery is stalled", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z"));
    const first = await fixture(); const second = await fixture();
    await first.report(); await second.report();
    vi.setSystemTime(new Date(first.at().getTime() + 180_000));
    let releaseDelivery!: () => void;
    const heldDelivery = new Promise<void>(resolve => { releaseDelivery = resolve; });
    const dispatch = vi.spyOn(notificationService, "dispatchNotifications").mockImplementation(() => heldDelivery);
    startServerHealthWorker();
    let stopped = false;
    const stopping = stopServerHealthWorker().then(() => { stopped = true; });
    try {
      await vi.waitFor(() => expect(stopped).toBe(true), { timeout: 1000 });
      expect((await first.read()).status).toBe("down"); expect((await second.read()).status).toBe("down");
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(scheduledJobs["uptime-server-deadlines"]).toBeUndefined();
      expect(await db.select().from(uptimeIncident)).toHaveLength(2);
    } finally {
      releaseDelivery();
      await stopping;
      await heldDelivery;
    }
  });
  it("delivers one localized pressure notification and recovery after commit without contacting customers", async () => {
    const f = await fixture();
    await createTestChannel(f.monitorId, { channelType: "webhook", webhookUrl: "https://fixture.invalid/receiver", notifyOnDegraded: true, notifyOnRecovery: true });
    const committedStates: string[] = [];
    vi.mocked(safeFetch).mockImplementationOnce(async () => {
      committedStates.push((await f.read()).status);
      return new Response("ok", { status: 200 });
    });
    for (let i = 0; i < 3; i++) await f.report({ filesystems: [{ path: "/data", usedPercent: 97 }] });
    await vi.waitFor(() => expect(safeFetch).toHaveBeenCalledTimes(1));
    expect(committedStates).toEqual(["degraded"]);
    const payload = JSON.parse(String(vi.mocked(safeFetch).mock.calls[0]?.[1]?.body));
    expect(payload.reason).toContain("/data"); expect(payload.reason).toContain("97"); expect(payload.reason).toContain("90");
    for (let i = 0; i < 2; i++) await f.report({ filesystems: [{ path: "/data", usedPercent: 10 }] });
    await vi.waitFor(() => expect(safeFetch).toHaveBeenCalledTimes(2));
  });
  it("bounds mount churn and translates threshold reasons in every locale", () => {
    const config = { thresholds: { cpu: 90, memory: 90, disk: 90 }, excludedFilesystems: [], conditions: [] };
    const conditions = evaluateServerConditions(config, base(new Date(), 1)); expect(conditions).toHaveLength(3);
    for (const locale of ["en", "ar", "fr", "de", "es"]) {
      const notice = serverHealthNotice({ name: "<host>", uptimeMonitorId: "fixture" }, { statusAfter: "degraded", reason: `server_health:${JSON.stringify({ locale, status: "degraded", conditions: [{ key: "disk:/private", value: 96, threshold: 90 }] })}` });
      expect(notice.reason).toContain("/private"); expect(notice.reason).not.toContain("serverAlert."); expect(notice.html).not.toContain("<host>"); expect(notice.html).toContain(locale === "ar" ? 'dir="rtl"' : 'dir="ltr"');
    }
  });
  it("preserves active missing mounts, bounds churn and excludes only matching path prefixes", () => {
    const config = { thresholds: { cpu: 90, memory: 90, disk: 90 }, excludedFilesystems: ["/data"], conditions: Array.from({ length: 64 }, (_, i) => ({ key: `disk:/old-${i}`, active: true, violating: 3, healthy: 0, value: 95, threshold: 90 })) };
    const conditions = evaluateServerConditions(config, base(new Date(), 1, { filesystems: Array.from({ length: 64 }, (_, i) => ({ path: `/new-${i}`, usedPercent: 10 })) }));
    expect(conditions).toHaveLength(66); expect(conditions.filter(condition => condition.key.startsWith("disk:")).every(condition => condition.active && condition.value === null)).toBe(true);
    const filtered = evaluateServerConditions({ ...config, conditions: [] }, base(new Date(), 1, { filesystems: [{ path: "/data", usedPercent: 99 }, { path: "/data/child", usedPercent: 99 }, { path: "/database", usedPercent: 99 }] }));
    expect(filtered.map(condition => condition.key)).toEqual(["cpu", "memory", "disk:/database"]);
  });
  it("resets consecutive streaks on unknown readings and threshold edits without clearing active pressure", () => {
    const config = { thresholds: { cpu: 90, memory: 90, disk: 90 }, excludedFilesystems: [], conditions: [{ key: "cpu", active: true, violating: 3, healthy: 1, value: 20, threshold: 90 }] };
    expect(evaluateServerConditions(config, base(new Date(), 1, { cpuPercent: null }))[0]).toMatchObject({ active: true, violating: 0, healthy: 0 });
    expect(evaluateServerConditions({ ...config, thresholds: { ...config.thresholds, cpu: 80 } }, base(new Date(), 1, { cpuPercent: 20 }))[0]).toMatchObject({ active: true, violating: 0, healthy: 1, threshold: 80 });
  });
  it("links escaped notices to PUBLIC_WEB_URL and never exposes malformed historical reasons", () => {
    const notice = serverHealthNotice({ name: "<host>", uptimeMonitorId: "host id" }, { statusAfter: "down", reason: "server_health:{broken private-token" });
    expect(notice.html).toContain(new URL("/dashboard/uptime/host%20id", PUBLIC_WEB_URL).href);
    expect(notice.html).toContain("&lt;host&gt;"); expect(notice.html).not.toContain("private-token");
    expect(notice.reason).not.toContain("serverAlert."); expect(notice.subject).not.toContain("serverAlert.");
  });
});
