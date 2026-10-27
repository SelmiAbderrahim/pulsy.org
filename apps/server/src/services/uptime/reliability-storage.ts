import { db, uptimeMonitor, uptimeCheckLog, uptimeMaintenance, uptimeReliabilityCursor, uptimeReliabilityDay, uptimeReliabilityPolicy, type DbTransaction, type DbExecutor, type CapturedReliabilityObservation, type ReliabilityBucket } from "@pulsy/db";
import { and, arrayContains, desc, eq } from "drizzle-orm";
import { boundedObservation, measureReliabilityWindow, type ReliabilitySegment } from "./reliability-math";
import { previewMaintenance } from "./maintenance-service";
export const DAY_MS = 86400000;
export const dayStart = (at: number) => Math.floor(at / DAY_MS) * DAY_MS;
export const dayKey = (at: number) => new Date(at).toISOString().slice(0, 10);
export function emptyReliabilityBucket(): ReliabilityBucket {
  const empty = () => ({ observedMs: 0, upMs: 0, downMs: 0, degradedMs: 0, latencyEligibleMs: 0, latencyMetMs: 0 });
  return { raw: empty(), adjusted: empty(), excludedMs: 0, adjustmentEnabled: false, policyIds: [], checks: 0, upChecks: 0, timingSumMs: 0, timingCount: 0, minTimingMs: null, maxTimingMs: null };
}
export async function currentReliabilityPolicy(userId: string, monitorId: string, executor: DbExecutor = db) {
  const [policy] = await executor.select().from(uptimeReliabilityPolicy).where(and(eq(uptimeReliabilityPolicy.userId, userId), eq(uptimeReliabilityPolicy.monitorId, monitorId))).orderBy(desc(uptimeReliabilityPolicy.version)).limit(1);
  return policy ?? null;
}
async function capturedMaintenance(tx: DbTransaction, userId: string, monitorId: string, from: number, to: number) {
  const windows = await tx.select().from(uptimeMaintenance).where(and(eq(uptimeMaintenance.userId, userId), eq(uptimeMaintenance.enabled, true), eq(uptimeMaintenance.kind, "maintenance"), arrayContains(uptimeMaintenance.monitorIds, [monitorId])));
  const ranges = new Map<string, { from: number; to: number }>();
  for (const window of windows) {
    let cursor = from;
    // A captured horizon is at most7days; library previews cover at most8 daily
    // occurrences (including a crossing occurrence), without parsing cron/DST.
    for (let batch = 0; batch < 3; batch++) {
      const occurrences = window.recurrence === "once" ? [{ startsAt: window.startsAt, endsAt: window.endsAt }] : previewMaintenance(window, new Date(cursor));
      for (const occurrence of occurrences) {
        const range = { from: Math.max(from, Date.parse(occurrence.startsAt)), to: Math.min(to, Date.parse(occurrence.endsAt)) };
        if (range.to > range.from) ranges.set(`${range.from}:${range.to}`, range);
      }
      const last = occurrences.at(-1);
      if (!last || window.recurrence === "once" || Date.parse(last.startsAt) >= to || Date.parse(last.endsAt) <= cursor) break;
      cursor = Date.parse(last.endsAt);
    }
  }
  return [...ranges.values()];
}
async function changeDay(tx: DbTransaction, userId: string, monitorId: string, day: string, updatedAt: string, change: (bucket: ReliabilityBucket) => void) {
  const scope = and(eq(uptimeReliabilityDay.userId, userId), eq(uptimeReliabilityDay.monitorId, monitorId), eq(uptimeReliabilityDay.day, day));
  // The caller holds the owning monitor row lock: every writer has the same order.
  const [current] = await tx.select().from(uptimeReliabilityDay).where(scope);
  const bucket = current?.bucket ?? emptyReliabilityBucket(); change(bucket);
  if (bucket.raw.observedMs > DAY_MS || bucket.adjusted.observedMs + bucket.excludedMs > DAY_MS) throw new Error("Overlapping reliability contributions");
  if (current) await tx.update(uptimeReliabilityDay).set({ bucket, updatedAt }).where(scope);
  else await tx.insert(uptimeReliabilityDay).values({ userId, monitorId, day, bucket, updatedAt });
}
export async function appendReliabilitySegment(tx: DbTransaction, userId: string, monitorId: string, segment: ReliabilitySegment, updatedAt: string) {
  for (let start = dayStart(segment.from); start < segment.to; start += DAY_MS) {
    const measured = measureReliabilityWindow({ from: start, to: start + DAY_MS, availabilityTargetBps: null }, [segment]);
    await changeDay(tx, userId, monitorId, dayKey(start), updatedAt, bucket => {
      for (const key of Object.keys(bucket.raw) as Array<keyof ReliabilityBucket["raw"]>) { bucket.raw[key] += measured.raw[key]; bucket.adjusted[key] += (measured.maintenanceAdjusted ?? measured.raw)[key]; }
      bucket.excludedMs += measured.maintenanceAdjusted?.excludedMs ?? 0;
      bucket.adjustmentEnabled ||= Boolean(measured.maintenanceAdjusted);
      bucket.policyIds = [...new Set([...bucket.policyIds, ...measured.policyIds])].sort();
    });
  }
}
type Monitor = typeof uptimeMonitor.$inferSelect;
type CheckInput = Pick<typeof uptimeCheckLog.$inferInsert, "status" | "createdAt" | "httpStatus" | "responseTime" | "errorMessage" | "assertionOutcomes">;
/** Called inside the existing health transaction, after its owned monitor lock.
 * Facts, cursor and compact durations either commit together or all roll back.
 */
