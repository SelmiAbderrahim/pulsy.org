import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeDeferredAlert, uptimeMonitor, type LatencyPolicy } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { createTestUser, useCleanDatabase, storedMonitorSnapshot } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { performHttpCheck } from "../checker-service";
import { executeCheck } from "../scheduler-service";
import { createIncident } from "../incident-service";
import * as notificationService from "../notification-service";
import { resumeSuppressedNotifications } from "../maintenance-service";
vi.mock("../checker-service", async importActual => ({ ...await importActual<typeof import("../checker-service")>(), performHttpCheck: vi.fn() }));
vi.mock("../scheduler-service", async importActual => ({ ...await importActual<typeof import("../scheduler-service")>(), scheduleMonitorCheck: vi.fn(), rescheduleMonitorCheck: vi.fn(), cancelMonitorCheck: vi.fn() }));
vi.mock("../incident-service", async importActual => { const actual = await importActual<typeof import("../incident-service")>(); return { ...actual, createIncident: vi.fn(actual.createIncident) }; });
useCleanDatabase();
const fixtureWorkers = new Set<ChildProcess>();
afterEach(async () => {
  vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs();
  await Promise.all([...fixtureWorkers].map(child => new Promise<void>(resolve => {
    child.once("exit", () => resolve()); child.kill("SIGKILL");
  })));
});
async function freshDeliveryWorker(): Promise<void> {
  const script = 'import { resumeSuppressedNotifications } from "./src/services/uptime/maintenance-service.ts"; if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test")) throw new Error("Isolated fixture required"); resumeSuppressedNotifications().then(() => process.exit(0), () => process.exit(1));';
  await new Promise<void>((resolve, reject) => {
    // Boot the same installed tsx runtime directly, without pnpm/CLI wrapper processes.
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), env: process.env, stdio: "ignore" });
    fixtureWorkers.add(child);
    child.once("error", error => { fixtureWorkers.delete(child); reject(error); });
    child.once("exit", code => { fixtureWorkers.delete(child); code === 0 ? resolve() : reject(new Error(`Fresh delivery worker exited ${code}`)); });
  });
}
const policy = { thresholdMs: 200, slowCount: 1, recoveryThresholdMs: 150, recoveryCount: 1, importance: "critical" as const, cooldownSeconds: 60 };
function response(status: "up" | "down" | "degraded", responseTime: number) {
  vi.mocked(performHttpCheck).mockResolvedValue({ status, responseTime, httpStatus: status === "down" ? 503 : 200 });
}
async function sink(run: (url: string, events: string[], load: { current: number; peak: number }) => Promise<void>, latencyMs = 0, onFirstReceipt?: () => Promise<void>, failFirst = false, onReceipt?: (body: string, delivery: string) => void) {
  const events: string[] = []; const load = { current: 0, peak: 0 }; let attempts = 0;
  const server = createServer(async (request, reply) => {
    let body = ""; for await (const chunk of request) { body += String(chunk); if (body.length > 4096) throw new Error("Fixture payload limit"); }
    const payload: Record<string, unknown> = JSON.parse(body); attempts++;
    onReceipt?.(body, String(request.headers["x-pulsy-delivery"]));
    if (failFirst && attempts === 1) { reply.writeHead(503); reply.end("retry fixture"); return; }
    events.push(String(String(payload.event).replace("monitor.", "")));
    if (attempts === 1) await onFirstReceipt?.();
    load.current++; load.peak = Math.max(load.peak, load.current);
    await new Promise(resolve => setTimeout(resolve, latencyMs)); load.current--;
    reply.writeHead(200); reply.end("received");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture address");
  vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
  try { await run(`http://127.0.0.1:${address.port}/alerts`, events, load); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
async function configured(url: string, override: Partial<LatencyPolicy> = {}) {
  const owner = await createTestUser(); const caller = authedCaller(owner);
  const input = { name: "Delivery fixture", url: "http://fixture.invalid", failureThreshold: 1, latencyPolicy: { ...policy, ...override } };
  const monitor = await caller.uptimeMonitor.monitor.create(input);
  const channel = { uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook" as const, webhookUrl: url, notifyOnDegraded: true, notifyOnDown: true, notifyOnRecovery: true };
  const createdChannel = await caller.uptimeMonitor.channel.create(channel);
  return { monitor: { ...monitor, userId: owner.id }, caller, channel: createdChannel };
}
describe("durable operational delivery to a local sink", () => {
  it("retains both escalation receipt sets when the operating policy is disabled before recovery", async () => sink(async (url, events) => {
    const { monitor, caller, channel } = await configured(url, { cooldownSeconds: 0 });
    await caller.uptimeMonitor.channel.update({ channelId: channel.channelId, notifyOnDown: false });
    await caller.uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: `${url}?down-only`, notifyOnDown: true, notifyOnDegraded: false, notifyOnRecovery: true });
    response("up", 201); await executeCheck(monitor.uptimeMonitorId); await resumeSuppressedNotifications();
    response("down", 10); await executeCheck(monitor.uptimeMonitorId); await resumeSuppressedNotifications();
    expect(events).toEqual(["degraded", "down"]);
    await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: monitor.uptimeMonitorId, latencyPolicy: null });
    response("up", 100); await executeCheck(monitor.uptimeMonitorId); await resumeSuppressedNotifications();
    expect(events).toEqual(["degraded", "down", "up", "up"]);
  }));
  it("never reuses a recovered episode after legacy degradation and policy re-enablement", async () => sink(async (url, events) => {
    const { monitor, caller, channel } = await configured(url, { cooldownSeconds: 0 });
    response("down", 10); await executeCheck(monitor.uptimeMonitorId); await resumeSuppressedNotifications();
    const first = await storedMonitorSnapshot(monitor.uptimeMonitorId, monitor.userId);
    response("up", 100); await executeCheck(monitor.uptimeMonitorId); await resumeSuppressedNotifications();
    expect(events).toEqual(["down", "up"]);
    await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: monitor.uptimeMonitorId, latencyPolicy: null });
    response("degraded", 20); await executeCheck(monitor.uptimeMonitorId);
    await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: monitor.uptimeMonitorId, latencyPolicy: { ...policy, cooldownSeconds: 0 } });
    await caller.uptimeMonitor.channel.update({ channelId: channel.channelId, notifyOnDown: false });
    response("down", 10); await caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: monitor.uptimeMonitorId }); await resumeSuppressedNotifications();
    const second = await storedMonitorSnapshot(monitor.uptimeMonitorId, monitor.userId);
    expect(second.notificationOutageId).not.toBe(first.notificationOutageId);
    response("up", 100); await executeCheck(monitor.uptimeMonitorId); await resumeSuppressedNotifications();
    expect(events).toEqual(["down", "up"]);
    expect((await storedMonitorSnapshot(monitor.uptimeMonitorId, monitor.userId)).incidents).toHaveLength(2);
  }));
  it("honors an informational policy enabled while a legacy manual or scheduled probe is in flight", async () => sink(async (url, events) => {
    for (const manual of [false, true]) {
      const { monitor, caller } = await configured(url);
      await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: monitor.uptimeMonitorId, latencyPolicy: null });
      vi.mocked(performHttpCheck).mockImplementationOnce(async () => {
        await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: monitor.uptimeMonitorId, latencyPolicy: { ...policy, importance: "informational" } });
        return { status: "down", httpStatus: 503, responseTime: 10 };
      });
      if (manual) await caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: monitor.uptimeMonitorId });
      else await executeCheck(monitor.uptimeMonitorId);
      await resumeSuppressedNotifications();
      expect(events).toEqual([]);
      const jobs = await db.query.uptimeDeferredAlert.findMany({ where: eq(uptimeDeferredAlert.monitorId, monitor.uptimeMonitorId) });
      expect(jobs).toEqual([expect.objectContaining({ state: "cancelled", policyReason: "informational" })]);
    }
  }));
  it.each([false, true])("recovers delivered Degraded after a suppressed escalation (Down channel disabled: %s)", async disabled => sink(async (url, events) => {
    const { monitor, caller, channel } = await configured(url);
    if (disabled) await caller.uptimeMonitor.channel.update({ channelId: channel.channelId, notifyOnDown: false });
    response("up", 201); await executeCheck(monitor.uptimeMonitorId); await resumeSuppressedNotifications();
    expect(events).toEqual(["degraded"]);
    response("down", 10); await caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: monitor.uptimeMonitorId }); await resumeSuppressedNotifications();
    expect(events).toEqual(["degraded"]);
    response("up", 100); await executeCheck(monitor.uptimeMonitorId); await resumeSuppressedNotifications();
    expect(events).toEqual(["degraded", "up"]);
    const detail = await storedMonitorSnapshot(monitor.uptimeMonitorId, monitor.userId);
    expect(detail.incidents).toHaveLength(1); expect(detail.incidents[0]?.status).toBe("resolved");
  }));
  it("delivers degradation once, honors cooldown for Down, and emits only matched quiet recovery", async () => sink(async (url, events) => {
    vi.useFakeTimers({ toFake: ["Date"] }); const started = Date.now(); vi.setSystemTime(started);
    const { monitor } = await configured(url);
    response("up", 201); await executeCheck(monitor.uptimeMonitorId);
    expect(await db.query.uptimeDeferredAlert.findMany()).toHaveLength(1);
    expect(events).toEqual([]);
    await resumeSuppressedNotifications(); await resumeSuppressedNotifications(); expect(events).toEqual(["degraded"]);
    response("down", 20); await executeCheck(monitor.uptimeMonitorId);
    await resumeSuppressedNotifications(); expect(events).toEqual(["degraded"]);
    vi.setSystemTime(started + 60_000); await resumeSuppressedNotifications(); expect(events).toEqual(["degraded", "down"]);
    response("up", 150); await executeCheck(monitor.uptimeMonitorId);
    await resumeSuppressedNotifications(); await resumeSuppressedNotifications(); expect(events).toEqual(["degraded", "down", "up"]);
  }));
  it("keeps informational failures measured and records a durable non-paging decision", async () => sink(async (url, events) => {
    const { monitor } = await configured(url, { importance: "informational" });
    response("down", 10); await executeCheck(monitor.uptimeMonitorId);
    expect(await db.query.uptimeMonitor.findFirst({ where: eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId) })).toHaveProperty("status", "down");
    expect(await db.query.uptimeDeferredAlert.findMany()).toEqual([expect.objectContaining({ state: "cancelled" })]);
    await resumeSuppressedNotifications(); response("up", 150); await executeCheck(monitor.uptimeMonitorId); await resumeSuppressedNotifications(); expect(events).toEqual([]);
  }));
  it("defers degradation through maintenance, cancels an unannounced recovery and never invents a receipt", async () => sink(async (url, events) => {
    vi.useFakeTimers({ toFake: ["Date"] }); const started = Date.now(); vi.setSystemTime(started);
    const { monitor, caller } = await configured(url);
    await caller.uptimeMonitor.maintenance.snooze({ monitorIds: [monitor.uptimeMonitorId], endsAt: new Date(started + 30_000).toISOString(), reason: "private fixture" });
    response("up", 201); await executeCheck(monitor.uptimeMonitorId);
    expect(await db.query.uptimeDeferredAlert.findMany()).toEqual([expect.objectContaining({ state: "pending" })]);
    await resumeSuppressedNotifications(); expect(events).toEqual([]);
    response("up", 100); await executeCheck(monitor.uptimeMonitorId);
    vi.setSystemTime(started + 30_000); await resumeSuppressedNotifications(); expect(events).toEqual([]);
    expect((await db.query.uptimeDeferredAlert.findMany()).every(job => job.deliveredTargets.length === 0)).toBe(true);
    expect((await db.query.uptimeDeferredAlert.findMany()).find(job => job.snapshot.statusAfter === "up")).toHaveProperty("policyReason", "unannounced");
  }));
  it("bounds a twenty-channel fan-out while every eligible destination actually receives the event", async () => sink(async (url, events, load) => {
    const { monitor, caller } = await configured(url, { cooldownSeconds: 0 });
    for (let target = 1; target < 20; target++) {
      await caller.uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: `${url}?target=${target}` });
    }
    response("down", 10); await executeCheck(monitor.uptimeMonitorId); await resumeSuppressedNotifications();
    expect(events).toHaveLength(20); expect(load.peak).toBeLessThanOrEqual(4);
    expect((await db.query.uptimeDeferredAlert.findMany())[0]?.deliveredTargets).toHaveLength(20);
    console.log(JSON.stringify({ fixture: "20 local webhook channels with 100ms sink delay", accepted: events.length, peakConcurrency: load.peak }));
  }, 100));

  it("stops the remaining fan-out when a concurrent check recovers the monitor", async () => {
    let monitorId: string | undefined;
    await sink(async (url, events) => {
      const { monitor, caller } = await configured(url, { cooldownSeconds: 0 }); monitorId = monitor.uptimeMonitorId;
      for (let target = 1; target < 8; target++) await caller.uptimeMonitor.channel.create({ uptimeMonitorId: monitorId, channelType: "webhook", webhookUrl: `${url}?target=${target}` });
      response("down", 10); await executeCheck(monitorId); await resumeSuppressedNotifications();
      expect(events.length).toBeGreaterThan(0); expect(events.length).toBeLessThanOrEqual(4);
      const source = (await db.query.uptimeDeferredAlert.findMany()).find(job => job.snapshot.statusAfter === "down");
      expect(source).toMatchObject({ state: "cancelled", policyReason: "superseded" });
      expect(source?.deliveredTargets).toHaveLength(events.length);
    }, 20, async () => {
      response("up", 100); if (!monitorId) throw new Error("Missing fixture monitor"); await executeCheck(monitorId);
    });
  });

  it("resumes a persisted provider failure in a fresh worker process without replaying a successful target", async () => sink(async (url, events) => {
    const { monitor } = await configured(url, { cooldownSeconds: 0 });
    response("down", 10); await executeCheck(monitor.uptimeMonitorId); await resumeSuppressedNotifications();
    const [job] = await db.query.uptimeDeferredAlert.findMany();
    expect(job).toMatchObject({ state: "pending", attempts: 1, deliveredTargets: [] }); expect(events).toEqual([]);
    // Simulate reaching the retry deadline; exact clock boundaries have separate fixtures.
    await db.update(uptimeDeferredAlert).set({ dueAt: new Date(Date.now() - 1).toISOString() }).where(eq(uptimeDeferredAlert.id, job!.id));
    await freshDeliveryWorker(); expect(events).toEqual(["down"]);
    expect(await db.query.uptimeDeferredAlert.findFirst({ where: eq(uptimeDeferredAlert.id, job!.id) })).toMatchObject({ state: "sent", attempts: 2 });
    await freshDeliveryWorker(); expect(events).toEqual(["down"]);
  }, 0, undefined, true));

  it("freezes the exact webhook body across durable retries after a monitor rename", async () => {
    const receipts: Array<{ body: string; delivery: string }> = [];
    await sink(async (url) => {
      const { monitor, caller } = await configured(url, { cooldownSeconds: 0 });
      response("down", 10); await executeCheck(monitor.uptimeMonitorId); await resumeSuppressedNotifications();
      const [job] = await db.query.uptimeDeferredAlert.findMany();
      expect(job).toMatchObject({ state: "pending", attempts: 1 });
      expect(job?.snapshot.webhookBodies).toBeDefined();
      expect((await caller.uptimeMonitor.maintenance.deliveries())[0]?.snapshot).not.toHaveProperty("webhookBodies");
      await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: monitor.uptimeMonitorId, name: "Renamed while down" });
      await db.update(uptimeDeferredAlert).set({ dueAt: new Date(Date.now() - 1).toISOString() }).where(eq(uptimeDeferredAlert.id, job!.id));
      await freshDeliveryWorker();
      expect(receipts).toHaveLength(2);
      expect(receipts[1]).toEqual(receipts[0]);
    }, 0, undefined, true, (body, delivery) => { receipts.push({ body, delivery }); });
  });

  it.each(["pause", "recover"])("stops ordinary maintenance-deferred fan-out after %s", async action => {
    let changeDuringSend: (() => Promise<void>) | undefined;
    await sink(async (url, events) => {
      vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.now(); vi.setSystemTime(start);
      const { monitor, caller } = await configured(url);
      await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: monitor.uptimeMonitorId, latencyPolicy: null });
      for (let target = 1; target < 8; target++) await caller.uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: `${url}?target=${target}` });
      await caller.uptimeMonitor.maintenance.snooze({ monitorIds: [monitor.uptimeMonitorId], endsAt: new Date(start + 60_000).toISOString() });
      response("down", 10); await executeCheck(monitor.uptimeMonitorId);
      vi.setSystemTime(start + 60_000);
      changeDuringSend = async () => {
        if (action === "pause") await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: monitor.uptimeMonitorId, active: false });
        else { response("up", 100); await executeCheck(monitor.uptimeMonitorId); }
      };
      await resumeSuppressedNotifications();
      expect(events.filter(event => event === "down").length).toBeGreaterThan(0);
      expect(events.filter(event => event === "down").length).toBeLessThanOrEqual(4);
      if (action === "recover") {
        await resumeSuppressedNotifications();
        expect(events.filter(event => event === "up")).toHaveLength(events.filter(event => event === "down").length);
      }
    }, 20, async () => { await changeDuringSend?.(); });
  });

  it.each([false, true])("keeps the transactional queue decision across maintenance expiry (manual: %s)", async manual => sink(async (url, events) => {
    vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.now(); vi.setSystemTime(start);
    const { monitor, caller } = await configured(url);
    await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: monitor.uptimeMonitorId, latencyPolicy: null });
    await caller.uptimeMonitor.maintenance.snooze({ monitorIds: [monitor.uptimeMonitorId], endsAt: new Date(start + 60_000).toISOString() });
    const actual = await vi.importActual<typeof import("../incident-service")>("../incident-service");
    vi.mocked(createIncident).mockImplementationOnce(async (...args) => {
      const incident = await actual.createIncident(...args);
      vi.setSystemTime(start + 60_000); return incident;
    });
    const dispatch = vi.spyOn(notificationService, "dispatchNotifications");
    response("down", 10);
    if (manual) await caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: monitor.uptimeMonitorId });
    else await executeCheck(monitor.uptimeMonitorId);
    expect(dispatch).not.toHaveBeenCalled();
    await resumeSuppressedNotifications(); expect(events).toEqual(["down"]);
    const [job] = await db.query.uptimeDeferredAlert.findMany(); expect(job?.deliveredTargets).toHaveLength(1);
    response("up", 100); await executeCheck(monitor.uptimeMonitorId); await resumeSuppressedNotifications();
    expect(events).toEqual(["down", "up"]);
  }));

});
