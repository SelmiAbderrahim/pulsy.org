import { apiLatencyPolicy, type LatencyPolicy } from "@pulsy/db/validation-latency";
import { computeStatusTransition } from "./status-transition";

type Status = "pending" | "up" | "down" | "degraded";
type SampleStatus = Exclude<Status, "pending">;
interface LatencyInput {
  previousStatus: Status; checkStatus: SampleStatus; responseTime: number | null;
  consecutiveFailures: number; failureThreshold: number;
  consecutiveSlow: number; consecutiveHealthy: number; policy: LatencyPolicy | null;
}
type Decision = ReturnType<typeof computeStatusTransition> & {
  sampleStatus: SampleStatus; consecutiveSlow: number; consecutiveHealthy: number; latencyReason?: string;
};

/** Pure bounded hysteresis; callers persist counters in the same transaction as health. */
export function evaluateLatencyTransition(input: LatencyInput): Decision {
  const { policy, previousStatus, checkStatus } = input;
  // Successful probes always carry a measured response time; failures may not.
  const responseTime = input.responseTime ?? 0;
  if (!policy) return { ...computeStatusTransition(input), sampleStatus: checkStatus, consecutiveSlow: 0, consecutiveHealthy: 0 };
  if (checkStatus !== "up") {
    return { ...computeStatusTransition({ ...input, checkStatus: "down" }), sampleStatus: "down", consecutiveSlow: 0, consecutiveHealthy: 0 };
  }
  const unhealthy = previousStatus === "down" || previousStatus === "degraded";
  const slow = policy.thresholdMs !== null && responseTime > policy.thresholdMs;
  const consecutiveSlow = slow ? Math.min(policy.slowCount, input.consecutiveSlow + 1) : 0;
  const consecutiveHealthy = policy.recoveryThresholdMs === null || responseTime <= policy.recoveryThresholdMs ? Math.min(policy.recoveryCount, input.consecutiveHealthy + 1) : 0;
  const latencyReason = slow ? `Response time ${responseTime} ms exceeds ${policy.thresholdMs} ms` : undefined;
  const monitorStatus: Status = unhealthy
    ? consecutiveHealthy >= policy.recoveryCount ? "up" : previousStatus
    : consecutiveSlow >= policy.slowCount ? "degraded" : "up";
  const changed = monitorStatus !== previousStatus;
  return {
    consecutiveFailures: 0, monitorStatus, consecutiveSlow, consecutiveHealthy,
    sampleStatus: slow ? "degraded" : "up", latencyReason,
    // Pending → Up is the first observation, never a recovery announcement.
    shouldRecordStatusChange: changed && !(previousStatus === "pending" && monitorStatus === "up"),
    statusAfter: monitorStatus,
    shouldCreateIncident: changed && monitorStatus === "degraded",
    shouldResolveIncident: changed && monitorStatus === "up" && unhealthy,
  };
}

/** Policy changes begin a new streak, while identical sync/edit operations retain it. */
export function countersForPolicyChange(previous: LatencyPolicy | null, next: LatencyPolicy | null | undefined) {
  if (next === undefined) return {};
  const parsed = apiLatencyPolicy.safeParse(previous);
  const canonicalPrevious = previous === null ? null : parsed.success ? parsed.data : undefined;
  const canonicalNext = next === null ? null : apiLatencyPolicy.parse(next);
  return JSON.stringify(canonicalPrevious) === JSON.stringify(canonicalNext) ? {} : { consecutiveSlow: 0, consecutiveHealthy: 0 };
}
