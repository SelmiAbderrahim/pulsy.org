import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeServer, uptimeMonitor } from "@pulsy/db";
import { and, eq } from "drizzle-orm";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
import { decrypt } from "../../../lib/crypto";
import { getTranslator } from "../../../lib/i18n";
import { receiveServerSample } from "../../../services/uptime/server-health-service";

useCleanDatabase();
afterEach(() => vi.unstubAllEnvs());

const configuration = { name: "Owned server", interval: 60, active: true, tags: ["internal"] };
const from = new Date(Date.now() - 3_600_000).toISOString();
const to = new Date(Date.now() + 3_600_000).toISOString();

describe("protected server-health API", () => {
  it("requires a session for all five server operations", async () => {
    const caller = publicCaller();
    const requests = [
      caller.uptimeMonitor.server.create(configuration),
      caller.uptimeMonitor.server.one({ monitorId: "unknown" }),
      caller.uptimeMonitor.server.rotate({ monitorId: "unknown" }),
      caller.uptimeMonitor.server.history({ monitorId: "unknown", from, to }),
      caller.uptimeMonitor.server.update({ ...configuration, monitorId: "unknown" }),
    ];
    const results = await Promise.allSettled(requests);
    for (const result of results) expect(result).toMatchObject({ status: "rejected", reason: { code: "UNAUTHORIZED" } });
  });

  it("creates the freely available 60-second server monitor with one-time credentials and explicit owner fields", async () => {
    const owner = await createTestUser();
    const caller = authedCaller({ ...owner, language: "ar" });
    const created = await caller.uptimeMonitor.server.create(configuration);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.monitor).toMatchObject({ name: configuration.name, monitorType: "server", interval: 60, requestConfigured: false });
    for (const key of ["userId", "requestCipher", "notificationOutageId", "lastOperationalAlertId", "lastOperationalAlertAt", "consecutiveSlow", "consecutiveHealthy"]) {
      expect(created.monitor).not.toHaveProperty(key);
    }
    const stored = await db.query.uptimeServer.findFirst({ where: and(eq(uptimeServer.userId, owner.id), eq(uptimeServer.monitorId, created.monitor.uptimeMonitorId)) });
    expect(stored).toBeDefined();
    expect(stored?.locale).toBe("ar");
    expect(stored?.thresholds).toEqual({ cpu: 90, memory: 90, disk: 90 });
    expect(stored?.tokenCipher).not.toContain(created.token);
    expect(decrypt(stored!.tokenCipher)).toBe(created.token);
    const outputs = [
      await caller.uptimeMonitor.server.one({ monitorId: created.monitor.uptimeMonitorId }),
      await caller.uptimeMonitor.server.history({ monitorId: created.monitor.uptimeMonitorId, from, to }),
      await caller.uptimeMonitor.monitor.list(),
      await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: created.monitor.uptimeMonitorId }),
    ];
    const serialized = JSON.stringify(outputs);
    expect(serialized).not.toContain(created.token);
    expect(serialized).not.toContain(stored!.tokenCipher);
    expect(serialized).not.toContain(stored!.tokenHash);
    expect(serialized).not.toContain('"tokenCipher"');
    expect(serialized).not.toContain('"tokenHash"');
  });

  it("rejects cross-user one, history, rotate and update without altering another owner's credential", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const created = await authedCaller(owner).uptimeMonitor.server.create(configuration);
    const caller = authedCaller(stranger);
    const monitorId = created.monitor.uptimeMonitorId;
    const requests = [
      caller.uptimeMonitor.server.one({ monitorId }),
      caller.uptimeMonitor.server.history({ monitorId, from, to }),
      caller.uptimeMonitor.server.rotate({ monitorId }),
      caller.uptimeMonitor.server.update({ ...configuration, name: "Foreign edit", monitorId }),
    ];
    const results = await Promise.allSettled(requests);
    for (const result of results) expect(result).toMatchObject({ status: "rejected", reason: { code: "NOT_FOUND" } });
    const row = await db.query.uptimeMonitor.findFirst({ where: and(eq(uptimeMonitor.userId, owner.id), eq(uptimeMonitor.uptimeMonitorId, monitorId)) });
    expect(row?.name).toBe(configuration.name);
    const secret = await db.query.uptimeServer.findFirst({ where: and(eq(uptimeServer.userId, owner.id), eq(uptimeServer.monitorId, monitorId)) });
    expect(decrypt(secret!.tokenCipher)).toBe(created.token);
  });

  it("updates server settings and rotates the one-time credential while polling remains secret-free", async () => {
    const owner = await createTestUser();
    const caller = authedCaller(owner);
    const created = await caller.uptimeMonitor.server.create(configuration);
    const monitorId = created.monitor.uptimeMonitorId;
    const updated = await caller.uptimeMonitor.server.update({ ...configuration, monitorId, name: "Changed server", thresholds: { cpu: 80, memory: 85, disk: 95 }, excludedFilesystems: ["/backup"] });
    expect(updated).toMatchObject({ name: "Changed server", interval: 60 });
    expect(updated).not.toHaveProperty("userId");
    expect(updated).not.toHaveProperty("requestCipher");
    const rotated = await caller.uptimeMonitor.server.rotate({ monitorId });
    expect(Object.keys(rotated)).toEqual(["token"]);
    expect(rotated.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rotated.token).not.toBe(created.token);
    const one = await caller.uptimeMonitor.server.one({ monitorId });
    expect(one).toMatchObject({ interval: 60, thresholds: { cpu: 80, memory: 85, disk: 95 }, excludedFilesystems: ["/backup"] });
    expect(JSON.stringify(one)).not.toContain(rotated.token);
    expect(JSON.stringify(one)).not.toContain(created.token);
  });

  it("returns only owned metric history and audited sample fields", async () => {
    const owner = await createTestUser();
    const caller = authedCaller(owner);
    const created = await caller.uptimeMonitor.server.create(configuration);
    const sample = { version: 1, bootId: "a811372b-61f5-444a-9cbe-9a1c651a8e49", sequence: 1, sampledAt: new Date().toISOString(), agent: { version: "1.0.0", arch: "amd64" }, cpuPercent: 25, memoryPercent: 42, swapPercent: null, load: null, uptimeSeconds: 120, filesystems: [] };
    expect(await receiveServerSample(created.token, sample)).toMatchObject({ statusCode: 200, outcome: "accepted", interval: 60 });
    const history = await caller.uptimeMonitor.server.history({ monitorId: created.monitor.uptimeMonitorId, from, to });
    expect(history).toHaveLength(1);
    expect(Object.keys(history[0]!).sort()).toEqual(["receivedAt", "sample"]);
    expect(history[0]?.sample).toEqual(sample);
    expect(JSON.stringify(history)).not.toContain(created.token);
  });

  it("localizes invalid server input before any monitor is persisted", async () => {
    const owner = await createTestUser();
    const caller = authedCaller({ ...owner, language: "fr" });
    await expect(caller.uptimeMonitor.server.create({ ...configuration, interval: 59 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: getTranslator("fr")("errors.serverInvalid") });
    await expect(caller.uptimeMonitor.server.create({ ...configuration, excludedFilesystems: ["relative"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.uptimeMonitor.server.history({ monitorId: "unknown", from: to, to: from })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, owner.id))).toHaveLength(0);
  });
});
