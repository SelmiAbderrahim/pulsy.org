import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeDeferredAlert, type ServerSample } from "@pulsy/db";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { receiveServerSample } from "../server-health-service";
import { resumeSuppressedNotifications } from "../maintenance-service";

useCleanDatabase();
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function sink(run: (url: string, events: string[]) => Promise<void>) {
  const events: string[] = [];
  const server = createServer(async (request, reply) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    events.push(JSON.parse(body).event);
    reply.writeHead(200); reply.end("received");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address missing");
  vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
  try { await run(`http://127.0.0.1:${address.port}/metrics-alert`, events); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function fixture(url: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  const owner = await createTestUser(), caller = authedCaller(owner);
  const created = await caller.uptimeMonitor.server.create({ name: "Queued host" });
  const monitorId = created.monitor.uptimeMonitorId;
  await caller.uptimeMonitor.channel.create({ uptimeMonitorId: monitorId, channelType: "webhook", webhookUrl: url, notifyOnDegraded: true });
  const bootId = randomUUID(); let sequence = 0;
  const report = async (cpuPercent: number) => {
    vi.setSystemTime(Date.now() + 60_000);
    const sample: ServerSample = { version: 1, bootId, sequence: ++sequence, sampledAt: new Date().toISOString(), agent: { version: "1.0.0", arch: "amd64" }, cpuPercent, memoryPercent: 20, swapPercent: null, load: null, uptimeSeconds: sequence * 60, filesystems: [] };
    expect(await receiveServerSample(created.token, sample)).toMatchObject({ outcome: "accepted" });
  };
  return { owner, caller, monitorId, report };
}

describe("server-health durable notification integration", () => {
  it("commits pressure deliveries with metrics, sends them through the queue, and matches recovery", async () => sink(async (url, events) => {
    const f = await fixture(url);
    for (let i = 0; i < 3; i++) await f.report(99);
    expect(events).toEqual([]);
    expect(await db.select().from(uptimeDeferredAlert).where(eq(uptimeDeferredAlert.userId, f.owner.id))).toEqual([expect.objectContaining({ state: "pending" })]);
    await resumeSuppressedNotifications(); await resumeSuppressedNotifications();
    expect(events).toEqual(["monitor.degraded"]);
    await f.report(20); await f.report(20);
    await resumeSuppressedNotifications(); await resumeSuppressedNotifications();
    expect(events).toEqual(["monitor.degraded", "monitor.up"]);
  }));

  it("suppresses pressure during maintenance and cancels queued delivery for a paused server", async () => sink(async (url, events) => {
    const f = await fixture(url);
    await f.caller.uptimeMonitor.maintenance.snooze({ monitorIds: [f.monitorId], endsAt: new Date(Date.now() + 3600_000).toISOString() });
    for (let i = 0; i < 3; i++) await f.report(99);
    await resumeSuppressedNotifications();
    expect(events).toEqual([]);
    expect((await f.caller.uptimeMonitor.monitor.one({ uptimeMonitorId: f.monitorId })).status).toBe("degraded");
    await f.caller.uptimeMonitor.monitor.toggleActive({ uptimeMonitorId: f.monitorId });
    vi.setSystemTime(Date.now() + 3600_000);
    await resumeSuppressedNotifications();
    expect(events).toEqual([]);
    expect(await db.select().from(uptimeDeferredAlert).where(eq(uptimeDeferredAlert.userId, f.owner.id))).toEqual([expect.objectContaining({ state: "cancelled" })]);
  }));
});
