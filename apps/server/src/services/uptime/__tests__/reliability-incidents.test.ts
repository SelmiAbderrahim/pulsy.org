import { describe, expect, it, vi, afterEach } from "vitest";
import { db, uptimeIncident } from "@pulsy/db";
import { createTestUser, createTestMonitor, useCleanDatabase } from "../../../../test/db";
import { getTranslator } from "../../../lib/i18n";
const service = await import("../reliability-incidents").catch(() => null);
useCleanDatabase(); const start = Date.parse("2026-10-10T00:00:00.000Z"), t = getTranslator("en"), iso = (at: number) => new Date(at).toISOString();
afterEach(() => vi.useRealTimers());
describe("retained incident window context", () => {
  it("clips crossing incidents to the requested window, pages equal-time incidents stably and scopes causes to the owner", async () => {
    expect(service).not.toBeNull(); if (!service) return; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(start + 120000);
    const owner = await createTestUser(), other = await createTestUser(), monitor = await createTestMonitor(owner.id), foreign = await createTestMonitor(other.id);
    await db.insert(uptimeIncident).values([
      { uptimeMonitorId: monitor.uptimeMonitorId, status: "resolved", cause: "timeout", startedAt: iso(start - 60000), resolvedAt: iso(start + 10000), durationSeconds: 70 },
      { uptimeMonitorId: monitor.uptimeMonitorId, status: "ongoing", cause: "timeout", startedAt: iso(start + 10000) },
      { uptimeMonitorId: monitor.uptimeMonitorId, status: "resolved", cause: "old", startedAt: iso(start - 60000), resolvedAt: iso(start), durationSeconds: 60 },
      { uptimeMonitorId: monitor.uptimeMonitorId, status: "resolved", cause: "other", startedAt: iso(start + 10000), resolvedAt: iso(start + 20000), durationSeconds: 10 },
      { uptimeMonitorId: foreign.uptimeMonitorId, status: "ongoing", cause: "private foreign", startedAt: iso(start) },
    ]);
    const input = { window: { from: iso(start), to: iso(start + 60000) }, limit: 1 };
    const page = await service.readReliabilityIncidents(owner.id, monitor.uptimeMonitorId, input, t); expect(page.causesComplete).toBe(true); expect(page.incidentCount).toBe(3);
    expect(page.causes.find(cause => cause.cause === "timeout")).toMatchObject({ count: 2, durationMs: 60000 });
    const second = await service.readReliabilityIncidents(owner.id, monitor.uptimeMonitorId, { ...input, cursor: page.nextCursor! }, t); expect(second.data[0]!.id).not.toBe(page.data[0]!.id);
    expect(JSON.stringify(page)).not.toContain("private foreign"); await expect(service.readReliabilityIncidents(other.id, monitor.uptimeMonitorId, input, t)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
