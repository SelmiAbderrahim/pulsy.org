import { z } from "zod";
export const apiReliabilityConfiguration = z.object({
  availabilityTargetBps: z.number().int().min(0).max(10000).nullable(),
  latencyTargetMs: z.number().int().min(0).max(60000).nullable(),
  excludeMaintenance: z.boolean().default(false),
}).strict();
export type ReliabilityConfiguration = z.infer<typeof apiReliabilityConfiguration>;
const instant = z.string().max(40).datetime({ offset: true }).transform(value => new Date(value).toISOString());
export const apiReliabilityWindow = z.object({ from: instant, to: instant }).strict().refine(value => Date.parse(value.to) > Date.parse(value.from) && Date.parse(value.to) - Date.parse(value.from) <= 730 * 86400000);
export const apiReliabilityAnnotation = z.object({ at: instant, environment: z.string().trim().max(100).default(""), version: z.string().trim().max(100).default(""), text: z.string().trim().min(1).max(1000), link: z.string().max(2048).nullable().default(null) }).strict();
export type ReliabilityAnnotationInput = z.infer<typeof apiReliabilityAnnotation>;
export interface ReliabilityRange { from: number; to: number }
export interface CapturedReliabilityObservation {
  at: number; expiresAt: number; status: "up" | "down" | "degraded";
  latencyMs: number | null; latencyTargetMs: number | null;
  policyId: string | null; excludeMaintenance: boolean; maintenance: ReliabilityRange[];
}
export interface ReliabilityCounters { observedMs: number; upMs: number; downMs: number; degradedMs: number; latencyEligibleMs: number; latencyMetMs: number }
export interface ReliabilityBucket {
  raw: ReliabilityCounters; adjusted: ReliabilityCounters; excludedMs: number; adjustmentEnabled: boolean; policyIds: string[];
  checks: number; upChecks: number; timingSumMs: number; timingCount: number; minTimingMs: number | null; maxTimingMs: number | null;
}
