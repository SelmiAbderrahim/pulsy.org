import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeDeferredAlert, uptimeIncident } from "@pulsy/db";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { receiveHeartbeat, scanHeartbeatDeadlines } from "../heartbeat-service";
import { resumeSuppressedNotifications } from "../maintenance-service";
useCleanDatabase(); afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function localSink(run: (url: string, receipts: string[]) => Promise<void>) {
  const receipts: string[] = []; const server = createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += String(chunk);
    if (body.length > 4096) throw new Error("Fixture payload too large");
    receipts.push(String(JSON.parse(body).event).replace("monitor.", "")); response.writeHead(200); response.end("received");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address missing");
  vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
  try { await run(`http://127.0.0.1:${address.port}/alerts`, receipts); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
describe("heartbeat durable suppression and real delivery", () => {
  it("delivers an opted-in Late alert and recovery to the actual sink", async () => localSink(async (url, receipts) => {
    vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.parse("2026-10-10T12:00:00Z"); vi.setSystemTime(start);
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const job = await caller.uptimeMonitor.heartbeat.create({ name: "Backup", interval: 300, graceSeconds: 60 });
    await caller.uptimeMonitor.channel.create({ uptimeMonitorId: job.monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: url, notifyOnDegraded: true });
    vi.setSystemTime(start + 300_000); await scanHeartbeatDeadlines(); await resumeSuppressedNotifications();
    expect(receipts).toEqual(["degraded"]);
    await receiveHeartbeat(job.token, "success", {}); await resumeSuppressedNotifications();
    expect(receipts).toEqual(["degraded", "up"]);
  }));
  it("keeps measured Late/Down through overlapping suppression, then delivers one outage and its actual recovery", async () => localSink(async (url, receipts) => {
    vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.parse("2026-10-10T12:00:00Z"); vi.setSystemTime(start);
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const job = await caller.uptimeMonitor.heartbeat.create({ name: "Backup", interval: 300, graceSeconds: 60 }); const id = job.monitor.uptimeMonitorId;
    await caller.uptimeMonitor.channel.create({ uptimeMonitorId: id, channelType: "webhook", webhookUrl: url, notifyOnDegraded: true });
    for (const end of [500, 600]) await caller.uptimeMonitor.maintenance.snooze({ monitorIds: [id], endsAt: new Date(start + end * 1000).toISOString(), reason: "Private deployment" });
    vi.setSystemTime(start + 300_000); await scanHeartbeatDeadlines(); await resumeSuppressedNotifications();
    expect((await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: id })).status).toBe("degraded"); expect(receipts).toEqual([]);
    vi.setSystemTime(start + 360_000); await scanHeartbeatDeadlines(); await resumeSuppressedNotifications();
    expect((await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: id })).status).toBe("down");
    vi.setSystemTime(start + 500_000); await resumeSuppressedNotifications(); expect(receipts).toEqual([]);
    vi.setSystemTime(start + 600_000); await resumeSuppressedNotifications(); await resumeSuppressedNotifications(); expect(receipts).toEqual(["down"]);
    await receiveHeartbeat(job.token, "success", {}); await resumeSuppressedNotifications(); expect(receipts).toEqual(["down", "up"]);
    expect((await db.select().from(uptimeIncident))[0]?.status).toBe("resolved");
    const jobs = await db.select().from(uptimeDeferredAlert); expect(jobs.filter(row => row.state === "sent")).toHaveLength(2);
    expect(JSON.stringify(jobs)).not.toContain(job.token); expect(JSON.stringify(jobs)).not.toContain("Private deployment");
  }));
  it("does not send a false recovery when an unannounced failure recovers during suppression", async () => localSink(async (url, receipts) => {
    const owner = await createTestUser(); const caller = authedCaller(owner); const job = await caller.uptimeMonitor.heartbeat.create({ name: "Backup", interval: 300, graceSeconds: 60 });
    await caller.uptimeMonitor.channel.create({ uptimeMonitorId: job.monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: url });
    await caller.uptimeMonitor.maintenance.snooze({ monitorIds: [job.monitor.uptimeMonitorId], endsAt: new Date(Date.now() + 60_000).toISOString() });
    await receiveHeartbeat(job.token, "fail", {}); await receiveHeartbeat(job.token, "success", {}); await resumeSuppressedNotifications();
    expect(receipts).toEqual([]); expect((await db.select().from(uptimeIncident))[0]?.status).toBe("resolved");
  }));
});
