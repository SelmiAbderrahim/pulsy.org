import { z } from "zod";

/** Optional operating policy; an absent policy preserves the legacy checker. */
export const apiLatencyPolicy = z.object({
  thresholdMs: z.number().int().min(1).max(60000).nullable(),
  slowCount: z.number().int().min(1).max(10),
  recoveryThresholdMs: z.number().int().min(0).max(60000).nullable(),
  recoveryCount: z.number().int().min(1).max(10),
  importance: z.enum(["critical", "warning", "informational"]).default("critical"),
  cooldownSeconds: z.number().int().min(0).max(3600).default(0),
}).strict().refine(policy => policy.thresholdMs === null ? policy.recoveryThresholdMs === null : policy.recoveryThresholdMs !== null && policy.recoveryThresholdMs <= policy.thresholdMs, {
  message: "errors.latencyRecoveryThreshold", path: ["recoveryThresholdMs"],
});
export type LatencyPolicy = z.infer<typeof apiLatencyPolicy>;
