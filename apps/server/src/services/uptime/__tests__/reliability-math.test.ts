import { describe, expect, it } from "vitest";
import { measureReliabilityWindow, boundedObservation } from "../reliability-math";
const minute = 60000;
const sample = (from: number, to: number, status: "up" | "down" | "degraded" = "up") => ({ from, to, status, latencyMs: 100, latencyTargetMs: 100, policyId: "policy-one", excludeMaintenance: false, maintenance: [] });
describe("duration-weighted observed reliability", () => {
  it("allows exactly 2592 seconds in a fully observed 30-day window at 99.9 percent", () => {
    const to = 30 * 86400000;
    const result = measureReliabilityWindow({ from: 0, to, availabilityTargetBps: 9990 }, [sample(0, to)]);
    expect(result.raw.allowedDowntimeMs).toBe(2592000); expect(result.raw.remainingBudgetMs).toBe(2592000);
    expect(result.raw.availabilityPercent).toBe(100); expect(result.raw.unknownMs).toBe(0);
  });
  it("clips crossing-boundary states and weights elapsed time rather than the sample count", () => {
    const result = measureReliabilityWindow({ from: minute, to: 5 * minute, availabilityTargetBps: 9000 }, [sample(0, 2 * minute), sample(2 * minute, 6 * minute, "down")]);
    expect(result.raw.upMs).toBe(minute); expect(result.raw.downMs).toBe(3 * minute); expect(result.raw.availabilityPercent).toBe(25);
    expect(result.raw.allowedDowntimeMs).toBe(24000); expect(result.raw.remainingBudgetMs).toBe(0); expect(result.raw.overBudgetMs).toBe(156000);
  });
  it("keeps gaps unknown and applies a budget only to observed eligible time", () => {
    const result = measureReliabilityWindow({ from: 0, to: 10 * minute, availabilityTargetBps: 9900 }, [sample(minute, 3 * minute), sample(6 * minute, 8 * minute, "degraded")]);
    expect(result.raw.observedMs).toBe(4 * minute); expect(result.raw.unknownMs).toBe(6 * minute); expect(result.raw.coveragePercent).toBe(40);
    expect(result.raw.availabilityPercent).toBe(50); expect(result.raw.allowedDowntimeMs).toBe(2400);
  });
  it("represents no observations and zero eligible time without healthy defaults", () => {
    const empty = measureReliabilityWindow({ from: 0, to: minute, availabilityTargetBps: null }, []);
    expect(empty.raw.availabilityPercent).toBeNull(); expect(empty.raw.latencyPercent).toBeNull(); expect(empty.raw.allowedDowntimeMs).toBeNull();
    expect(empty.raw.unknownMs).toBe(minute); expect(empty.maintenanceAdjusted).toBeNull();
    const excluded = measureReliabilityWindow({ from: 0, to: minute, availabilityTargetBps: 9990 }, [{ ...sample(0, minute, "down"), excludeMaintenance: true, maintenance: [{ from: 0, to: minute }] }]);
    expect(excluded.raw.availabilityPercent).toBe(0); expect(excluded.maintenanceAdjusted?.availabilityPercent).toBeNull(); expect(excluded.maintenanceAdjusted?.allowedDowntimeMs).toBeNull();
  });
  it("unions overlapping maintenance and preserves raw health and versioned policy boundaries", () => {
    const result = measureReliabilityWindow({ from: 0, to: 4 * minute, availabilityTargetBps: 9900 }, [
      { ...sample(0, 2 * minute, "down"), excludeMaintenance: true, maintenance: [{ from: -minute, to: minute }, { from: minute / 2, to: 3 * minute / 2 }] },
      { ...sample(2 * minute, 4 * minute, "down"), policyId: "policy-two", maintenance: [{ from: 2 * minute, to: 4 * minute }] },
    ]);
    expect(result.raw.downMs).toBe(4 * minute); expect(result.maintenanceAdjusted?.excludedMs).toBe(1.5 * minute);
    expect(result.maintenanceAdjusted?.downMs).toBe(2.5 * minute); expect(result.policyIds).toEqual(["policy-one", "policy-two"]);
  });
  it("counts latency equality as passing while missing timing, failed probes and absent targets stay ineligible", () => {
    const result = measureReliabilityWindow({ from: 0, to: 5 * minute, availabilityTargetBps: 9990 }, [
      sample(0, minute), { ...sample(minute, 2 * minute, "degraded"), latencyMs: 101 },
      { ...sample(2 * minute, 3 * minute), latencyMs: null }, sample(3 * minute, 4 * minute, "down"),
      { ...sample(4 * minute, 5 * minute), latencyTargetMs: null },
    ]);
    expect(result.raw.latencyEligibleMs).toBe(2 * minute); expect(result.raw.latencyMetMs).toBe(minute); expect(result.raw.latencyPercent).toBe(50);
  });
  it("bounds a held observation at the next sample or its stored deadline without extending stale health", () => {
    const observation = { ...sample(0, minute), at: 0, expiresAt: minute };
    expect(boundedObservation(observation, 10 * minute)?.to).toBe(minute);
    expect(boundedObservation(observation, minute / 2)?.to).toBe(minute / 2);
    expect(boundedObservation(observation, 0)).toBeNull();
  });
  it("rejects overlapping facts and invalid windows instead of double-counting or making coverage exceed100", () => {
    expect(() => measureReliabilityWindow({ from: 0, to: minute, availabilityTargetBps: 9990 }, [sample(0, minute), sample(0, minute)])).toThrow();
    expect(() => measureReliabilityWindow({ from: minute, to: 0, availabilityTargetBps: 9990 }, [])).toThrow();
  });
});
