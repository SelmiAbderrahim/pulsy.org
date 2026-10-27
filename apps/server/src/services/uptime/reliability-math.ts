export interface TimeRange { from: number; to: number }
export interface ReliabilitySegment extends TimeRange {
  status: "up" | "down" | "degraded";
  latencyMs: number | null;
  latencyTargetMs: number | null;
  policyId: string | null;
  excludeMaintenance: boolean;
  maintenance: TimeRange[];
}
export interface ReliabilityObservation extends Omit<ReliabilitySegment, "from" | "to"> { at: number; expiresAt: number }
export interface ReliabilityTotals {
  windowMs: number; observedMs: number; unknownMs: number; excludedMs: number;
  upMs: number; downMs: number; degradedMs: number;
  latencyEligibleMs: number; latencyMetMs: number;
  availabilityPercent: number | null; coveragePercent: number | null; latencyPercent: number | null;
  allowedDowntimeMs: number | null; consumedDowntimeMs: number; remainingBudgetMs: number | null; overBudgetMs: number | null;
}
const validTime = (value: number) => Number.isSafeInteger(value);
function checkRange(range: TimeRange) {
  if (!validTime(range.from) || !validTime(range.to) || range.to <= range.from) throw new RangeError("Invalid reliability time range");
}
/** One captured observation never proves health beyond its recorded horizon. */
export function boundedObservation(observation: ReliabilityObservation, until: number): ReliabilitySegment | null {
  const to = Math.min(until, observation.expiresAt);
  if (to <= observation.at) return null;
  const { at, expiresAt: _expires, ...facts } = observation;
  return { ...facts, from: at, to };
}
/** Union maintenance before subtraction, including adjacent/overlapping windows. */
export function excludedDuration(ranges: TimeRange[], from: number, to: number): number {
  const clipped = ranges.map(range => ({ from: Math.max(from, range.from), to: Math.min(to, range.to) })).filter(range => range.to > range.from).sort((a, b) => a.from - b.from);
  let end = from, duration = 0;
  for (const range of clipped) { duration += Math.max(0, range.to - Math.max(end, range.from)); end = Math.max(end, range.to); }
  return duration;
}
const ratio = (numerator: number, denominator: number) => denominator > 0 ? Number((numerator / denominator * 100).toFixed(6)) : null;
export function finalizeReliabilityTotals(input: Pick<ReliabilityTotals, "windowMs" | "observedMs" | "unknownMs" | "excludedMs" | "upMs" | "downMs" | "degradedMs" | "latencyEligibleMs" | "latencyMetMs">, targetBps: number | null): ReliabilityTotals {
  const consumedDowntimeMs = input.downMs + input.degradedMs;
  const allowedDowntimeMs = targetBps !== null && input.observedMs > 0 ? input.observedMs * (10000 - targetBps) / 10000 : null;
  return { ...input, availabilityPercent: ratio(input.upMs, input.observedMs), coveragePercent: ratio(input.observedMs, input.windowMs - input.excludedMs), latencyPercent: ratio(input.latencyMetMs, input.latencyEligibleMs),
    allowedDowntimeMs, consumedDowntimeMs, remainingBudgetMs: allowedDowntimeMs === null ? null : Math.max(0, allowedDowntimeMs - consumedDowntimeMs), overBudgetMs: allowedDowntimeMs === null ? null : Math.max(0, consumedDowntimeMs - allowedDowntimeMs) };
}
/** Duration weighting, separate from the existing successful-check/sample ratio.
 * Intervals are half-open; gaps remain unknown and policy never changes raw facts.
 */
export function measureReliabilityWindow(window: TimeRange & { availabilityTargetBps: number | null }, segments: ReliabilitySegment[]) {
  checkRange(window);
  if (window.availabilityTargetBps !== null && (!Number.isInteger(window.availabilityTargetBps) || window.availabilityTargetBps < 0 || window.availabilityTargetBps > 10000)) throw new RangeError("Invalid availability target");
  const empty = () => ({ windowMs: window.to - window.from, observedMs: 0, unknownMs: 0, excludedMs: 0, upMs: 0, downMs: 0, degradedMs: 0, latencyEligibleMs: 0, latencyMetMs: 0 });
  const raw = empty(), adjusted = empty(), policyIds = new Set<string>();
  let previousEnd = -Infinity, adjustmentEnabled = false;
  for (const segment of [...segments].sort((a, b) => a.from - b.from)) {
    checkRange(segment);
    if (segment.from < previousEnd) throw new RangeError("Overlapping reliability observations");
    previousEnd = segment.to;
    const from = Math.max(window.from, segment.from), to = Math.min(window.to, segment.to);
    if (to <= from) continue;
    if (segment.policyId) policyIds.add(segment.policyId);
    const duration = to - from;
    const excluded = segment.excludeMaintenance ? excludedDuration(segment.maintenance, from, to) : 0;
    adjustmentEnabled ||= segment.excludeMaintenance;
    adjusted.excludedMs += excluded;
    const latencyEligible = segment.status !== "down" && segment.latencyMs !== null && Number.isFinite(segment.latencyMs) && segment.latencyMs >= 0 && segment.latencyTargetMs !== null;
    for (const [totals, eligible] of [[raw, duration], [adjusted, duration - excluded]] as const) {
      totals.observedMs += eligible;
      if (segment.status === "up") totals.upMs += eligible;
      else if (segment.status === "down") totals.downMs += eligible;
      else totals.degradedMs += eligible;
      if (latencyEligible) { totals.latencyEligibleMs += eligible; if (segment.latencyMs! <= segment.latencyTargetMs!) totals.latencyMetMs += eligible; }
    }
  }
  raw.unknownMs = Math.max(0, raw.windowMs - raw.observedMs); adjusted.unknownMs = raw.unknownMs;
  return { raw: finalizeReliabilityTotals(raw, window.availabilityTargetBps), maintenanceAdjusted: adjustmentEnabled ? finalizeReliabilityTotals(adjusted, window.availabilityTargetBps) : null, policyIds: [...policyIds].sort() };
}
