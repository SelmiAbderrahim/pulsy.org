import { describe, expect, it } from "vitest";
import { db, uptimeCheckLog } from "@pulsy/db";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
useCleanDatabase();
describe("recorded monitor statistics", () => {
  it("keeps no recorded checks and timings unknown", async () => {
    const owner = await createTestUser(), monitor = await createTestMonitor(owner.id);
    expect(await authedCaller(owner).uptimeMonitor.checkLog.stats({ uptimeMonitorId: monitor.uptimeMonitorId })).toMatchObject({ totalChecks: 0, uptimePercentage: null, avgResponseTime: null, minResponseTime: null, maxResponseTime: null });
  });
  it("distinguishes measured zero latency and measured zero success from missing observations", async () => {
    const owner = await createTestUser(), zeroLatency = await createTestMonitor(owner.id), zeroSuccess = await createTestMonitor(owner.id);
    await db.insert(uptimeCheckLog).values([{ uptimeMonitorId: zeroLatency.uptimeMonitorId, status: "up", responseTime: 0, httpStatus: 200 }, { uptimeMonitorId: zeroSuccess.uptimeMonitorId, status: "down", responseTime: null, httpStatus: null }]);
    const caller = authedCaller(owner).uptimeMonitor.checkLog;
    expect(await caller.stats({ uptimeMonitorId: zeroLatency.uptimeMonitorId })).toMatchObject({ totalChecks: 1, uptimePercentage: 100, avgResponseTime: 0 });
    expect(await caller.stats({ uptimeMonitorId: zeroSuccess.uptimeMonitorId })).toMatchObject({ totalChecks: 1, uptimePercentage: 0, avgResponseTime: null });
  });
});
