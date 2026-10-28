import { and, eq } from "drizzle-orm";
import { db, uptimeMonitor } from "@pulsy/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { getTranslator } from "../../../lib/i18n";
import { runManualCheck } from "../monitor-operations";
vi.mock("../scheduler-service", () => ({ scheduleMonitorCheck: vi.fn(), cancelMonitorCheck: vi.fn(), rescheduleMonitorCheck: vi.fn(), withMonitorCheckSlot: async <T,>(work: () => Promise<T>) => work() }));
const check = vi.hoisted(() => ({ status: "up" as "up" | "down", duration: 100 }));
vi.mock("../checker-service", async importActual => ({ ...await importActual<typeof import("../checker-service")>(), performHttpCheck: vi.fn(async () => ({ status: check.status, httpStatus: check.status === "up" ? 200 : 503, responseTime: check.duration })) }));
const service = await import("../reliability-service").catch(() => null);
useCleanDatabase(); const t = getTranslator("en"), at = Date.parse("2026-10-10T00:00:00.000Z");
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); check.status = "up"; check.duration = 100; });
describe("owned durable reliability measurements", () => {
  it("records actual manual-check observations across midnight, with an exact clipped window and stale gaps", async () => {
    expect(service).not.toBeNull(); if (!service) return;
    vi.useFakeTimers({ toFake: ["Date"] }); const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { interval: 60, failureThreshold: 1 });
    vi.setSystemTime(at - 30000); await service.configureReliability(owner.id, monitor.uptimeMonitorId, { availabilityTargetBps: 9990, latencyTargetMs: 100, excludeMaintenance: false }, t);
    await runManualCheck(monitor);
    vi.setSystemTime(at + 30000); check.status = "down";
    const latest = await db.query.uptimeMonitor.findFirst({ where: and(eq(uptimeMonitor.userId, owner.id), eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId)) }); await runManualCheck(latest!);
    vi.setSystemTime(at + 180000);
    const view = await service.readReliability(owner.id, monitor.uptimeMonitorId, { from: new Date(at).toISOString(), to: new Date(at + 180000).toISOString() }, t);
    expect(view.raw.upMs).toBe(30000); expect(view.raw.downMs).toBe(60000); expect(view.raw.unknownMs).toBe(90000);
    expect(view.raw.availabilityPercent).toBeCloseTo(100 / 3); expect(view.raw.allowedDowntimeMs).toBe(90); expect(view.raw.remainingBudgetMs).toBe(0);
    expect(view.asOf).toBe(new Date(at + 180000).toISOString());
  });
  it("does not reinterpret legacy logs as continuous observed health and scopes configuration/history to the owner", async () => {
    expect(service).not.toBeNull(); if (!service) return;
    const owner = await createTestUser(); const other = await createTestUser(); const monitor = await createTestMonitor(owner.id);
    await expect(service.configureReliability(other.id, monitor.uptimeMonitorId, { availabilityTargetBps: 9990, latencyTargetMs: null, excludeMaintenance: false }, t)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const to = new Date(), from = new Date(to.getTime() - 86400000);
    const view = await service.readReliability(owner.id, monitor.uptimeMonitorId, { from: from.toISOString(), to: to.toISOString() }, t);
    expect(view.raw.availabilityPercent).toBeNull(); expect(view.raw.observedMs).toBe(0); expect(view.raw.unknownMs).toBe(86400000);
    await expect(service.readReliability(other.id, monitor.uptimeMonitorId, { from: from.toISOString(), to: to.toISOString() }, t)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("preserves goal versions without duplicating a repeated configuration or changing measured status", async () => {
    expect(service).not.toBeNull(); if (!service) return;
    const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { status: "down" });
    const configuration = { availabilityTargetBps: 9990, latencyTargetMs: 100, excludeMaintenance: false };
    const first = await service.configureReliability(owner.id, monitor.uptimeMonitorId, configuration, t);
    const repeated = await service.configureReliability(owner.id, monitor.uptimeMonitorId, configuration, t); expect(repeated.id).toBe(first.id);
    const second = await service.configureReliability(owner.id, monitor.uptimeMonitorId, { ...configuration, excludeMaintenance: true }, t); expect(second.version).toBe(first.version + 1);
    expect((await db.query.uptimeMonitor.findFirst({ where: eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId) }))!.status).toBe("down");
  });
});