export async function insertObservedCheck(tx: DbTransaction, monitor: Monitor, values: CheckInput) {
  const stamp = values.createdAt ?? new Date().toISOString(), at = Date.parse(stamp);
  const policy = await currentReliabilityPolicy(monitor.userId, monitor.uptimeMonitorId, tx);
  const observation: CapturedReliabilityObservation = { at, expiresAt: at + Math.max(0, Math.min(604800, monitor.interval)) * 1000,
    status: values.status, latencyMs: (monitor.monitorType === "heartbeat" || monitor.monitorType === "server") ? null : values.responseTime ?? null,
    latencyTargetMs: (monitor.monitorType === "heartbeat" || monitor.monitorType === "server") ? null : policy?.latencyTargetMs ?? null, policyId: policy?.id ?? null,
    excludeMaintenance: policy?.excludeMaintenance ?? false, maintenance: [] };
  if (observation.excludeMaintenance) observation.maintenance = await capturedMaintenance(tx, monitor.userId, monitor.uptimeMonitorId, at, observation.expiresAt);
  const scope = and(eq(uptimeReliabilityCursor.userId, monitor.userId), eq(uptimeReliabilityCursor.monitorId, monitor.uptimeMonitorId));
  const [previous] = await tx.select().from(uptimeReliabilityCursor).where(scope);
  const obsolete = previous && at < previous.observation.at;
  const [created] = await tx.insert(uptimeCheckLog).values({ ...values, createdAt: stamp, uptimeMonitorId: monitor.uptimeMonitorId, observation, observationEndedAt: obsolete ? stamp : null }).returning();
  if (!created) throw new Error("Reliability observation was not recorded");
  await changeDay(tx, monitor.userId, monitor.uptimeMonitorId, dayKey(at), stamp, bucket => {
    bucket.checks++; if (values.status === "up") bucket.upChecks++;
    if (observation.latencyMs !== null && Number.isFinite(observation.latencyMs) && observation.latencyMs >= 0) { bucket.timingCount++; bucket.timingSumMs += observation.latencyMs; bucket.minTimingMs = Math.min(bucket.minTimingMs ?? observation.latencyMs, observation.latencyMs); bucket.maxTimingMs = Math.max(bucket.maxTimingMs ?? observation.latencyMs, observation.latencyMs); }
  });
  if (obsolete) return created;
  if (previous) {
    const segment = boundedObservation(previous.observation, at);
    if (segment) await appendReliabilitySegment(tx, monitor.userId, monitor.uptimeMonitorId, segment, stamp);
    await tx.update(uptimeCheckLog).set({ observationEndedAt: new Date(Math.min(at, previous.observation.expiresAt)).toISOString() }).where(and(eq(uptimeCheckLog.checkLogId, previous.checkId), eq(uptimeCheckLog.uptimeMonitorId, monitor.uptimeMonitorId)));
  }
  await tx.insert(uptimeReliabilityCursor).values({ userId: monitor.userId, monitorId: monitor.uptimeMonitorId, checkId: created.checkLogId, observation }).onConflictDoUpdate({ target: uptimeReliabilityCursor.monitorId, set: { checkId: created.checkLogId, observation } });
  if (policy && !policy.firstObservedAt) await tx.update(uptimeReliabilityPolicy).set({ firstObservedAt: stamp }).where(and(eq(uptimeReliabilityPolicy.userId, monitor.userId), eq(uptimeReliabilityPolicy.monitorId, monitor.uptimeMonitorId), eq(uptimeReliabilityPolicy.id, policy.id)));
  return created;
}
