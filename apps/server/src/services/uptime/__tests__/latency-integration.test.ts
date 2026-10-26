import { describe, expect, it, vi, afterEach } from "vitest";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { storedMonitorSnapshot } from "../../../../test/monitor-snapshot";
import { performHttpCheck } from "../checker-service";
import { executeCheck } from "../scheduler-service";
vi.mock("../checker-service", async importActual => ({ ...await importActual<typeof import("../checker-service")>(), performHttpCheck: vi.fn() }));
vi.mock("../scheduler-service", async importActual => ({ ...await importActual<typeof import("../scheduler-service")>(), scheduleMonitorCheck: vi.fn(), rescheduleMonitorCheck: vi.fn(), cancelMonitorCheck: vi.fn() }));
useCleanDatabase();
afterEach(() => vi.clearAllMocks());
const policy = { thresholdMs: 200, slowCount: 2, recoveryThresholdMs: 150, recoveryCount: 2, importance: "critical" as const, cooldownSeconds: 60 };
const config = { name: "Latency fixture", url: "http://fixture.invalid/health", failureThreshold: 1, latencyPolicy: policy };
function response(status: "up" | "down" | "degraded", responseTime: number) {
  vi.mocked(performHttpCheck).mockResolvedValue({ status, responseTime, httpStatus: status === "down" ? 503 : 200 });
}
describe("persisted latency and quiet recovery", () => {
  it("tests one latency sample without advancing persisted counters, retaining the saved policy by omission", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const created = await caller.uptimeMonitor.monitor.create(config);
    response("up", 201);
    const result = await caller.uptimeMonitor.monitor.testConfiguration({ uptimeMonitorId: created.uptimeMonitorId, configuration: { name: config.name, url: config.url } });
    expect(result).toMatchObject({ status: "degraded", responseTime: 201 });
    const detail = await storedMonitorSnapshot(created.uptimeMonitorId, owner.id);
    expect(detail).toMatchObject({ status: "pending", consecutiveSlow: 0, incidents: [] });
    expect((await caller.uptimeMonitor.checkLog.list({ uptimeMonitorId: created.uptimeMonitorId })).data).toHaveLength(0);
    const legacy = await caller.uptimeMonitor.monitor.testConfiguration({ uptimeMonitorId: created.uptimeMonitorId, configuration: { name: config.name, url: config.url, latencyPolicy: null } });
    expect(legacy.status).toBe("up");
    response("degraded", 20);
    expect((await caller.uptimeMonitor.monitor.testConfiguration({ configuration: config })).status).toBe("down");
  });
  it("persists the policy, retains omission, validates replacements and isolates owners", async () => {
    const owner = await createTestUser(); const other = await createTestUser(); const caller = authedCaller(owner);
    const created = await caller.uptimeMonitor.monitor.create(config);
    expect(created).toMatchObject({ latencyPolicy: policy });
    expect(await storedMonitorSnapshot(created.uptimeMonitorId, owner.id)).toMatchObject({ consecutiveSlow: 0, consecutiveHealthy: 0 });
    const retained = await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: created.uptimeMonitorId, name: "Renamed" });
    expect(retained).toMatchObject({ latencyPolicy: policy });
    const invalid = { uptimeMonitorId: created.uptimeMonitorId, latencyPolicy: { ...policy, recoveryThresholdMs: 201 } };
    await expect(caller.uptimeMonitor.monitor.update(invalid)).rejects.toThrow();
    await expect(authedCaller(other).uptimeMonitor.monitor.update({ uptimeMonitorId: created.uptimeMonitorId, name: "Foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("shares durable streaks between manual and scheduled checks and opens one sustained incident", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner); const created = await caller.uptimeMonitor.monitor.create(config);
    response("up", 201); await caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: created.uptimeMonitorId });
    expect(await storedMonitorSnapshot(created.uptimeMonitorId, owner.id)).toMatchObject({ status: "up", consecutiveSlow: 1, incidents: [] });
    await executeCheck(created.uptimeMonitorId);
    let detail = await storedMonitorSnapshot(created.uptimeMonitorId, owner.id);
    expect(detail.status).toBe("degraded"); expect(detail.incidents).toHaveLength(1);
    expect(detail.incidents[0]?.cause).toContain("201 ms"); expect(detail.incidents[0]?.cause).toContain("200 ms");
    await executeCheck(created.uptimeMonitorId);
    detail = await storedMonitorSnapshot(created.uptimeMonitorId, owner.id);
    expect(detail.incidents).toHaveLength(1);
    response("down", 20); await executeCheck(created.uptimeMonitorId);
    detail = await storedMonitorSnapshot(created.uptimeMonitorId, owner.id);
    expect(detail.status).toBe("down"); expect(detail.incidents).toHaveLength(1);
    response("up", 150); await caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: created.uptimeMonitorId });
    expect(await storedMonitorSnapshot(created.uptimeMonitorId, owner.id)).toMatchObject({ status: "down", consecutiveHealthy: 1 });
    await executeCheck(created.uptimeMonitorId);
    detail = await storedMonitorSnapshot(created.uptimeMonitorId, owner.id);
    expect(detail.status).toBe("up"); expect(detail.incidents[0]?.status).toBe("resolved");
  });
  it("preserves counters on unrelated or identical edits, resets changed bulk policy, and retains raw history", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner); const created = await caller.uptimeMonitor.monitor.create(config);
    response("up", 201); await caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: created.uptimeMonitorId });
    await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: created.uptimeMonitorId, name: "Same policy", latencyPolicy: { ...policy } });
    expect(await storedMonitorSnapshot(created.uptimeMonitorId, owner.id)).toHaveProperty("consecutiveSlow", 1);
    await caller.uptimeMonitor.monitor.updateBulk({ monitorIds: [created.uptimeMonitorId], patch: { latencyPolicy: { ...policy, thresholdMs: 250 } } });
    expect(await storedMonitorSnapshot(created.uptimeMonitorId, owner.id)).toMatchObject({ consecutiveSlow: 0, consecutiveHealthy: 0 });
    expect((await caller.uptimeMonitor.checkLog.list({ uptimeMonitorId: created.uptimeMonitorId })).data).toHaveLength(1);
  });
  it("serializes two concurrent configured samples without losing a streak or duplicating incidents", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner); const created = await caller.uptimeMonitor.monitor.create(config);
    response("up", 201);
    await Promise.all([caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: created.uptimeMonitorId }), caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: created.uptimeMonitorId })]);
    const detail = await storedMonitorSnapshot(created.uptimeMonitorId, owner.id);
    expect(detail.status).toBe("degraded"); expect(detail.consecutiveSlow).toBe(2); expect(detail.incidents).toHaveLength(1);
  });

});
