import { describe, expect, it, vi, afterEach } from "vitest";
import { db, uptimeCheckLog } from "@pulsy/db";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
useCleanDatabase();
afterEach(() => vi.useRealTimers());

it("returns complete UTC daily buckets and keeps a foreign monitor unavailable", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  const owner = await createTestUser(), other = await createTestUser();
  const monitor = await createTestMonitor(owner.id);
  await db.insert(uptimeCheckLog).values({ uptimeMonitorId: monitor.uptimeMonitorId, status: "degraded", createdAt: "2026-10-26T10:00:00.000Z" });
  expect(await authedCaller(owner).uptimeMonitor.checkLog.daily({ uptimeMonitorId: monitor.uptimeMonitorId, days: 2 })).toEqual([
    { date: "2026-10-25", status: "unknown", uptimePercent: null, totalChecks: 0 },
    { date: "2026-10-26", status: "degraded", uptimePercent: 0, totalChecks: 1 },
  ]);
  await expect(authedCaller(other).uptimeMonitor.checkLog.daily({ uptimeMonitorId: monitor.uptimeMonitorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
});

describe("owner statistics", () => {
  it("keeps degraded and failed checks distinct and ignores future observations", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
    const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { uptimePercentage: 100 });
    await db.insert(uptimeCheckLog).values([
      { uptimeMonitorId: monitor.uptimeMonitorId, status: "up", responseTime: 50, createdAt: "2026-10-26T10:00:00.000Z" },
      { uptimeMonitorId: monitor.uptimeMonitorId, status: "degraded", responseTime: 300, createdAt: "2026-10-26T11:00:00.000Z" },
      { uptimeMonitorId: monitor.uptimeMonitorId, status: "down", responseTime: null, createdAt: "2026-10-26T13:00:00.000Z" },
    ]);
    expect(await authedCaller(owner).uptimeMonitor.checkLog.stats({ uptimeMonitorId: monitor.uptimeMonitorId })).toMatchObject({ totalChecks: 2, upChecks: 1, downChecks: 0, degradedChecks: 1, uptimePercentage: 50, availabilityPercentage: 100, slowPercentage: 50, avgResponseTime: 175 });
    const stale = await createTestMonitor(owner.id, { uptimePercentage: 100 });
    expect((await authedCaller(owner).uptimeMonitor.monitor.list()).find(row => row.uptimeMonitorId === stale.uptimeMonitorId)).toMatchObject({ uptimePercentage: null, uptimeChecks: 0 });
  });
});

it("persists degraded notification choices for monitor and account channels", async () => {
  const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id);
  const caller = authedCaller(owner);
  const config = { channelType: "webhook" as const, webhookUrl: "https://hooks.example.test/degraded", notifyOnDegraded: true };
  expect(await caller.uptimeMonitor.channel.create({ ...config, uptimeMonitorId: monitor.uptimeMonitorId })).toHaveProperty("notifyOnDegraded", true);
  expect(await caller.uptimeMonitor.channel.createDefault(config)).toHaveProperty("notifyOnDegraded", true);
});
