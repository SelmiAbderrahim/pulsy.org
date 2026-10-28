import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { apiServerConfiguration, db, uptimeServer, uptimeServerMetric, uptimeMonitor, type ServerSample } from "@pulsy/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
import { createTestMonitor, createTestUser, createTestStatusPage, createTestStatusPageMonitor, useCleanDatabase } from "../../../../test/db";
import { cleanupServerMetrics, receiveServerSample } from "../server-health-service";
import { decrypt } from "../../../lib/crypto";

vi.mock("../scheduler-service", () => ({ scheduleMonitorCheck: vi.fn(), cancelMonitorCheck: vi.fn(), rescheduleMonitorCheck: vi.fn() }));
useCleanDatabase();
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });
const sample = (now: Date, sequence = 1): ServerSample => ({ version: 1, bootId: "a811372b-61f5-444a-9cbe-9a1c651a8e49", sequence, sampledAt: now.toISOString(), agent: { version: "1.0.0", arch: "amd64" }, cpuPercent: null, memoryPercent: 42, swapPercent: null, load: [1, 2, 3], uptimeSeconds: 120, filesystems: [{ path: "/", usedPercent: 50 }] });
async function fixture() {
  const owner = await createTestUser(), caller = authedCaller(owner);
  const created = await caller.uptimeMonitor.server.create({ name: "Host" });
  return { owner, caller, ...created, monitorId: created.monitor.uptimeMonitorId };
}

