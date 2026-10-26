import { createServer } from "node:net";
import { Resolver } from "node:dns/promises";
import { createSocket } from "node:dgram";
import { and, eq } from "drizzle-orm";
import { db, uptimeCheckLog, uptimeIncident, uptimeMonitor } from "@pulsy/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { executeCheck } from "../scheduler-service";
useCleanDatabase(); afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const config = { name: "Port health", configuration: { type: "tcp" as const, hostname: "127.0.0.1", port: 9876 }, interval: 300 as const, timeout: 1000, failureThreshold: 1, active: false, tags: ["env:staging"] };
describe("owned scheduled network monitors", () => {
  it("persists native DNS answer change and recovery without replacing the expected baseline", async () => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true"); const owner = await createTestUser(); const caller = authedCaller(owner);
    let answer = [1, 1, 1, 1]; const sink = createSocket("udp4");
    sink.on("message", (request, remote) => {
      let end = 12; while (request[end]) end += request[end]! + 1; end += 5;
      const header = Buffer.from(request.subarray(0, end)); header.writeUInt16BE(0x8180, 2); header.writeUInt16BE(1, 6);
      const rr = Buffer.alloc(12); rr.writeUInt16BE(0xc00c, 0); rr.writeUInt16BE(1, 2); rr.writeUInt16BE(1, 4); rr.writeUInt32BE(30, 6); rr.writeUInt16BE(4, 10);
      sink.send(Buffer.concat([header, rr, Buffer.from(answer)]), remote.port, remote.address);
    });
    await new Promise<void>(resolve => sink.bind(0, "127.0.0.1", resolve)); const port = sink.address().port;
    const fixtureResolver = new Resolver(); fixtureResolver.setServers([`127.0.0.1:${port}`]);
    const nativeResolve = Resolver.prototype.resolve4;
    vi.spyOn(Resolver.prototype, "resolve4").mockImplementation(nativeResolve.bind(fixtureResolver));
    try {
      const created = await caller.uptimeMonitor.network.create({ ...config, configuration: { type: "dns", hostname: "native.fixture.invalid", recordType: "A", mode: "matches", expected: ["1.1.1.1"] } });
      await db.update(uptimeMonitor).set({ active: true }).where(and(eq(uptimeMonitor.userId, owner.id), eq(uptimeMonitor.uptimeMonitorId, created.uptimeMonitorId)));
      expect((await caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: created.uptimeMonitorId })).status).toBe("up");
      answer = [8, 8, 8, 8]; await executeCheck(created.uptimeMonitorId);
      expect((await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: created.uptimeMonitorId })).status).toBe("down");
      const [incident] = await db.select().from(uptimeIncident).where(eq(uptimeIncident.uptimeMonitorId, created.uptimeMonitorId)); expect(incident!.status).toBe("ongoing");
      answer = [1, 1, 1, 1]; const recovered = await caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: created.uptimeMonitorId }); expect(recovered.status).toBe("up");
      expect(recovered.networkConfig).toMatchObject({ expected: ["1.1.1.1"] });
      expect((await db.select().from(uptimeIncident).where(eq(uptimeIncident.incidentId, incident!.incidentId)))[0]!.status).toBe("resolved");
      const logs = await db.select().from(uptimeCheckLog).where(eq(uptimeCheckLog.uptimeMonitorId, created.uptimeMonitorId)); expect(logs).toHaveLength(3); expect(logs.every(row => row.httpStatus === null)).toBe(true);
    } finally { fixtureResolver.cancel(); await new Promise<void>(resolve => sink.close(resolve)); }
  });
  it("creates typed monitors in the shared pool and isolates configuration and checks", async () => {
    const owner = await createTestUser(); const other = await createTestUser(); const caller = authedCaller(owner);
    const created = await caller.uptimeMonitor.network.create(config);
    expect(created).toMatchObject({ monitorType: "tcp", networkConfig: config.configuration, status: "pending", isPublic: false });
    await expect(authedCaller(other).uptimeMonitor.network.update({ ...config, monitorId: created.uptimeMonitorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authedCaller(other).uptimeMonitor.monitor.checkNow({ uptimeMonitorId: created.uptimeMonitorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.uptimeMonitor.network.update({ ...config, monitorId: created.uptimeMonitorId, configuration: { type: "dns", hostname: "example.invalid", recordType: "A", mode: "exists", expected: [] } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("uses the real TCP check pipeline for Down→Up recovery without fabricated HTTP or TLS state", async () => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true"); const owner = await createTestUser(); const caller = authedCaller(owner);
    const server = createServer(socket => { socket.on("error", () => {}); socket.resume(); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture port");
    const created = await caller.uptimeMonitor.network.create({ ...config, configuration: { ...config.configuration, port: address.port } });
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.update(uptimeMonitor).set({ active: true }).where(and(eq(uptimeMonitor.userId, owner.id), eq(uptimeMonitor.uptimeMonitorId, created.uptimeMonitorId)));
    const failed = await caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: created.uptimeMonitorId }); expect(failed.status).toBe("down");
    expect(failed.httpStatus).toBeNull(); expect(failed.tlsExpiresAt).toBeNull();
    const [incident] = await db.select().from(uptimeIncident).where(eq(uptimeIncident.uptimeMonitorId, created.uptimeMonitorId)); expect(incident!.status).toBe("ongoing");
    await new Promise<void>(resolve => server.listen(address.port, "127.0.0.1", resolve));
    try {
      await db.update(uptimeMonitor).set({ active: true }).where(and(eq(uptimeMonitor.userId, owner.id), eq(uptimeMonitor.uptimeMonitorId, created.uptimeMonitorId)));
      await executeCheck(created.uptimeMonitorId);
      const recovered = await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: created.uptimeMonitorId }); expect(recovered.status).toBe("up"); expect(recovered.responseTime).toBeGreaterThanOrEqual(0);
      const logs = await db.select().from(uptimeCheckLog).where(eq(uptimeCheckLog.uptimeMonitorId, created.uptimeMonitorId)); expect(logs.map(row => row.status).sort()).toEqual(["down", "up"]);
      expect((await db.select().from(uptimeIncident).where(eq(uptimeIncident.incidentId, incident!.incidentId)))[0]!.status).toBe("resolved");
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it("allows concurrent DNS/TCP and HTTP creation at the technical interval floor", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    await caller.uptimeMonitor.monitor.createBulk({ monitors: Array.from({ length: 11 }, (_, index) => ({ name: `HTTP ${index}`, url: `https://example.invalid/${index}`, interval: 30, active: false })) });
    const results = await Promise.all([caller.uptimeMonitor.network.create({ ...config, interval: 30 }), caller.uptimeMonitor.network.create({ ...config, interval: 30, configuration: { type: "dns", hostname: "example.invalid", recordType: "TXT", mode: "exists", expected: [] } })]);
    expect(results).toHaveLength(2); expect(await caller.uptimeMonitor.monitor.list()).toHaveLength(13);
  });
});
