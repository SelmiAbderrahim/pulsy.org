import { afterEach, describe, expect, it, vi } from "vitest";
import { apiKey, db, uptimeMonitor, uptimeStatusPageMonitor } from "@pulsy/db";
import { eq } from "drizzle-orm";
import express from "express";
import type { Server } from "node:http";
import { createTestEmailProvider, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { resolveApiKey } from "../../../services/api-keys/api-key-service";
import { createV1Router } from "../../../api/v1/router";
useCleanDatabase();
afterEach(() => vi.unstubAllEnvs());
describe("owner management operations", () => {
  it("duplicates only owned page presentation/components into a private draft, then unpublishes and deletes", async () => {
    const owner = authedCaller(await createTestUser()), foreign = authedCaller(await createTestUser());
    const monitor = await owner.uptimeMonitor.monitor.create({ url: "qa-copy.example.test", active: false });
    const page = await owner.uptimeMonitor.statusPage.create({ title: "Service", slug: "service", isPublished: true, uptimeMonitorIds: [monitor.uptimeMonitorId] });
    await db.update(uptimeStatusPageMonitor).set({ publicName: "Public API", publicGroup: "Core", publicDescription: "Availability" }).where(eq(uptimeStatusPageMonitor.statusPageId, page.statusPageId));
    await expect(foreign.uptimeMonitor.statusPage.duplicate({ statusPageId: page.statusPageId, title: "Copy" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const copy = await owner.uptimeMonitor.statusPage.duplicate({ statusPageId: page.statusPageId, title: "Copy" });
    expect(copy).toMatchObject({ isPublished: false, customDomain: null, domainVerifyToken: null });
    expect(copy.slug).not.toBe(page.slug);
    const links = await db.select().from(uptimeStatusPageMonitor).where(eq(uptimeStatusPageMonitor.statusPageId, copy.statusPageId));
    expect(links).toEqual([expect.objectContaining({ uptimeMonitorId: monitor.uptimeMonitorId, publicName: "Public API", publicGroup: "Core" })]);
    expect(await owner.uptimeMonitor.statusPage.update({ statusPageId: page.statusPageId, isPublished: false })).toMatchObject({ isPublished: false });
    await expect(foreign.uptimeMonitor.statusPage.delete({ statusPageId: copy.statusPageId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.uptimeMonitor.statusPage.delete({ statusPageId: copy.statusPageId });
    expect(await db.select().from(uptimeStatusPageMonitor).where(eq(uptimeStatusPageMonitor.statusPageId, copy.statusPageId))).toEqual([]);
  });
  it("rejects Linux export without dropping eligible monitors or disclosing foreign IDs", async () => {
    const user = await createTestUser(), owner = authedCaller(user), other = authedCaller(await createTestUser());
    const [server] = await db.insert(uptimeMonitor).values({ userId: user.id, name: "Host", monitorType: "server", url: "", active: false }).returning();
    // Exercise the same owned export service used by tRPC and REST.
    const { exportMonitorConfiguration } = await import("../../../services/uptime/monitor-portability");
    const { getTranslator } = await import("../../../lib/i18n");
    const eligible = await owner.uptimeMonitor.monitor.create({ url: "eligible.example.test", active: false });
    await expect(exportMonitorConfiguration(user.id, [server!.uptimeMonitorId], getTranslator("en"))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(exportMonitorConfiguration(user.id, [eligible.uptimeMonitorId, server!.uptimeMonitorId], getTranslator("en"))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const foreignExport = await exportMonitorConfiguration("foreign-export-owner", [server!.uptimeMonitorId], getTranslator("en")).catch((error: unknown) => error);
    const missingExport = await exportMonitorConfiguration("foreign-export-owner", ["missing-server"], getTranslator("en")).catch((error: unknown) => error);
    expect(foreignExport).toMatchObject({ code: "NOT_FOUND" });
    expect(missingExport).toMatchObject({ code: "NOT_FOUND" });
    expect(foreignExport instanceof Error && foreignExport.message).toBe(missingExport instanceof Error && missingExport.message);
    await expect(other.uptimeMonitor.monitor.one({ uptimeMonitorId: server!.uptimeMonitorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await owner.uptimeMonitor.monitor.list()).toHaveLength(2);
  });
  it("permits an inactive report draft but rejects active delivery with an unverified owned provider", async () => {
    const user = await createTestUser(), caller = authedCaller(user);
    const provider = await createTestEmailProvider(user.id, { verified: false });
    const input = { recipientAddresses: ["ops@fixtures.invalid"], emailProviderId: provider.emailProviderId };
    await expect(caller.uptimeMonitor.slaReport.subscription.upsert({ ...input, active: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const draft = await caller.uptimeMonitor.slaReport.subscription.upsert({ ...input, active: false });
    expect(draft).toMatchObject({ active: false });
    await expect(caller.uptimeMonitor.slaReport.subscription.upsert({ ...input, slaReportSubscriptionId: draft.slaReportSubscriptionId, active: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await caller.uptimeMonitor.slaReport.subscription.list()).toEqual([expect.objectContaining({ slaReportSubscriptionId: draft.slaReportSubscriptionId, active: false })]);
  });
  it("enforces per-key read scope and expiry through actual REST middleware and preserves legacy full keys", async () => {
    const user = await createTestUser(), caller = authedCaller(user);
    const read = await caller.apiKey.create({ name: "Read", scope: "read", expiresAt: new Date(Date.now() + 2 * 86400000).toISOString() });
    const full = await caller.apiKey.create({ name: "Write", scope: "full" });
    expect(await resolveApiKey(read.plaintext)).toMatchObject({ ok: true, scope: "read" });
    expect(await resolveApiKey(full.plaintext)).toMatchObject({ ok: true, scope: "full" });
    await expect(caller.apiKey.create({ name: "Expired", expiresAt: "2020-01-01T00:00:00Z" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const app = express(); app.use(express.json()); app.use("/api/v1", createV1Router());
    let server: Server | undefined;
    try {
      server = await new Promise<Server>(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
      const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address missing");
      const request = (path: string, method = "GET") => fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${read.plaintext}`, "Content-Type": "application/json" }, ...(method === "GET" ? {} : { body: "{}" }) });
      expect((await request("/monitors")).status).toBe(200);
      for (const [method, path] of [["POST", "/monitors"], ["PATCH", "/monitors/missing"], ["DELETE", "/monitors/missing"], ["POST", "/monitors/missing/check-now"], ["POST", "/configuration/apply"], ["POST", "/monitors/missing/annotations"]]) expect((await request(path!, method!)).status).toBe(403);
      await db.update(apiKey).set({ expiresAt: new Date(Date.now() - 1).toISOString() }).where(eq(apiKey.apiKeyId, read.apiKeyId));
      expect((await request("/monitors")).status).toBe(401);
    } finally { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } }
    const masked = await caller.apiKey.list(); expect(JSON.stringify(masked)).not.toContain(read.plaintext); expect(masked[0]).not.toHaveProperty("hashedKey");
    await expect(authedCaller(await createTestUser()).apiKey.revoke({ apiKeyId: full.apiKeyId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
