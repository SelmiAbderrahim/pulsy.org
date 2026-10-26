import { describe, expect, it } from "vitest";
import { apiLatencyPolicy } from "@pulsy/db";
import { evaluateLatencyTransition } from "../latency-policy";

const policy = { thresholdMs: 200, slowCount: 2, recoveryThresholdMs: 150, recoveryCount: 2, importance: "critical" as const, cooldownSeconds: 60 };
const initial = { previousStatus: "up" as const, consecutiveFailures: 0, failureThreshold: 1, consecutiveSlow: 0, consecutiveHealthy: 0 };
function sample(overrides: Partial<Parameters<typeof evaluateLatencyTransition>[0]> = {}) {
  return evaluateLatencyTransition({ ...initial, policy, checkStatus: "up", responseTime: 201, ...overrides });
}
describe("latency transition boundaries", () => {
  it("keeps an isolated slow sample visible without opening a degraded incident", () => {
    expect(sample()).toMatchObject({ monitorStatus: "up", sampleStatus: "degraded", consecutiveSlow: 1, shouldCreateIncident: false });
    expect(sample({ responseTime: 200, consecutiveSlow: 1 })).toMatchObject({ monitorStatus: "up", sampleStatus: "up", consecutiveSlow: 0 });
  });
  it("opens one incident when consecutive slow samples reach the threshold", () => {
    expect(sample({ consecutiveSlow: 1 })).toMatchObject({ monitorStatus: "degraded", shouldCreateIncident: true, shouldRecordStatusChange: true });
    expect(sample({ previousStatus: "degraded", consecutiveSlow: 2 })).toMatchObject({ monitorStatus: "degraded", shouldCreateIncident: false, shouldRecordStatusChange: false });
  });
  it("holds degraded in the recovery band and requires consecutive passing recovery samples", () => {
    expect(sample({ previousStatus: "degraded", responseTime: 175 })).toMatchObject({ monitorStatus: "degraded", consecutiveHealthy: 0, shouldResolveIncident: false });
    expect(sample({ previousStatus: "degraded", responseTime: 150 })).toMatchObject({ monitorStatus: "degraded", consecutiveHealthy: 1, shouldResolveIncident: false });
    expect(sample({ previousStatus: "degraded", responseTime: 150, consecutiveHealthy: 1 })).toMatchObject({ monitorStatus: "up", shouldResolveIncident: true });
  });
  it("gives unacceptable responses precedence and prevents slow success from falsely recovering Down", () => {
    expect(sample({ previousStatus: "degraded", checkStatus: "down", responseTime: 10 })).toMatchObject({ monitorStatus: "down", sampleStatus: "down", consecutiveHealthy: 0 });
    expect(sample({ previousStatus: "up", checkStatus: "degraded", responseTime: 10 })).toMatchObject({ monitorStatus: "down", sampleStatus: "down" });
    expect(sample({ previousStatus: "down", responseTime: 201 })).toMatchObject({ monitorStatus: "down", shouldResolveIncident: false });
    expect(sample({ previousStatus: "down", responseTime: 150, consecutiveHealthy: 1 })).toMatchObject({ monitorStatus: "up", shouldResolveIncident: true });
  });
  it("resets streaks at interruptions and applies the existing outage threshold", () => {
    expect(sample({ previousStatus: "degraded", responseTime: 175, consecutiveHealthy: 1 })).toMatchObject({ consecutiveHealthy: 0 });
    expect(sample({ checkStatus: "down", consecutiveSlow: 1, failureThreshold: 3 })).toMatchObject({ monitorStatus: "up", consecutiveSlow: 0, consecutiveFailures: 1 });
    expect(sample({ checkStatus: "down", consecutiveFailures: 2, failureThreshold: 3 })).toMatchObject({ monitorStatus: "down", consecutiveFailures: 3 });
  });
  it("preserves legacy defaults and never treats a pending row as a recovered incident", () => {
    expect(sample({ policy: null, responseTime: 9999 })).toMatchObject({ monitorStatus: "up", sampleStatus: "up", shouldRecordStatusChange: false });
    expect(sample({ policy: null, checkStatus: "degraded" })).toMatchObject({ monitorStatus: "degraded", shouldCreateIncident: false });
    expect(sample({ previousStatus: "pending", responseTime: 0 })).toMatchObject({ monitorStatus: "up", shouldResolveIncident: false });
    expect(sample({ previousStatus: "pending", consecutiveSlow: 1 })).toMatchObject({ monitorStatus: "degraded", shouldCreateIncident: true });
  });
  it("allows importance and quiet recovery without enabling latency degradation", () => {
    const quiet = apiLatencyPolicy.parse({ ...policy, thresholdMs: null, recoveryThresholdMs: null, importance: "informational" });
    expect(sample({ policy: quiet, responseTime: 9999 })).toMatchObject({ sampleStatus: "up", monitorStatus: "up" });
    expect(sample({ policy: quiet, previousStatus: "down", responseTime: 9999 })).toMatchObject({ monitorStatus: "down", consecutiveHealthy: 1 });
    expect(sample({ policy: quiet, previousStatus: "down", responseTime: 9999, consecutiveHealthy: 1 })).toMatchObject({ monitorStatus: "up", shouldResolveIncident: true });
  });
  it("rejects reversed, incomplete, non-finite and out-of-bounds policy values", () => {
    for (const patch of [{ recoveryThresholdMs: 201 }, { thresholdMs: null }, { recoveryThresholdMs: null }, { thresholdMs: Infinity }, { slowCount: 0 }, { recoveryCount: 11 }, { cooldownSeconds: 3601 }, { importance: "urgent" }, { unexpected: "ignored" }]) {
      expect(apiLatencyPolicy.safeParse({ ...policy, ...patch }).success).toBe(false);
    }
  });
  it("does not let alternating threshold samples accumulate or unbounded streaks grow", () => {
    let state: Partial<Parameters<typeof evaluateLatencyTransition>[0]> = {};
    for (const responseTime of [201, 200, 201, 200, 201, 200]) {
      const result = sample({ ...state, responseTime });
      expect(result.monitorStatus).toBe("up");
      state = { previousStatus: result.monitorStatus, consecutiveSlow: result.consecutiveSlow, consecutiveHealthy: result.consecutiveHealthy };
    }
    expect(sample({ previousStatus: "degraded", consecutiveSlow: 999 })).toHaveProperty("consecutiveSlow", 2);
  });
});
