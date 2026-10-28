import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeIncident, uptimeIncidentEscalation } from "@pulsy/db";
import { createTestUser, createTestMonitor, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { getTranslator } from "../../../lib/i18n";
import { receiveHeartbeat } from "../heartbeat-service";
import { acknowledgeIncident } from "../incident-workspace";
import { resumeSuppressedNotifications } from "../maintenance-service";
import { configureIncidentEscalation, runIncidentEscalations, cancelIncidentEscalation, startIncidentEscalationWorker, stopIncidentEscalationWorker } from "../incident-escalation";
import { and, eq } from "drizzle-orm";
useCleanDatabase(); afterEach(async () => { await stopIncidentEscalationWorker(); vi.useRealTimers(); vi.unstubAllEnvs(); });
const t = getTranslator("en");
async function sink(run: (url: string, events: string[], attempts: { count: number }) => Promise<void>, failFirst = false, onReceipt?: (path: string) => Promise<void>, failAlways = false, onRequest?: (body: string, delivery: string) => void) {
  const events: string[] = []; const attempts = { count: 0 }; const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += String(chunk); if (body.length > 4096) throw new Error("Fixture bound");
    attempts.count++; onRequest?.(body, String(req.headers["x-pulsy-delivery"])); if (failAlways || failFirst && attempts.count === 1) { res.writeHead(503); res.end("temporary fixture"); return; }
    const payload = JSON.parse(body); events.push(`${req.url}:${String(payload.event).replace("monitor.", "")}`); await onReceipt?.(req.url ?? ""); res.writeHead(200); res.end("received");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address"); vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
  try { await run(`http://127.0.0.1:${address.port}`, events, attempts); } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
describe("durable personal incident escalation", () => {
  it("does not let leased jobs fill the scan and starve another due incident", async () => sink(async (url, events) => {
    vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.parse("2026-10-10T12:00:00Z"); vi.setSystemTime(start);
    const owner = await createTestUser(); const caller = authedCaller(owner); const heartbeat = await caller.uptimeMonitor.heartbeat.create({ name: "Backup", interval: 300, graceSeconds: 60 });
    await receiveHeartbeat(heartbeat.token, "fail", {}); await resumeSuppressedNotifications(); const [incident] = await db.select().from(uptimeIncident);
    const other = await createTestMonitor(owner.id); const channel = await caller.uptimeMonitor.channel.create({ uptimeMonitorId: other.uptimeMonitorId, channelType: "webhook", webhookUrl: url + "/due" });
    await configureIncidentEscalation(incident!.incidentId, owner.id, [{ channelId: channel.channelId, afterSeconds: 60 }], t);
    for (let index = 0; index < 25; index++) {
      const monitor = await createTestMonitor(owner.id, { status: "down" });
      const [leased] = await db.insert(uptimeIncident).values({ uptimeMonitorId: monitor.uptimeMonitorId, startedAt: new Date(start - 1000).toISOString() }).returning();
      await db.insert(uptimeIncidentEscalation).values({ userId: owner.id, monitorId: monitor.uptimeMonitorId, incidentId: leased!.incidentId, channelId: channel.channelId, step: 0, state: "processing", dueAt: new Date(start).toISOString(), leaseUntil: new Date(start + 300_000).toISOString(), attempts: 1 });
    }
    vi.setSystemTime(start + 60_000); await runIncidentEscalations();
    expect(events).toEqual(["/due:down"]);
  }));
  it("exhausts four persisted attempts without sending a recovery for an undelivered reminder", async () => sink(async (url, events, attempts) => {
    vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.parse("2026-10-10T12:00:00Z"); vi.setSystemTime(start);
    const owner = await createTestUser(); const caller = authedCaller(owner); const heartbeat = await caller.uptimeMonitor.heartbeat.create({ name: "Backup", interval: 300, graceSeconds: 60 });
    await receiveHeartbeat(heartbeat.token, "fail", {}); await resumeSuppressedNotifications(); const [incident] = await db.select().from(uptimeIncident); const other = await createTestMonitor(owner.id);
    const channel = await caller.uptimeMonitor.channel.create({ uptimeMonitorId: other.uptimeMonitorId, channelType: "webhook", webhookUrl: url + "/failure" });
    await configureIncidentEscalation(incident!.incidentId, owner.id, [{ channelId: channel.channelId, afterSeconds: 60 }], t);
    for (const elapsed of [60, 90, 210, 810, 2000]) { vi.setSystemTime(start + elapsed * 1000); await runIncidentEscalations(); }
    expect(attempts.count).toBe(4); expect((await db.select().from(uptimeIncidentEscalation))[0]).toMatchObject({ state: "failed", attempts: 4, deliveredTargets: [] });
    await receiveHeartbeat(heartbeat.token, "success", {}); await resumeSuppressedNotifications(); expect(events).toEqual([]); expect(attempts.count).toBe(4);
  }, false, undefined, true));
  it("does not race an overdue fallback ahead of an in-flight primary acknowledgement", async () => {
    let acknowledge: (() => Promise<unknown>) | undefined;
    await sink(async (url, events) => {
      vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.parse("2026-10-10T12:00:00Z"); vi.setSystemTime(start);
      const owner = await createTestUser(); const caller = authedCaller(owner); const heartbeat = await caller.uptimeMonitor.heartbeat.create({ name: "Backup", interval: 300, graceSeconds: 60 });
      await receiveHeartbeat(heartbeat.token, "fail", {}); await resumeSuppressedNotifications(); const [incident] = await db.select().from(uptimeIncident); const other = await createTestMonitor(owner.id);
      const primary = await caller.uptimeMonitor.channel.create({ uptimeMonitorId: other.uptimeMonitorId, channelType: "webhook", webhookUrl: url + "/primary" });
      const fallback = await caller.uptimeMonitor.channel.create({ uptimeMonitorId: other.uptimeMonitorId, channelType: "webhook", webhookUrl: url + "/fallback" });
      await configureIncidentEscalation(incident!.incidentId, owner.id, [{ channelId: primary.channelId, afterSeconds: 60 }, { channelId: fallback.channelId, afterSeconds: 120 }], t);
      acknowledge = () => acknowledgeIncident(incident!.incidentId, owner.id, t);
      vi.setSystemTime(start + 120_000); await runIncidentEscalations(); await runIncidentEscalations();
      expect(events).toEqual(["/primary:down"]);
    }, false, async path => { if (path === "/primary") { await new Promise(resolve => setTimeout(resolve, 80)); await acknowledge?.(); } });
  });
  it("delays primary/fallback, stops reminders on acknowledgement, and recovers a target that actually received only an escalation", async () => sink(async (url, events) => {
    vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.parse("2026-10-10T12:00:00Z"); vi.setSystemTime(start);
    const owner = await createTestUser(); const caller = authedCaller(owner); const heartbeat = await caller.uptimeMonitor.heartbeat.create({ name: "Backup", interval: 300, graceSeconds: 60 });
    await receiveHeartbeat(heartbeat.token, "fail", {}); await resumeSuppressedNotifications();
    const [incident] = await db.select().from(uptimeIncident); const otherMonitor = await createTestMonitor(owner.id);
    const primary = await caller.uptimeMonitor.channel.create({ uptimeMonitorId: otherMonitor.uptimeMonitorId, channelType: "webhook", webhookUrl: url + "/primary" });
    const fallback = await caller.uptimeMonitor.channel.create({ uptimeMonitorId: otherMonitor.uptimeMonitorId, channelType: "webhook", webhookUrl: url + "/fallback" });
    const steps = [{ channelId: primary.channelId, afterSeconds: 60 }, { channelId: fallback.channelId, afterSeconds: 120 }];
    await configureIncidentEscalation(incident!.incidentId, owner.id, steps, t);
    await configureIncidentEscalation(incident!.incidentId, owner.id, steps, t); expect(await db.select().from(uptimeIncidentEscalation)).toHaveLength(2);
    vi.setSystemTime(start + 59_999); await runIncidentEscalations(); expect(events).toEqual([]);
    vi.setSystemTime(start + 60_000); await runIncidentEscalations(); await runIncidentEscalations(); expect(events).toEqual(["/primary:down"]);
    await acknowledgeIncident(incident!.incidentId, owner.id, t); vi.setSystemTime(start + 120_000); await runIncidentEscalations(); expect(events).toEqual(["/primary:down"]);
    await receiveHeartbeat(heartbeat.token, "success", {}); await resumeSuppressedNotifications(); expect(events).toEqual(["/primary:down", "/primary:up"]);
    expect((await db.select().from(uptimeIncident))[0]?.status).toBe("resolved");
  }));
  it("resumes a persisted failed attempt without loops and honors cancellation and maintenance while retaining measured failure", async () => sink(async (url, events, attempts) => {
    vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.parse("2026-10-10T12:00:00Z"); vi.setSystemTime(start);
    const owner = await createTestUser(); const caller = authedCaller(owner); const heartbeat = await caller.uptimeMonitor.heartbeat.create({ name: "Backup", interval: 300, graceSeconds: 60 });
    await receiveHeartbeat(heartbeat.token, "fail", {}); await resumeSuppressedNotifications(); const [incident] = await db.select().from(uptimeIncident); const other = await createTestMonitor(owner.id);
    const channel = await caller.uptimeMonitor.channel.create({ uptimeMonitorId: other.uptimeMonitorId, channelType: "webhook", webhookUrl: url + "/retry" });
    await configureIncidentEscalation(incident!.incidentId, owner.id, [{ channelId: channel.channelId, afterSeconds: 60 }], t);
    await caller.uptimeMonitor.maintenance.snooze({ monitorIds: [heartbeat.monitor.uptimeMonitorId], endsAt: new Date(start + 120_000).toISOString() });
    vi.setSystemTime(start + 60_000); await runIncidentEscalations(); expect(attempts.count).toBe(0);
    vi.setSystemTime(start + 120_000); await runIncidentEscalations(); expect(attempts.count).toBe(1); expect(events).toEqual([]);
    const [job] = await db.select().from(uptimeIncidentEscalation); expect(job?.attempts).toBe(1); expect(job?.state).toBe("pending");
    // Simulate an expired in-flight lease after a worker exits; the next scanner uses only persisted state.
    await db.update(uptimeIncidentEscalation).set({ state: "processing", leaseUntil: new Date(start + 150_000).toISOString() }).where(and(eq(uptimeIncidentEscalation.userId, owner.id), eq(uptimeIncidentEscalation.id, job!.id)));
    vi.setSystemTime(start + 150_000); await runIncidentEscalations(); await runIncidentEscalations(); expect(events).toEqual(["/retry:down"]);
    await cancelIncidentEscalation(incident!.incidentId, owner.id, t); await runIncidentEscalations(); expect(events).toEqual(["/retry:down"]);
    expect((await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: heartbeat.monitor.uptimeMonitorId })).status).toBe("down");
  }, true));
  it("rejects foreign configuration/cancellation/channels and resolved or acknowledged incidents", async () => {
    const owner = await createTestUser(); const other = await createTestUser(); const ownMonitor = await createTestMonitor(owner.id, { status: "down" }); const foreignMonitor = await createTestMonitor(other.id);
    const [incident] = await db.insert(uptimeIncident).values({ uptimeMonitorId: ownMonitor.uptimeMonitorId }).returning();
    const foreignChannel = await authedCaller(other).uptimeMonitor.channel.create({ uptimeMonitorId: foreignMonitor.uptimeMonitorId, channelType: "webhook", webhookUrl: "https://fixtures.invalid/never-send" });
    await expect(configureIncidentEscalation(incident!.incidentId, owner.id, [{ channelId: foreignChannel.channelId, afterSeconds: 60 }], t)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cancelIncidentEscalation(incident!.incidentId, other.id, t)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await acknowledgeIncident(incident!.incidentId, owner.id, t);
    await expect(configureIncidentEscalation(incident!.incidentId, owner.id, [{ channelId: foreignChannel.channelId, afterSeconds: 60 }], t)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.select().from(uptimeIncidentEscalation)).toHaveLength(0);
  });
});

it("keeps escalation webhook bytes and UUID stable across a persisted retry after rename", async () => {
  const receipts: Array<{ body: string; delivery: string }> = [];
  await sink(async (url) => {
    vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.parse("2026-10-10T12:00:00Z"); vi.setSystemTime(start);
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const heartbeat = await caller.uptimeMonitor.heartbeat.create({ name: "Backup", interval: 300, graceSeconds: 60 });
    await receiveHeartbeat(heartbeat.token, "fail", {}); await resumeSuppressedNotifications();
    const [incident] = await db.select().from(uptimeIncident); const other = await createTestMonitor(owner.id);
    const channel = await caller.uptimeMonitor.channel.create({ uptimeMonitorId: other.uptimeMonitorId, channelType: "webhook", webhookUrl: url + "/retry" });
    await configureIncidentEscalation(incident!.incidentId, owner.id, [{ channelId: channel.channelId, afterSeconds: 60 }], t);
    vi.setSystemTime(start + 60_000); await runIncidentEscalations();
    await caller.uptimeMonitor.heartbeat.update({ monitorId: heartbeat.monitor.uptimeMonitorId, name: "Renamed", interval: 300, graceSeconds: 60 });
    vi.setSystemTime(start + 90_000); await runIncidentEscalations();
    expect(receipts).toHaveLength(2); expect(receipts[1]).toEqual(receipts[0]);
  }, true, undefined, false, (body, delivery) => { receipts.push({ body, delivery }); });
});

it("waits for an accepted in-flight escalation receipt after explicit cancellation before matched recovery", async () => {
  let cancelAndRecover: (() => Promise<void>) | undefined;
  await sink(async (url, events) => {
    vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.parse("2026-10-10T12:00:00Z"); vi.setSystemTime(start);
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const heartbeat = await caller.uptimeMonitor.heartbeat.create({ name: "Backup", interval: 300, graceSeconds: 60 });
    await receiveHeartbeat(heartbeat.token, "fail", {}); await resumeSuppressedNotifications();
    const [incident] = await db.select().from(uptimeIncident); const other = await createTestMonitor(owner.id);
    const channel = await caller.uptimeMonitor.channel.create({ uptimeMonitorId: other.uptimeMonitorId, channelType: "webhook", webhookUrl: url + "/primary" });
    await configureIncidentEscalation(incident!.incidentId, owner.id, [{ channelId: channel.channelId, afterSeconds: 60 }], t);
    cancelAndRecover = async () => {
      await cancelIncidentEscalation(incident!.incidentId, owner.id, t);
      await receiveHeartbeat(heartbeat.token, "success", {});
      await resumeSuppressedNotifications();
      expect(events).toEqual(["/primary:down"]);
    };
    vi.setSystemTime(start + 60_000); await runIncidentEscalations();
    // The recovery may be waiting on the original lease; make its next scan due.
    vi.setSystemTime(start + 75_000); await resumeSuppressedNotifications();
    expect(events).toEqual(["/primary:down", "/primary:up"]);
  }, false, async path => { if (path === "/primary" && cancelAndRecover) { const run = cancelAndRecover; cancelAndRecover = undefined; await run(); } });
});

it("drains an in-flight escalation before worker shutdown returns", async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await sink(async (url, events) => {
    vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.parse("2026-10-10T12:00:00Z"); vi.setSystemTime(start);
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const heartbeat = await caller.uptimeMonitor.heartbeat.create({ name: "Backup", interval: 300, graceSeconds: 60 });
    await receiveHeartbeat(heartbeat.token, "fail", {}); await resumeSuppressedNotifications();
    const [incident] = await db.select().from(uptimeIncident); const other = await createTestMonitor(owner.id);
    const channel = await caller.uptimeMonitor.channel.create({ uptimeMonitorId: other.uptimeMonitorId, channelType: "webhook", webhookUrl: url + "/primary" });
    await configureIncidentEscalation(incident!.incidentId, owner.id, [{ channelId: channel.channelId, afterSeconds: 60 }], t);
    vi.setSystemTime(start + 60_000); startIncidentEscalationWorker();
    try {
      await vi.waitFor(() => expect(events).toEqual(["/primary:down"]));
      let stopped = false; const stopping = stopIncidentEscalationWorker().then(() => { stopped = true; });
      await new Promise<void>(resolve => setImmediate(resolve)); expect(stopped).toBe(false);
      release(); await stopping; expect(stopped).toBe(true);
      expect((await db.select().from(uptimeIncidentEscalation))[0]).toMatchObject({ state: "sent", leaseToken: null, leaseUntil: null });
    } finally { release(); await stopIncidentEscalationWorker(); }
  }, false, async () => held);
});
