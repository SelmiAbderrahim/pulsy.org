import { createServer } from "node:http";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeMonitor, uptimeNotificationChannel, uptimeMonitorChannelBinding } from "@pulsy/db";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { dispatchNotifications } from "../notification-service";
useCleanDatabase();
afterEach(() => vi.unstubAllEnvs());
describe("notification channel ownership at worker dispatch", () => {
  it("never delivers through a foreign channel even if stored with the same monitor ID", async () => {
    const events: string[] = []; const server = createServer(async (request, reply) => {
      let bytes = 0; for await (const chunk of request) { bytes += chunk.length; if (bytes > 4096) { reply.writeHead(413); reply.end(); return; } }
      events.push(request.url ?? ""); reply.writeHead(200); reply.end("received");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address missing");
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
    try {
      const owner = await createTestUser(); const foreign = await createTestUser(); const caller = authedCaller(owner);
      const monitor = await caller.uptimeMonitor.monitor.create({ name: "Owned", url: "http://fixture.invalid", active: false });
      const target = `http://127.0.0.1:${address.port}`;
      const ownedChannel = await caller.uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: `${target}/owned` });
      // An inconsistent legacy/import row must not turn monitor identity into account authority.
      await db.insert(uptimeNotificationChannel).values({ userId: foreign.id, uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: `${target}/foreign`, notifyOnDown: true });
      const visible = await caller.uptimeMonitor.channel.list({ uptimeMonitorId: monitor.uptimeMonitorId });
      expect(visible.map(channel => channel.channelId)).toEqual([ownedChannel.channelId]);
      expect((await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: monitor.uptimeMonitorId })).notificationChannels.map(channel => channel.channelId)).toEqual([ownedChannel.channelId]);
      const stored = await db.query.uptimeMonitor.findFirst({ where: and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, owner.id)) }); if (!stored) throw new Error("Owned fixture missing");
      await dispatchNotifications(stored, { statusChangeId: "ownership-fixture", uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down", httpStatus: 503, responseTime: 10, reason: null, createdAt: new Date().toISOString() }, { delaysMs: [] });
      expect(events).toEqual(["/owned"]);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it("reuses owned channel policy with one receipt and ignores inconsistent foreign bindings", async () => {
    const events: string[] = []; const server = createServer(async (request, reply) => {
      for await (const _chunk of request) { /* discard fixture body */ }
      events.push(request.url ?? ""); reply.writeHead(200); reply.end("received");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address missing");
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
    try {
      const owner = await createTestUser(); const other = await createTestUser(); const caller = authedCaller(owner);
      const source = await caller.uptimeMonitor.monitor.create({ name: "Channel owner", url: "http://fixture.invalid", active: false });
      const channel = await caller.uptimeMonitor.channel.create({ uptimeMonitorId: source.uptimeMonitorId, channelType: "webhook", webhookUrl: `http://127.0.0.1:${address.port}/shared` });
      const bound = await caller.uptimeMonitor.monitor.create({ name: "Bound", url: "http://fixture.invalid/bound", active: false, channelIds: [channel.channelId] });
      // A default with the same destination must not double-send the referenced channel.
      await caller.uptimeMonitor.channel.createDefault({ channelType: "webhook", webhookUrl: `http://127.0.0.1:${address.port}/shared` });
      const [foreign] = await db.insert(uptimeNotificationChannel).values({ userId: other.id, channelType: "webhook", webhookUrl: `http://127.0.0.1:${address.port}/foreign` }).returning();
      await db.insert(uptimeMonitorChannelBinding).values({ userId: owner.id, monitorId: bound.uptimeMonitorId, channelId: foreign!.channelId });
      const stored = await db.query.uptimeMonitor.findFirst({ where: and(eq(uptimeMonitor.uptimeMonitorId, bound.uptimeMonitorId), eq(uptimeMonitor.userId, owner.id)) }); if (!stored) throw new Error("Fixture missing");
      await dispatchNotifications(stored, { statusChangeId: "binding-fixture", uptimeMonitorId: stored.uptimeMonitorId, statusBefore: "up", statusAfter: "down", httpStatus: 503, responseTime: 10, reason: null, createdAt: new Date().toISOString() }, { delaysMs: [] });
      expect(events).toEqual(["/shared"]);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

});
