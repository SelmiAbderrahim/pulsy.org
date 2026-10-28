import { and, eq } from "drizzle-orm";
import { db, uptimeMonitor, uptimeReliabilityAnnotation } from "@pulsy/db";
import { describe, expect, it } from "vitest";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
useCleanDatabase();
describe("private reliability workflow", () => {
  it("keeps goal settings and annotations owned, validates writes and refuses anonymous access", async () => {
    const owner = await createTestUser(), other = await createTestUser(); const caller = authedCaller(owner);
    const monitor = await caller.uptimeMonitor.monitor.create({ name: "Private API", url: "http://fixture.invalid", active: false });
    await expect(publicCaller().uptimeMonitor.reliability.configure({ monitorId: monitor.uptimeMonitorId, configuration: { availabilityTargetBps: 9990, latencyTargetMs: null, excludeMaintenance: false } })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(authedCaller(other).uptimeMonitor.reliability.configure({ monitorId: monitor.uptimeMonitorId, configuration: { availabilityTargetBps: 9990, latencyTargetMs: null, excludeMaintenance: false } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await caller.uptimeMonitor.reliability.configure({ monitorId: monitor.uptimeMonitorId, configuration: { availabilityTargetBps: 9990, latencyTargetMs: null, excludeMaintenance: false } });
    await expect(caller.uptimeMonitor.reliability.annotate({ monitorId: monitor.uptimeMonitorId, annotation: { at: new Date().toISOString(), text: "Release", link: "javascript:alert(1)" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("redacts known request values before storage, preserves timestamp and pages equal-time annotations without cross-account authority", async () => {
    const owner = await createTestUser(), other = await createTestUser(); const caller = authedCaller(owner);
    const monitor = await caller.uptimeMonitor.monitor.create({ name: "Private API", url: "http://fixture.invalid", active: false, requestConfig: { headers: [{ name: "X-Release-Secret", value: "private-fixture-value" }] } });
    const at = new Date().toISOString();
    for (let i = 0; i < 3; i++) await caller.uptimeMonitor.reliability.annotate({ monitorId: monitor.uptimeMonitorId, annotation: { at, text: `Release ${i} private-fixture-value`, environment: "production", version: "v2", link: "https://example.invalid/releases/v2" } });
    const saved = await db.select().from(uptimeReliabilityAnnotation).where(and(eq(uptimeReliabilityAnnotation.userId, owner.id), eq(uptimeReliabilityAnnotation.monitorId, monitor.uptimeMonitorId)));
    expect(saved).toHaveLength(3); expect(JSON.stringify(saved)).not.toContain("private-fixture-value"); expect(saved.every(item => item.at === at && item.actorId === owner.id)).toBe(true);
    const window = { from: new Date(Date.parse(at) - 1000).toISOString(), to: new Date(Date.parse(at) + 1000).toISOString() };
    const first = await caller.uptimeMonitor.reliability.annotations({ monitorId: monitor.uptimeMonitorId, window, limit: 2 }); expect(first.data).toHaveLength(2); expect(first.nextCursor).not.toBeNull();
    const next = await caller.uptimeMonitor.reliability.annotations({ monitorId: monitor.uptimeMonitorId, window, limit: 2, cursor: first.nextCursor! }); expect(next.data).toHaveLength(1); expect(new Set([...first.data, ...next.data].map(row => row.id)).size).toBe(3);
    await expect(authedCaller(other).uptimeMonitor.reliability.annotations({ monitorId: monitor.uptimeMonitorId, window, limit: 2 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await db.query.uptimeMonitor.findFirst({ where: eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId) }))!.isPublic).toBe(false);
  });
});