describe("server-health management and ingestion", () => {
  it("uses the agent's UTF-8 byte limit for filesystem exclusions", () => {
    expect(apiServerConfiguration.safeParse({name:"Host",excludedFilesystems:["/"+"é".repeat(255)]}).success).toBe(true);
    expect(apiServerConfiguration.safeParse({name:"Host",excludedFilesystems:["/"+"é".repeat(256)]}).success).toBe(false);
  });
  it("stores encrypted credentials separately, reveals them only on create/rotate and scopes all management", async () => {
    const { caller, owner, monitorId, token } = await fixture();
    const other = authedCaller(await createTestUser());
    const [stored] = await db.select().from(uptimeServer).where(and(eq(uptimeServer.userId, owner.id), eq(uptimeServer.monitorId, monitorId)));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored!.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(decrypt(stored!.tokenCipher)).toBe(token);
    expect(stored!.tokenCipher).not.toContain(token);
    const output = JSON.stringify([await caller.uptimeMonitor.server.one({ monitorId }), await caller.uptimeMonitor.monitor.list(), await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: monitorId })]);
    for (const secret of [token, "tokenHash", "tokenCipher"]) expect(output).not.toContain(secret);
    await expect(publicCaller().uptimeMonitor.server.create({ name: "No" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const action of await Promise.allSettled([other.uptimeMonitor.server.one({ monitorId }), other.uptimeMonitor.server.rotate({ monitorId }), other.uptimeMonitor.server.update({ monitorId, name: "Steal" }), other.uptimeMonitor.server.history({ monitorId, from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" }), other.uptimeMonitor.monitor.delete({ uptimeMonitorId: monitorId }), other.uptimeMonitor.monitor.toggleActive({ uptimeMonitorId: monitorId })])) {
      expect(action).toMatchObject({ status: "rejected", reason: { code: "NOT_FOUND" } });
    }
    const rotated = await caller.uptimeMonitor.server.rotate({ monitorId });
    expect(rotated.token).not.toBe(token);
    const now = new Date();
    expect((await receiveServerSample(token, sample(now), now)).statusCode).toBe(401);
    expect((await receiveServerSample(rotated.token, sample(now), now)).outcome).toBe("accepted");
    await caller.uptimeMonitor.monitor.delete({ uptimeMonitorId: monitorId });
    expect((await receiveServerSample(rotated.token, sample(now), now)).statusCode).toBe(401);
    expect(await db.select().from(uptimeServerMetric).where(eq(uptimeServerMetric.userId, owner.id))).toHaveLength(0);
  });

  it("does not accept invalid, duplicate, older, accelerated or replayed samples as liveness", async () => {
    const { token, monitorId, caller } = await fixture();
    const now = new Date(), input = sample(now);
    for (const payload of [{ ...input, version: 2 }, { ...input, cpuPercent: Infinity }, { ...input, memoryPercent: 101 }, { ...input, sequence: -1 }, { ...input, filesystems: Array.from({ length: 65 }, (_, i) => ({ path: `/${i}`, usedPercent: 1 })) }, { ...input, filesystems: [{ path: "/", usedPercent: 1 }, { path: "/", usedPercent: 2 }] }, { ...input, agent: { ...input.agent, args: "private" } }]) expect((await receiveServerSample(token, payload, now)).statusCode).toBe(400);
    expect((await receiveServerSample(token, input, now)).outcome).toBe("accepted");
    const later = new Date(now.getTime() + 60000);
    expect((await receiveServerSample(token, input, later)).outcome).toBe("ignored");
    expect((await caller.uptimeMonitor.server.one({ monitorId })).lastReceivedAt).toBe(now.toISOString());
    expect((await receiveServerSample(token, sample(new Date(now.getTime() + 1000), 2), new Date(now.getTime() + 1000))).statusCode).toBe(429);
    expect((await receiveServerSample(token, sample(later, 2), later)).outcome).toBe("accepted");
    expect((await receiveServerSample(token, { ...sample(new Date(later.getTime() + 60000), 1), bootId: randomUUID() }, new Date(later.getTime() + 60000))).outcome).toBe("accepted");
    for (let i = 0; i < 12; i++) await receiveServerSample(token, input, new Date(later.getTime() + 60000));
    expect((await receiveServerSample(token, input, new Date(later.getTime() + 60000))).statusCode).toBe(429);
  });

  it("rejects malformed and unknown credentials uniformly and never persists token-bearing samples", async () => {
    const { token, monitorId } = await fixture(); const now = new Date();
    for (const credential of ["malformed", "A".repeat(43)]) {
      expect(await receiveServerSample(credential, sample(now), now)).toMatchObject({ statusCode: 401, outcome: "unavailable" });
    }
    expect(await receiveServerSample(token, { ...sample(now), filesystems: [{ path: `/private/${token}/data`, usedPercent: 10 }] }, now)).toMatchObject({ statusCode: 400, outcome: "invalid" });
    expect(await db.select().from(uptimeServerMetric).where(eq(uptimeServerMetric.monitorId, monitorId))).toHaveLength(0);
    expect((await db.select().from(uptimeServer).where(eq(uptimeServer.monitorId, monitorId)))[0]?.lastReceivedAt).toBeNull();
  });

  it("rejects samples beyond the permitted agent clock window without refreshing liveness", async () => {
    const { token, monitorId } = await fixture(); const now = new Date();
    for (const offset of [-86_400_001, 300_001]) {
      expect(await receiveServerSample(token, sample(new Date(now.getTime() + offset)), now)).toMatchObject({ statusCode: 400, outcome: "invalid" });
    }
    expect((await db.select().from(uptimeServer).where(eq(uptimeServer.monitorId, monitorId)))[0]?.lastReceivedAt).toBeNull();
    expect(await db.select().from(uptimeServerMetric).where(eq(uptimeServerMetric.monitorId, monitorId))).toHaveLength(0);
  });

  it("rejects accepted-hash credentials whose encrypted recovery value does not match", async () => {
    const first = await fixture(); const second = await fixture(); const now = new Date();
    const [otherSecret] = await db.select().from(uptimeServer).where(eq(uptimeServer.monitorId, second.monitorId));
    await db.update(uptimeServer).set({ tokenCipher: otherSecret!.tokenCipher }).where(eq(uptimeServer.monitorId, first.monitorId));
    expect(await receiveServerSample(first.token, sample(now), now)).toMatchObject({ statusCode: 401, outcome: "unavailable" });
    expect(await db.select().from(uptimeServerMetric).where(eq(uptimeServerMetric.monitorId, first.monitorId))).toHaveLength(0);
  });

  it("ignores earlier receive times without changing sequence, sample, rate counters or deadlines", async () => {
    const { token, monitorId } = await fixture(); const now = new Date();
    expect((await receiveServerSample(token, sample(now), now)).outcome).toBe("accepted");
    const scope = eq(uptimeServer.monitorId, monitorId);
    const [before] = await db.select().from(uptimeServer).where(scope);
    const older = new Date(now.getTime() - 1000);
    expect(await receiveServerSample(token, sample(new Date(now.getTime() + 1000), 2), older)).toMatchObject({ statusCode: 200, outcome: "ignored" });
    expect((await db.select().from(uptimeServer).where(scope))[0]).toEqual(before);
    expect(await db.select().from(uptimeServerMetric).where(eq(uptimeServerMetric.monitorId, monitorId))).toHaveLength(1);
  });

  it("isolates the twelve-receipt admission limit by credential and resets it after one minute", async () => {
    const first = await fixture(); const second = await fixture(); const now = new Date();
    expect((await receiveServerSample(first.token, sample(now), now)).outcome).toBe("accepted");
    for (let i = 1; i < 12; i++) expect((await receiveServerSample(first.token, sample(now), now)).outcome).toBe("ignored");
    expect(await receiveServerSample(first.token, sample(now), now)).toMatchObject({ statusCode: 429, outcome: "limited", retryAfter: 60 });
    expect((await receiveServerSample(second.token, sample(now), now)).outcome).toBe("accepted");
    const later = new Date(now.getTime() + 60_000);
    expect((await receiveServerSample(first.token, sample(later, 2), later)).outcome).toBe("accepted");
  });

  it("creates unrestricted server and HTTP monitors concurrently at their technical intervals", async () => {
    const { owner, caller } = await fixture();
    for (let i = 0; i < 8; i++) await createTestMonitor(owner.id);
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => i % 2
      ? caller.uptimeMonitor.server.create({ name: `Host ${i}`, interval: 60 })
      : caller.uptimeMonitor.monitor.create({ name: `Site ${i}`, url: `https://example.invalid/site-${i}`, interval: 30, active: false })));
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(12);
    expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, owner.id))).toHaveLength(21);
    const servers = await db.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, owner.id), eq(uptimeMonitor.monitorType, "server")));
    expect(servers).toHaveLength(7); expect(servers.every(server => server.interval === 60)).toBe(true);
  });

  it("bounds history by retention, rejects foreign channels and cascades metric deletion", async () => {
    const { owner, caller, token, monitorId } = await fixture();
    vi.stubEnv("CHECK_LOG_RETENTION_DAYS", "1");
    await expect(caller.uptimeMonitor.server.update({ name: "Host", monitorId, channelIds: ["foreign"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const now = new Date(); await receiveServerSample(token, sample(now), now);
    await db.insert(uptimeServerMetric).values({ userId: owner.id, monitorId, receivedAt: new Date(now.getTime() - 2 * 86400000).toISOString(), sample: { ...sample(now), version: 1, agent: { version: "1.0.0", arch: "amd64" }, load: [1, 2, 3] } });
    const history = await caller.uptimeMonitor.server.history({ monitorId, from: "2000-01-01T00:00:00.000Z", to: new Date(now.getTime() + 1000).toISOString(), limit: 1 });
    expect(history).toHaveLength(1); expect(history[0]?.receivedAt).toBe(now.toISOString());
    expect(await cleanupServerMetrics()).toBe(1);
    expect(apiServerConfiguration.safeParse({ name: "Host", thresholds: { cpu: -1 } }).success).toBe(false);
    await expect(caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: monitorId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it.each(["0", "-1", "invalid", "1.5"])("uses the thirty-day retention fallback for invalid CHECK_LOG_RETENTION_DAYS=%s", async value => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z"));
    vi.stubEnv("CHECK_LOG_RETENTION_DAYS", value);
    const { owner, caller, monitorId } = await fixture(); const now = new Date();
    await db.insert(uptimeServerMetric).values([
      { userId: owner.id, monitorId, receivedAt: "2026-09-25T12:00:00.000Z", sample: sample(now) },
      { userId: owner.id, monitorId, receivedAt: "2026-09-26T12:00:00.000Z", sample: sample(now, 2) },
    ]);
    expect((await caller.uptimeMonitor.server.one({ monitorId })).retentionDays).toBe(30);
    expect(await cleanupServerMetrics()).toBe(1);
    const history = await caller.uptimeMonitor.server.history({ monitorId, from: "2000-01-01T00:00:00.000Z", to: now.toISOString(), limit: 100 });
    expect(history).toHaveLength(1); expect(history[0]?.receivedAt).toBe("2026-09-26T12:00:00.000Z");
  });

  it("returns only the owner's bounded metric projections even when a metric has a mismatched owner", async () => {
    const { owner, caller, monitorId, token } = await fixture(); const now = new Date();
    const other = await createTestUser();
    await receiveServerSample(token, sample(now), now);
    await db.insert(uptimeServerMetric).values({ userId: other.id, monitorId, receivedAt: new Date(now.getTime() + 1000).toISOString(), sample: { ...sample(now, 99), memoryPercent: 99 } });
    const history = await caller.uptimeMonitor.server.history({ monitorId, from: new Date(now.getTime() - 1000).toISOString(), to: new Date(now.getTime() + 2000).toISOString(), limit: 100 });
    expect(history).toHaveLength(1); expect(history[0]?.sample.memoryPercent).toBe(42);
    expect(history[0]).not.toHaveProperty("userId"); expect(history[0]).not.toHaveProperty("id");
    expect((await caller.uptimeMonitor.server.one({ monitorId })).latest?.sample.memoryPercent).toBe(42);
    expect(owner.id).not.toBe(other.id);
  });

  it("publishes only sanitized server status and no private reasons or samples", async () => {
    const { owner, caller, token, monitorId } = await fixture();
    const page = await createTestStatusPage(owner.id, { slug: "servers", isPublished: true });
    await createTestStatusPageMonitor(page.statusPageId, monitorId);
    for (let sequence = 1; sequence <= 3; sequence++) {
      const now = new Date(Date.now() + sequence * 60000);
      await receiveServerSample(token, { ...sample(now, sequence), filesystems: [{ path: "/private-customer-data", usedPercent: 98 }] }, now);
    }
    const projection = await publicCaller().uptimeMonitor.public.statusPageBySlug({ userId: owner.id, slug: "servers" });
    expect(projection.overallStatus).toBe("degraded");
    const json = JSON.stringify(projection);
    for (const value of [token, "tokenHash", "tokenCipher", "/private-customer-data", "server_health:", "memoryPercent", "cpuPercent", "bootId", "amd64"]) expect(json).not.toContain(value);
    expect(await caller.uptimeMonitor.monitor.updateBulk({ monitorIds: [monitorId], patch: { method: "POST" } })).toMatchObject({
      updated:[],results:[{id:monitorId,status:"rejected",reason:expect.any(String)}],
    });
  });

});
