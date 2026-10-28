import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { decrypt } from "../../../lib/crypto";
import { scheduledJobs } from "node-schedule";
import { createTestUser, useCleanDatabase, db } from "../../../../test/db";
import { getTranslator } from "../../../lib/i18n";
import { createHeartbeatForUser, receiveHeartbeat, scanHeartbeatDeadlines, rotateHeartbeatToken, readHeartbeatForUser, revealHeartbeatToken, listHeartbeatRuns, startHeartbeatWorker, stopHeartbeatWorker } from "../heartbeat-service";
import { uptimeMonitor, uptimeHeartbeat, uptimeHeartbeatRun, uptimeIncident, uptimeStatusChange, uptimeCheckLog } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { authedCaller } from "../../../../test/trpc-caller";
import { getOwnedUptimeAggregates } from "../stats-service";
useCleanDatabase();
afterEach(async () => { await stopHeartbeatWorker(); vi.useRealTimers(); vi.restoreAllMocks(); });
const t = getTranslator("en");
const start = new Date("2026-10-10T12:00:00Z");
const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
const input = { name: "Backup", interval: 300, graceSeconds: 60, active: true, tags: [] };
describe("durable interval heartbeats", () => {
  it.each(["start", "success", "fail"] as const)("ignores an overtaken %s receipt without rewinding committed state", async event => {
    const owner = await createTestUser();
    const created = await createHeartbeatForUser(input, owner.id, t, start);
    await receiveHeartbeat(created.token, "success", {}, at(1));
    await receiveHeartbeat(created.token, "start", { runId: "newer" }, at(120));
    await receiveHeartbeat(created.token, "fail", { runId: "newer" }, at(121));
    const snapshot = async () => ({
      monitors: await db.select().from(uptimeMonitor),
      heartbeat: await db.select().from(uptimeHeartbeat),
      runs: await db.select().from(uptimeHeartbeatRun),
      incidents: await db.select().from(uptimeIncident),
      samples: await db.select().from(uptimeCheckLog),
      changes: await db.select().from(uptimeStatusChange),
    });
    const before = await snapshot();
    expect(await receiveHeartbeat(created.token, event, event === "start" ? { runId: "overtaken" } : {}, at(100)))
      .toEqual({ statusCode: 200, outcome: "ignored" });
    expect(await snapshot()).toEqual(before);
    expect(before.monitors[0]?.status).toBe("down");
    expect(before.incidents[0]).toMatchObject({ status: "ongoing", startedAt: at(121).toISOString(), resolvedAt: null });
  });

  it("does not let a receipt preceding a newer deadline evaluation rewind its incident", async () => {
    const owner = await createTestUser();
    const created = await createHeartbeatForUser(input, owner.id, t, start);
    await receiveHeartbeat(created.token, "success", {}, at(1));
    await scanHeartbeatDeadlines(at(400));
    expect(await receiveHeartbeat(created.token, "success", {}, at(350))).toEqual({ statusCode: 200, outcome: "ignored" });
    expect((await db.select().from(uptimeMonitor))[0]).toMatchObject({ status: "down", lastCheckedAt: at(400).toISOString() });
    expect((await db.select().from(uptimeIncident))[0]).toMatchObject({ status: "ongoing", startedAt: at(361).toISOString(), resolvedAt: null });
  });

  it("keeps the admission clock monotonic when newer duplicate receipts did not change health", async () => {
    const owner = await createTestUser();
    const created = await createHeartbeatForUser(input, owner.id, t, start);
    await receiveHeartbeat(created.token, "start", { runId: "completed" }, at(1));
    await receiveHeartbeat(created.token, "success", { runId: "completed" }, at(2));
    for (let i = 0; i < 120; i++) expect(await receiveHeartbeat(created.token, "success", { runId: "completed" }, at(120)))
      .toMatchObject({ statusCode: 200, outcome: "duplicate" });
    expect(await receiveHeartbeat(created.token, "success", {}, at(100))).toEqual({ statusCode: 429, outcome: "limited" });
    expect((await db.select().from(uptimeHeartbeat))[0]).toMatchObject({ rateWindowAt: at(120).toISOString(), rateCount: 120, lastReceivedAt: at(2).toISOString() });
    expect((await db.select().from(uptimeMonitor))[0]).toMatchObject({ status: "up", lastCheckedAt: at(2).toISOString() });
  });

  it("creates one private Pending monitor in the shared pool, stores a token hash and encrypted recovery value, and isolates configuration", async () => {
    const owner = await createTestUser(); const other = await createTestUser();
    const created = await createHeartbeatForUser(input, owner.id, t, start);
    expect(created.monitor).toMatchObject({ monitorType: "heartbeat", status: "pending", url: "", isPublic: false, responseTime: null, interval: 300 });
    expect(/^[A-Za-z0-9_-]{43}$/.test(created.token)).toBe(true);
    const config = await readHeartbeatForUser(created.monitor.uptimeMonitorId, owner.id, t);
    expect(config).toMatchObject({ expectedAt: at(300).toISOString(), lastSuccessAt: null });
    expect(JSON.stringify(config)).not.toContain(created.token);
    expect(config).not.toHaveProperty("tokenHash");
    expect(config).not.toHaveProperty("tokenCipher");
    expect(config).not.toHaveProperty("rateCount");
    expect(config).not.toHaveProperty("rateWindowAt");
    const [stored] = await db.select().from(uptimeHeartbeat);
    expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(stored)).not.toContain(created.token);
    expect(stored?.tokenHash).toBe(createHash("sha256").update(created.token).digest("hex"));
    expect(stored?.tokenCipher).toBeTruthy();
    expect(decrypt(stored!.tokenCipher!)).toBe(created.token);
    await expect(readHeartbeatForUser(created.monitor.uptimeMonitorId, other.id, t)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(rotateHeartbeatToken(created.monitor.uptimeMonitorId, other.id, t)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("starts the incident and status change at the grace deadline even when evaluation is delayed", async () => {
    const owner = await createTestUser();
    const created = await createHeartbeatForUser(input, owner.id, t, start);
    await scanHeartbeatDeadlines(at(305));
    expect(await db.select().from(uptimeIncident)).toHaveLength(0);
    await scanHeartbeatDeadlines(at(400));
    const [incident] = await db.select().from(uptimeIncident);
    const [down] = await db.select().from(uptimeStatusChange).where(eq(uptimeStatusChange.statusAfter, "down"));
    const [late] = await db.select().from(uptimeStatusChange).where(eq(uptimeStatusChange.statusAfter, "degraded"));
    const samples = await db.select().from(uptimeCheckLog);
    expect(late?.createdAt).toBe(at(300).toISOString());
    expect(samples.find(sample => sample.status === "degraded")).toMatchObject({ createdAt: at(300).toISOString(), errorMessage: "heartbeat_late", responseTime: null });
    expect(samples.find(sample => sample.status === "down")).toMatchObject({ createdAt: at(360).toISOString(), errorMessage: "heartbeat_missed", responseTime: null });
    expect(incident?.startedAt).toBe(at(360).toISOString());
    expect(down?.createdAt).toBe(incident?.startedAt);
    expect((await db.select().from(uptimeMonitor))[0]?.lastCheckedAt).toBe(at(400).toISOString());
    expect((await readHeartbeatForUser(created.monitor.uptimeMonitorId, owner.id, t)).expectedAt).toBe(at(300).toISOString());
  });
  it("survives missed scans, has exact late/down deadlines and one incident, and recovers on a real success only", async () => {
    const owner = await createTestUser(); const created = await createHeartbeatForUser(input, owner.id, t, start); const id = created.monitor.uptimeMonitorId;
    await scanHeartbeatDeadlines(at(299)); expect((await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, id)))[0]?.status).toBe("pending");
    await scanHeartbeatDeadlines(at(300)); expect((await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, id)))[0]?.status).toBe("degraded");
    await Promise.all([scanHeartbeatDeadlines(at(360)), scanHeartbeatDeadlines(at(360))]);
    expect((await db.select().from(uptimeMonitor))[0]?.status).toBe("down"); expect(await db.select().from(uptimeIncident)).toHaveLength(1);
    expect((await db.select().from(uptimeHeartbeat))[0]?.nextDeadline).toBeNull();
    expect((await receiveHeartbeat(created.token, "success", {}, at(361))).statusCode).toBe(200);
    expect((await db.select().from(uptimeMonitor))[0]?.status).toBe("up"); expect((await db.select().from(uptimeIncident))[0]?.status).toBe("resolved");
    expect((await db.select().from(uptimeHeartbeat))[0]?.expectedAt).toBe(at(661).toISOString());
    const missed = await createHeartbeatForUser({ ...input, name: "Missed" }, owner.id, t, start);
    await scanHeartbeatDeadlines(at(400)); expect((await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, missed.monitor.uptimeMonitorId)))[0]?.status).toBe("down");
  });
  it("uses durable run IDs: start is not health, terminal duplicates are idempotent, and older runs cannot recover a failed newer run", async () => {
    const owner = await createTestUser(); const created = await createHeartbeatForUser(input, owner.id, t, start);
    expect(await receiveHeartbeat(created.token, "start", { runId: "run-1", metadata: { environment: "staging" } }, at(1))).toMatchObject({ statusCode: 200, outcome: "accepted" });
    expect((await db.select().from(uptimeMonitor))[0]?.status).toBe("pending");
    await receiveHeartbeat(created.token, "start", { runId: "run-2" }, at(2));
    expect(await receiveHeartbeat(created.token, "success", { runId: "run-1" }, at(3))).toMatchObject({ statusCode: 200, outcome: "ignored" });
    await receiveHeartbeat(created.token, "fail", { runId: "run-2" }, at(4));
    expect((await db.select().from(uptimeMonitor))[0]?.status).toBe("down");
    expect(await receiveHeartbeat(created.token, "success", { runId: "run-2" }, at(5))).toMatchObject({ statusCode: 200, outcome: "duplicate" });
    expect(await receiveHeartbeat(created.token, "success", { runId: "unknown" }, at(5))).toMatchObject({ statusCode: 409 });
    await receiveHeartbeat(created.token, "start", { runId: "run-3" }, at(6));
    await receiveHeartbeat(created.token, "success", { runId: "run-3" }, at(8));
    const config = await readHeartbeatForUser(created.monitor.uptimeMonitorId, owner.id, t);
    expect(config.lastRunDurationMs).toBe(2000); expect((await db.select().from(uptimeMonitor))[0]?.responseTime).toBeNull();
    await receiveHeartbeat(created.token, "success", {}, at(9));
    expect((await readHeartbeatForUser(created.monitor.uptimeMonitorId, owner.id, t)).lastRunDurationMs).toBe(2000);
    const rows = await db.select().from(uptimeHeartbeatRun); expect(rows).toHaveLength(3);
    expect(rows.find(row => row.runId === "run-1")).toMatchObject({ outcome: "superseded", finishedAt: at(2).toISOString(), metadata: { environment: "staging" } });
    expect(rows.find(row => row.runId === "run-2")).toMatchObject({ outcome: "fail", finishedAt: at(4).toISOString() });
    expect(rows.find(row => row.runId === "run-3")).toMatchObject({ outcome: "success", startedAt: at(6).toISOString(), finishedAt: at(8).toISOString() });
  });
  it("reveals credentials only to their owner and rotates without discarding runs, deadlines or health", async () => {
    const owner = await createTestUser(); const other = await createTestUser();
    const created = await createHeartbeatForUser(input, owner.id, t, start); const id = created.monitor.uptimeMonitorId;
    await receiveHeartbeat(created.token, "start", { runId: "before-rotation" }, at(1));
    await receiveHeartbeat(created.token, "success", { runId: "before-rotation" }, at(2));
    expect(await revealHeartbeatToken(id, owner.id, t)).toEqual({ token: created.token });
    await expect(revealHeartbeatToken(id, other.id, t)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const before = await readHeartbeatForUser(id, owner.id, t);
    const rotated = await rotateHeartbeatToken(id, owner.id, t);
    expect(rotated.token).not.toBe(created.token);
    expect(await revealHeartbeatToken(id, owner.id, t)).toEqual({ token: rotated.token });
    expect(await readHeartbeatForUser(id, owner.id, t)).toEqual(before);
    expect((await db.select().from(uptimeMonitor))[0]?.status).toBe("up");
    expect(await listHeartbeatRuns(id, owner.id, t)).toHaveLength(1);
    expect((await receiveHeartbeat(created.token, "success", {}, at(3))).statusCode).toBe(404);
    expect((await receiveHeartbeat(rotated.token, "success", {}, at(3))).statusCode).toBe(200);
    await db.update(uptimeHeartbeat).set({ tokenCipher: null }).where(eq(uptimeHeartbeat.monitorId, id));
    expect(await revealHeartbeatToken(id, owner.id, t)).toEqual({ token: null });
    const replacement = await rotateHeartbeatToken(id, owner.id, t);
    expect(await revealHeartbeatToken(id, owner.id, t)).toEqual({ token: replacement.token });
  });
  it("lists bounded run projections newest first and denies foreign owners", async () => {
    const owner = await createTestUser(); const other = await createTestUser();
    const created = await createHeartbeatForUser(input, owner.id, t, start); const id = created.monitor.uptimeMonitorId;
    await receiveHeartbeat(created.token, "start", { runId: "first", metadata: { version: "v1" } }, at(1));
    await receiveHeartbeat(created.token, "success", { runId: "first" }, at(2));
    await receiveHeartbeat(created.token, "start", { runId: "second" }, at(3));
    const runs = await listHeartbeatRuns(id, owner.id, t, 1);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runId: "second", outcome: "running", startedAt: at(3).toISOString(), finishedAt: null });
    expect(runs[0]).not.toHaveProperty("userId");
    expect(runs[0]).not.toHaveProperty("monitorId");
    expect(JSON.stringify(runs)).not.toContain(created.token);
    await expect(listHeartbeatRuns(id, other.id, t)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listHeartbeatRuns(id, owner.id, t, 2)).toMatchObject([
      { runId: "second" }, { runId: "first", metadata: { version: "v1" } },
    ]);
  });
  it("treats duplicate start receipts as idempotent without refreshing health or the due time", async () => {
    const owner = await createTestUser(); const created = await createHeartbeatForUser(input, owner.id, t, start); const id = created.monitor.uptimeMonitorId;
    await receiveHeartbeat(created.token, "start", { runId: "same" }, at(1));
    expect(await receiveHeartbeat(created.token, "start", { runId: "same" }, at(2))).toMatchObject({ statusCode: 200, outcome: "duplicate", runId: "same" });
    expect(await listHeartbeatRuns(id, owner.id, t)).toHaveLength(1);
    expect(await readHeartbeatForUser(id, owner.id, t)).toMatchObject({ expectedAt: at(300).toISOString(), lastReceivedAt: at(1).toISOString(), lastSuccessAt: null });
    expect(await db.select().from(uptimeCheckLog)).toHaveLength(0);
  });
  it("invalidates rotated tokens without resetting history, and enforces receive bounds independently of monitor cadence", async () => {
    const owner = await createTestUser(); const created = await createHeartbeatForUser(input, owner.id, t, start);
    const rotated = await rotateHeartbeatToken(created.monitor.uptimeMonitorId, owner.id, t);
    expect((await receiveHeartbeat(created.token, "success", {}, at(1))).statusCode).toBe(404);
    for (let i = 0; i < 120; i++) expect((await receiveHeartbeat(rotated.token, "success", {}, at(1))).statusCode).toBe(200);
    expect((await receiveHeartbeat(rotated.token, "success", {}, at(1))).statusCode).toBe(429);
    const separate = await createHeartbeatForUser({ ...input, name: "Separate token" }, owner.id, t, start);
    expect((await receiveHeartbeat(separate.token, "success", {}, at(1))).statusCode).toBe(200);
    expect((await receiveHeartbeat(rotated.token, "start", { runId: "legitimate" }, at(61))).statusCode).toBe(200);
    expect((await receiveHeartbeat(rotated.token, "success", { runId: "legitimate" }, at(62))).statusCode).toBe(200);
    expect((await readHeartbeatForUser(created.monitor.uptimeMonitorId, owner.id, t)).lastRunDurationMs).toBe(1000);
  });
  it("rejects unavailable credentials and token-bearing payloads without recording health or runs", async () => {
    const owner = await createTestUser(); const created = await createHeartbeatForUser(input, owner.id, t, start);
    expect(await receiveHeartbeat("malformed", "success", {}, at(1))).toMatchObject({ statusCode: 404, outcome: "unavailable" });
    expect(await receiveHeartbeat("A".repeat(43), "success", {}, at(1))).toMatchObject({ statusCode: 404, outcome: "unavailable" });
    expect(await receiveHeartbeat(created.token, "start", { runId: created.token }, at(1))).toMatchObject({ statusCode: 400, outcome: "invalid" });
    expect(await receiveHeartbeat(created.token, "start", { metadata: { environment: created.token } }, at(1))).toMatchObject({ statusCode: 400, outcome: "invalid" });
    expect(await receiveHeartbeat(created.token, "start", { runId: `a${created.token}` }, at(1))).toMatchObject({ statusCode: 400, outcome: "invalid" });
    expect(await receiveHeartbeat(created.token, "start", { metadata: { version: `${created.token}a` } }, at(1))).toMatchObject({ statusCode: 400, outcome: "invalid" });
    expect(await db.select().from(uptimeHeartbeatRun)).toHaveLength(0);
    expect(await db.select().from(uptimeCheckLog)).toHaveLength(0);
    expect((await readHeartbeatForUser(created.monitor.uptimeMonitorId, owner.id, t)).lastReceivedAt).toBeNull();
  });
  it("pausing and starting do not recover or close an incident; deadline scan skips paused monitors", async () => {
    const owner = await createTestUser(); const created = await createHeartbeatForUser(input, owner.id, t, start);
    await receiveHeartbeat(created.token, "fail", {}, at(1));
    await db.update(uptimeMonitor).set({ active: false }).where(eq(uptimeMonitor.uptimeMonitorId, created.monitor.uptimeMonitorId));
    await receiveHeartbeat(created.token, "start", { runId: "running" }, at(2));
    await scanHeartbeatDeadlines(at(1000));
    expect((await db.select().from(uptimeMonitor))[0]?.status).toBe("down"); expect((await db.select().from(uptimeIncident))[0]?.status).toBe("ongoing");
  });
  it("retains a truthful long-run duration and bounds stored run IDs without granting pruned terminal IDs authority", async () => {
    const owner = await createTestUser(); const created = await createHeartbeatForUser(input, owner.id, t, start); const id = created.monitor.uptimeMonitorId;
    await receiveHeartbeat(created.token, "start", { runId: "long-run" }, start);
    await receiveHeartbeat(created.token, "success", { runId: "long-run" }, at(30 * 86400));
    expect((await readHeartbeatForUser(id, owner.id, t)).lastRunDurationMs).toBe(2_592_000_000);
    await db.delete(uptimeHeartbeatRun).where(eq(uptimeHeartbeatRun.monitorId, id));
    await db.insert(uptimeHeartbeatRun).values(Array.from({ length: 1000 }, (_, i) => ({ monitorId: id, userId: owner.id, runId: `old-${i}`, outcome: "success" as const, startedAt: new Date(start.getTime() + i * 1000).toISOString(), finishedAt: new Date(start.getTime() + i * 1000 + 1).toISOString() })));
    await db.update(uptimeHeartbeat).set({ runCount: 1000 }).where(eq(uptimeHeartbeat.monitorId, id));
    await receiveHeartbeat(created.token, "start", { runId: "bounded-new" }, at(30 * 86400 + 1));
    expect(await db.select().from(uptimeHeartbeatRun).where(eq(uptimeHeartbeatRun.monitorId, id))).toHaveLength(901);
    expect((await receiveHeartbeat(created.token, "success", { runId: "old-0" }, at(30 * 86400 + 2))).statusCode).toBe(409);
  });
  it("resuming a long-paused heartbeat starts a fresh interval instead of going Down on its stale deadline", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner); const created = await createHeartbeatForUser(input, owner.id, t, start); const id = created.monitor.uptimeMonitorId;
    await caller.uptimeMonitor.monitor.toggleActive({ uptimeMonitorId: id }); // pause
    expect((await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, id)))[0]?.active).toBe(false);
    const resumedAt = Date.now();
    await caller.uptimeMonitor.monitor.toggleActive({ uptimeMonitorId: id }); // resume ~2 days after the stored deadline
    expect(await scanHeartbeatDeadlines(new Date())).toBe(0);
    const [monitor] = await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, id));
    expect(monitor?.status).toBe("pending"); expect(await db.select().from(uptimeIncident)).toHaveLength(0);
    const config = await readHeartbeatForUser(id, owner.id, t);
    expect(Date.parse(config.expectedAt)).toBeGreaterThanOrEqual(resumedAt + 300_000 - 50); expect(config.nextDeadline).toBe(config.expectedAt);
    // The same holds when the resume arrives through the shared edit path.
    await db.update(uptimeMonitor).set({ active: false }).where(eq(uptimeMonitor.uptimeMonitorId, id));
    await db.update(uptimeHeartbeat).set({ expectedAt: start.toISOString(), nextDeadline: start.toISOString() }).where(eq(uptimeHeartbeat.monitorId, id));
    await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: id, active: true });
    expect(await scanHeartbeatDeadlines(new Date())).toBe(0);
    await db.update(uptimeMonitor).set({ active: false }).where(eq(uptimeMonitor.uptimeMonitorId, id));
    await db.update(uptimeHeartbeat).set({ expectedAt: start.toISOString(), nextDeadline: start.toISOString() }).where(eq(uptimeHeartbeat.monitorId, id));
    await caller.uptimeMonitor.heartbeat.update({ ...input, monitorId: id, active: true });
    expect(await scanHeartbeatDeadlines(new Date())).toBe(0);
  });
  it("re-saving an already active heartbeat never pushes a real missed deadline forward", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner); const created = await createHeartbeatForUser(input, owner.id, t, start); const id = created.monitor.uptimeMonitorId;
    await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: id, active: true });
    expect((await readHeartbeatForUser(id, owner.id, t)).expectedAt).toBe(at(300).toISOString());
    expect(await scanHeartbeatDeadlines(at(400))).toBe(1);
    expect((await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, id)))[0]?.status).toBe("down");
  });
  it("dedicated edits retain receipt history and recompute schedule from the last success without restoring health", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at(1000));
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const created = await createHeartbeatForUser(input, owner.id, t, start); const id = created.monitor.uptimeMonitorId;
    await receiveHeartbeat(created.token, "success", {}, at(1));
    await receiveHeartbeat(created.token, "fail", {}, at(2));
    await caller.uptimeMonitor.heartbeat.update({ ...input, monitorId: id, interval: 600, graceSeconds: 30 });
    expect(await readHeartbeatForUser(id, owner.id, t)).toMatchObject({ interval: 600, graceSeconds: 30, expectedAt: at(601).toISOString(), nextDeadline: null, lastSuccessAt: at(1).toISOString(), lastFailAt: at(2).toISOString() });
    expect((await db.select().from(uptimeMonitor))[0]?.status).toBe("down");
    expect((await db.select().from(uptimeIncident))[0]?.status).toBe("ongoing");
    expect(await revealHeartbeatToken(id, owner.id, t)).toEqual({ token: created.token });
  });
  it("registration after restart evaluates persisted overdue deadlines, and repeated registration cancels the old job", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at(3600));
    const owner = await createTestUser(); const created = await createHeartbeatForUser(input, owner.id, t, start); const id = created.monitor.uptimeMonitorId;
    const first = startHeartbeatWorker();
    expect(first).toBeTruthy();
    await vi.waitFor(async () => expect((await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, id)))[0]?.status).toBe("down"));
    const configuration = await readHeartbeatForUser(id, owner.id, t);
    expect(configuration.expectedAt).toBe(at(300).toISOString());
    expect(configuration.lastReceivedAt).toBeNull();
    expect(configuration.nextDeadline).toBeNull();
    const cancel = vi.spyOn(first!, "cancel");
    const second = startHeartbeatWorker();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(scheduledJobs["uptime-heartbeat-deadlines"]).toBe(second);
    // Re-evaluation/re-registration neither restarts the deadline nor opens another incident.
    await scanHeartbeatDeadlines(at(3900));
    expect(await db.select().from(uptimeIncident)).toHaveLength(1);
    expect((await readHeartbeatForUser(id, owner.id, t)).expectedAt).toBe(at(300).toISOString());
  });
  it("worker shutdown drains the initial deadline scan before returning", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at(400));
    const owner = await createTestUser(); const created = await createHeartbeatForUser(input, owner.id, t, start);
    startHeartbeatWorker();
    await stopHeartbeatWorker();
    expect(scheduledJobs["uptime-heartbeat-deadlines"]).toBeUndefined();
    expect((await db.select().from(uptimeMonitor))[0]).toMatchObject({ status: "down", lastCheckedAt: at(400).toISOString() });
    expect((await readHeartbeatForUser(created.monitor.uptimeMonitorId, owner.id, t)).nextDeadline).toBeNull();
    expect(await db.select().from(uptimeIncident)).toHaveLength(1);
  });

  it("evaluates Down on cadence with truthful timestamps, no invented pings, no duplicate incidents, and real recovery", async () => {
    const owner = await createTestUser(); const created = await createHeartbeatForUser(input, owner.id, t, start); const id = created.monitor.uptimeMonitorId;
    const read = async () => (await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, id)))[0]!;
    await scanHeartbeatDeadlines(at(1));
    expect(await read()).toMatchObject({ status: "pending", lastCheckedAt: at(1).toISOString() });
    expect(await db.select().from(uptimeCheckLog)).toHaveLength(0);
    await scanHeartbeatDeadlines(at(360));
    expect(await read()).toMatchObject({ status: "down", lastCheckedAt: at(360).toISOString() });
    expect((await readHeartbeatForUser(id, owner.id, t)).lastReceivedAt).toBeNull();
    await scanHeartbeatDeadlines(at(659)); expect(await db.select().from(uptimeCheckLog)).toHaveLength(1);
    await scanHeartbeatDeadlines(at(660)); expect(await db.select().from(uptimeCheckLog)).toHaveLength(2);
    expect((await read()).lastCheckedAt).toBe(at(660).toISOString());
    expect(await db.select().from(uptimeIncident)).toHaveLength(1);
    await receiveHeartbeat(created.token, "success", {}, at(661));
    expect(await read()).toMatchObject({ status: "up", lastCheckedAt: at(661).toISOString() });
    expect(await readHeartbeatForUser(id, owner.id, t)).toMatchObject({ lastReceivedAt: at(661).toISOString(), lastSuccessAt: at(661).toISOString(), expectedAt: at(961).toISOString() });
    expect((await db.select().from(uptimeIncident))[0]?.status).toBe("resolved");
  });

  it("healthy evaluations retain last ping, explicit failure never recovers on a timer, and paused scans record nothing", async () => {
    const owner = await createTestUser(); const created = await createHeartbeatForUser(input, owner.id, t, start); const id = created.monitor.uptimeMonitorId;
    await receiveHeartbeat(created.token, "success", {}, at(1));
    await scanHeartbeatDeadlines(at(300));
    expect((await readHeartbeatForUser(id, owner.id, t)).lastReceivedAt).toBe(at(1).toISOString());
    await receiveHeartbeat(created.token, "fail", {}, at(301));
    // Even while the prior success's next interval would still be healthy.
    // Force a due evaluation before the original grace deadline by changing
    // cadence only. A failed heartbeat has no next deadline and stays Down.
    await db.update(uptimeMonitor).set({ interval: 30 }).where(eq(uptimeMonitor.uptimeMonitorId, id));
    await scanHeartbeatDeadlines(at(331));
    expect((await db.select().from(uptimeMonitor))[0]?.status).toBe("down");
    await db.update(uptimeMonitor).set({ active: false }).where(eq(uptimeMonitor.uptimeMonitorId, id));
    await scanHeartbeatDeadlines(at(1000));
    expect((await db.select().from(uptimeMonitor))[0]?.lastCheckedAt).toBe(at(331).toISOString());
    expect((await readHeartbeatForUser(id, owner.id, t)).lastReceivedAt).toBe(at(301).toISOString());
  });

  it("does not recover an overdue outage when a paused heartbeat resumes with a future deadline and an old success", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at(1000));
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const created = await createHeartbeatForUser(input, owner.id, t, start); const id = created.monitor.uptimeMonitorId;
    await receiveHeartbeat(created.token, "success", {}, at(1));
    await scanHeartbeatDeadlines(at(361));
    await caller.uptimeMonitor.heartbeat.update({ ...input, monitorId: id, active: false });
    await caller.uptimeMonitor.heartbeat.update({ ...input, monitorId: id, active: true });
    expect((await readHeartbeatForUser(id, owner.id, t)).expectedAt).toBe(at(1300).toISOString());
    await scanHeartbeatDeadlines(at(1000));
    expect((await db.select().from(uptimeMonitor))[0]?.status).toBe("down");
    expect((await readHeartbeatForUser(id, owner.id, t)).lastSuccessAt).toBe(at(1).toISOString());
    expect((await db.select().from(uptimeIncident))[0]?.status).toBe("ongoing");
    await receiveHeartbeat(created.token, "success", {}, at(1001));
    expect((await db.select().from(uptimeMonitor))[0]?.status).toBe("up");
    expect((await db.select().from(uptimeIncident))[0]?.status).toBe("resolved");
  });

  it("excludes new no-data heartbeats, includes never-pinged overdue failures and disabled recorded history in both dashboard averages", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at(400));
    const owner = await createTestUser(); const other = await createTestUser();
    const caller = authedCaller(owner);
    const fresh = await createHeartbeatForUser({ ...input, name: "New" }, owner.id, t, at(399));
    const missed = await createHeartbeatForUser(input, owner.id, t, start);
    const healthy = await createHeartbeatForUser({ ...input, name: "Healthy" }, owner.id, t, at(399));
    const foreign = await createHeartbeatForUser(input, other.id, t, start);
    expect(await caller.uptimeMonitor.dashboard.summary()).toMatchObject({ avgUptimePercentage: null, uptimeMonitorsWithData: 0 });
    expect(await getOwnedUptimeAggregates(owner.id)).toEqual(new Map());

    expect(await receiveHeartbeat(healthy.token, "success", {}, at(400))).toMatchObject({ statusCode: 200, outcome: "accepted" });
    await scanHeartbeatDeadlines(at(400));
    const aggregates = await getOwnedUptimeAggregates(owner.id);
    expect(aggregates.size).toBe(2);
    expect(aggregates.has(fresh.monitor.uptimeMonitorId)).toBe(false);
    expect(aggregates.has(foreign.monitor.uptimeMonitorId)).toBe(false);
    expect(aggregates.get(missed.monitor.uptimeMonitorId)?.uptimePercentage).toBe(0);
    expect(aggregates.get(healthy.monitor.uptimeMonitorId)?.uptimePercentage).toBe(100);
    expect((await readHeartbeatForUser(missed.monitor.uptimeMonitorId, owner.id, t)).lastSuccessAt).toBeNull();

    await db.update(uptimeMonitor).set({ active: false }).where(eq(uptimeMonitor.uptimeMonitorId, healthy.monitor.uptimeMonitorId));
    expect(await caller.uptimeMonitor.dashboard.summary()).toMatchObject({ avgUptimePercentage: 50, uptimeMonitorsWithData: 2 });
    const list = await caller.uptimeMonitor.monitor.list();
    expect(list).toHaveLength(3);
    expect(list.find(monitor => monitor.uptimeMonitorId === fresh.monitor.uptimeMonitorId)).toMatchObject({ uptimePercentage: null, uptimeChecks: 0 });
    expect(list.find(monitor => monitor.uptimeMonitorId === missed.monitor.uptimeMonitorId)?.uptimePercentage).toBe(0);
    expect(list.find(monitor => monitor.uptimeMonitorId === healthy.monitor.uptimeMonitorId)).toMatchObject({ active: false, uptimePercentage: 100 });
    // The browser derives its equal-weight average from the list snapshot.
    const measured = list.map(monitor => monitor.uptimePercentage).filter((value): value is number => value !== null);
    expect(measured).toHaveLength(2);
    expect(measured.reduce((sum, value) => sum + value, 0) / measured.length).toBe(50);
  });
});
