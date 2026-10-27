import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeMonitor, uptimeCheckLog, uptimeMaintenance, uptimeReliabilityDay, uptimeReliabilityCursor } from "@pulsy/db";
import { and, eq } from "drizzle-orm";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { getTranslator } from "../../../lib/i18n";
import { configureReliability, readReliability } from "../reliability-service";
import { insertObservedCheck, DAY_MS } from "../reliability-storage";
useCleanDatabase(); const t = getTranslator("en"), midnight = Date.parse("2026-10-09T00:00:00.000Z");
afterEach(() => vi.useRealTimers());
async function observe(userId: string, monitorId: string, at: number, status: "up" | "down" | "degraded", duration = 100, rollback = false) {
  return db.transaction(async tx => {
    const [monitor] = await tx.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, userId), eq(uptimeMonitor.uptimeMonitorId, monitorId))).for("update");
    const result = await insertObservedCheck(tx, monitor!, { createdAt: new Date(at).toISOString(), status, responseTime: duration, httpStatus: 200 });
    if (rollback) throw new Error("Disposable rollback"); return result;
  });
}
function clock(at: number) { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at); }
describe("captured reliability storage", () => {
  it("keeps heartbeat observation gaps unknown over 24 hours and reconciles availability, coverage and downtime", async () => {
    clock(midnight + DAY_MS);
    const owner = await createTestUser(), monitor = await createTestMonitor(owner.id, { monitorType: "heartbeat", interval: 300 });
    // Success proves five minutes, grace evaluation proves one minute before Down,
    // then one five-minute Down observation. The next receipt is after a 49-minute gap.
    await observe(owner.id, monitor.uptimeMonitorId, midnight, "up");
    await observe(owner.id, monitor.uptimeMonitorId, midnight + 300_000, "degraded");
    await observe(owner.id, monitor.uptimeMonitorId, midnight + 360_000, "down");
    await observe(owner.id, monitor.uptimeMonitorId, midnight + 3_600_000, "up");
    const view = await readReliability(owner.id, monitor.uptimeMonitorId, { from: new Date(midnight).toISOString(), to: new Date(midnight + DAY_MS).toISOString() }, t);
    expect(view.raw).toMatchObject({ windowMs: DAY_MS, upMs: 600_000, degradedMs: 60_000, downMs: 300_000, observedMs: 960_000, unknownMs: DAY_MS - 960_000, consumedDowntimeMs: 360_000, availabilityPercent: 62.5 });
    expect(view.raw.coveragePercent).toBeCloseTo(960_000 / DAY_MS * 100, 6);
    expect(view.raw.latencyEligibleMs).toBe(0);
    expect(view.checkSuccessPercent).toBe(50);
  });
  it("reads a completed UTC day and current partial day without double counting its durable cursor", async () => {
    clock(midnight + 2 * DAY_MS); const owner = await createTestUser(), monitor = await createTestMonitor(owner.id, { interval: 86400, active: false });
    await configureReliability(owner.id, monitor.uptimeMonitorId, { availabilityTargetBps: 9990, latencyTargetMs: 100, excludeMaintenance: false }, t);
    await observe(owner.id, monitor.uptimeMonitorId, midnight, "up"); await observe(owner.id, monitor.uptimeMonitorId, midnight + DAY_MS, "down");
    const view = await readReliability(owner.id, monitor.uptimeMonitorId, { from: new Date(midnight).toISOString(), to: new Date(midnight + DAY_MS + 3600000).toISOString() }, t);
    expect(view.raw.upMs).toBe(DAY_MS); expect(view.raw.downMs).toBe(3600000); expect(view.raw.unknownMs).toBe(0); expect(view.checks).toBe(2);
    expect(view.raw.latencyEligibleMs).toBe(DAY_MS); expect(view.raw.latencyMetMs).toBe(DAY_MS); expect(view.series).toHaveLength(2);
    expect((await readReliability(owner.id, monitor.uptimeMonitorId, { from: new Date(midnight).toISOString(), to: new Date(midnight + DAY_MS + 3600000).toISOString() }, t)).raw).toEqual(view.raw);
  });
  it("freezes overlapping maintenance and latency policies without subtracting snooze or rewriting raw downtime", async () => {
    clock(midnight + 120000); const owner = await createTestUser(), monitor = await createTestMonitor(owner.id, { interval: 60 });
    const first = await configureReliability(owner.id, monitor.uptimeMonitorId, { availabilityTargetBps: 9990, latencyTargetMs: 100, excludeMaintenance: true }, t);
    for (const [kind, start, end] of [["maintenance", 10000, 30000], ["maintenance", 20000, 40000], ["snooze", 0, 60000]] as const) await db.insert(uptimeMaintenance).values({ userId: owner.id, monitorIds: [monitor.uptimeMonitorId], name: "Private", kind, startsAt: new Date(midnight + start).toISOString(), endsAt: new Date(midnight + end).toISOString() });
    await observe(owner.id, monitor.uptimeMonitorId, midnight, "down");
    await db.delete(uptimeMaintenance).where(eq(uptimeMaintenance.userId, owner.id));
    const second = await configureReliability(owner.id, monitor.uptimeMonitorId, { availabilityTargetBps: 9990, latencyTargetMs: 200, excludeMaintenance: false }, t);
    await observe(owner.id, monitor.uptimeMonitorId, midnight + 60000, "degraded", 150);
    const view = await readReliability(owner.id, monitor.uptimeMonitorId, { from: new Date(midnight).toISOString(), to: new Date(midnight + 120000).toISOString() }, t);
    expect(view.raw.downMs).toBe(60000); expect(view.raw.degradedMs).toBe(60000); expect(view.maintenanceAdjusted?.excludedMs).toBe(30000); expect(view.maintenanceAdjusted?.downMs).toBe(30000);
    expect(view.policyIds.sort()).toEqual([first.id, second.id].sort()); expect(view.raw.latencyMetMs).toBe(60000);
  });
  it("gives equal and out-of-order observations zero superseded duration while retaining their sample facts", async () => {
    clock(midnight + 180000); const owner = await createTestUser(), monitor = await createTestMonitor(owner.id, { interval: 60 });
    await observe(owner.id, monitor.uptimeMonitorId, midnight, "up"); await observe(owner.id, monitor.uptimeMonitorId, midnight, "down");
    await observe(owner.id, monitor.uptimeMonitorId, midnight + 60000, "up"); await observe(owner.id, monitor.uptimeMonitorId, midnight + 30000, "down");
    const view = await readReliability(owner.id, monitor.uptimeMonitorId, { from: new Date(midnight).toISOString(), to: new Date(midnight + 180000).toISOString() }, t);
    expect(view.raw.downMs).toBe(60000); expect(view.raw.upMs).toBe(60000); expect(view.raw.unknownMs).toBe(60000); expect(view.checks).toBe(4);
    expect((await db.select().from(uptimeReliabilityCursor))[0]!.observation.at).toBe(midnight + 60000);
  });
  it("rolls back facts, cursor and buckets together and never reports heartbeat run duration as request latency", async () => {
    clock(midnight + 60000); const owner = await createTestUser(), monitor = await createTestMonitor(owner.id, { monitorType: "heartbeat", interval: 60 });
    await expect(observe(owner.id, monitor.uptimeMonitorId, midnight, "up", 999, true)).rejects.toThrow("Disposable rollback");
    expect(await db.select().from(uptimeCheckLog)).toHaveLength(0); expect(await db.select().from(uptimeReliabilityDay)).toHaveLength(0); expect(await db.select().from(uptimeReliabilityCursor)).toHaveLength(0);
    await observe(owner.id, monitor.uptimeMonitorId, midnight, "up", 999);
    const view = await readReliability(owner.id, monitor.uptimeMonitorId, { from: new Date(midnight).toISOString(), to: new Date(midnight + 60000).toISOString() }, t);
    expect(view.raw.upMs).toBe(60000); expect(view.averageTimingMs).toBeNull(); expect(view.raw.latencyEligibleMs).toBe(0);
  });
});
