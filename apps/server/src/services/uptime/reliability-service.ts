import { db, uptimeMonitor, uptimeCheckLog, uptimeReliabilityPolicy, uptimeReliabilityCursor, uptimeReliabilityDay, uptimeReliabilityAnnotation, apiReliabilityAnnotation, apiReliabilityConfiguration, apiReliabilityWindow, type ReliabilityConfiguration, type ReliabilityBucket, type ReliabilityAnnotationInput, type DbExecutor } from "@pulsy/db";
import { and, asc, count, desc, eq, gte, lt, or, gt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { reliabilityRetentionDays } from "./reliability-retention";
import type { Translator } from "../../lib/i18n";
import { boundedObservation, finalizeReliabilityTotals, measureReliabilityWindow, type ReliabilitySegment } from "./reliability-math";
import { currentReliabilityPolicy, DAY_MS, dayStart, dayKey, emptyReliabilityBucket } from "./reliability-storage";
import { redactIncidentText } from "./incident-text";
const missing = (t: Translator) => new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });
async function ownedMonitor(userId: string, monitorId: string, t: Translator, executor: DbExecutor = db) {
  const [monitor] = await executor.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, userId), eq(uptimeMonitor.uptimeMonitorId, monitorId)));
  if (!monitor) throw missing(t); return monitor;
}
export async function configureReliability(userId: string, monitorId: string, input: ReliabilityConfiguration, t: Translator) {
  const configuration = apiReliabilityConfiguration.parse(input);
  return db.transaction(async tx => {
    const [monitor] = await tx.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, userId), eq(uptimeMonitor.uptimeMonitorId, monitorId))).for("update");
    if (!monitor) throw missing(t);
    if ((monitor.monitorType === "heartbeat" || monitor.monitorType === "server") && configuration.latencyTargetMs !== null) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.reliabilityHeartbeatLatency") });
    const previous = await currentReliabilityPolicy(userId, monitorId, tx);
    if (previous && previous.availabilityTargetBps === configuration.availabilityTargetBps && previous.latencyTargetMs === configuration.latencyTargetMs && previous.excludeMaintenance === configuration.excludeMaintenance) return previous;
    const [created] = await tx.insert(uptimeReliabilityPolicy).values({ userId, monitorId, version: (previous?.version ?? 0) + 1, ...configuration }).returning();
    if (!created) throw new Error("Reliability policy was not recorded"); return created;
  });
}
export async function annotateReliability(userId: string, monitorId: string, input: ReliabilityAnnotationInput, t: Translator) {
  const annotation = apiReliabilityAnnotation.parse(input);
  return db.transaction(async tx => {
  const [monitor] = await tx.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, userId), eq(uptimeMonitor.uptimeMonitorId, monitorId))).for("update");
  if (!monitor) throw missing(t);
  if (Date.parse(annotation.at) < Date.now() - await reliabilityRetentionDays(userId) * DAY_MS) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.reliabilityRetention") });
  if (Date.parse(annotation.at) > Date.now()) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.reliabilityWindow") });
  let link: string | null = null;
  if (annotation.link) {
    try {
      const url = new URL(annotation.link);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || redactIncidentText(monitor, url.href, t) !== url.href) throw new Error("Unsafe annotation link");
      link = url.href;
    } catch { throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.reliabilityLink") }); }
  }
  // Technical bound: 1,000 annotations/monitor bounds history reads and storage; add archival before raising it.
  const [stored] = await tx.select({ value: count() }).from(uptimeReliabilityAnnotation).where(and(eq(uptimeReliabilityAnnotation.userId, userId), eq(uptimeReliabilityAnnotation.monitorId, monitorId)));
  if ((stored?.value ?? 0) >= 1000) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.reliabilityAnnotationLimit") });
  const [created] = await tx.insert(uptimeReliabilityAnnotation).values({ userId, monitorId, actorId: userId, at: annotation.at, link,
    environment: redactIncidentText(monitor, annotation.environment, t).slice(0, 100), version: redactIncidentText(monitor, annotation.version, t).slice(0, 100), text: redactIncidentText(monitor, annotation.text, t).slice(0, 1000) }).returning();
  if (!created) throw new Error("Reliability annotation was not recorded"); return created;
  });
}
export async function listReliabilityAnnotations(userId: string, monitorId: string, input: { window: { from: string; to: string }; limit: number; cursor?: { at: string; id: string } }, t: Translator) {
  const monitor = await ownedMonitor(userId, monitorId, t), window = apiReliabilityWindow.parse(input.window);
  const retentionDays = await reliabilityRetentionDays(userId);
  const from = new Date(Math.max(Date.parse(window.from), Date.now() - retentionDays * DAY_MS)).toISOString();
  const conditions = [eq(uptimeReliabilityAnnotation.userId, userId), eq(uptimeReliabilityAnnotation.monitorId, monitorId), gte(uptimeReliabilityAnnotation.at, from), lt(uptimeReliabilityAnnotation.at, window.to)];
  if (input.cursor) conditions.push(or(lt(uptimeReliabilityAnnotation.at, input.cursor.at), and(eq(uptimeReliabilityAnnotation.at, input.cursor.at), lt(uptimeReliabilityAnnotation.id, input.cursor.id)))!);
  const rows = await db.select().from(uptimeReliabilityAnnotation).where(and(...conditions)).orderBy(desc(uptimeReliabilityAnnotation.at), desc(uptimeReliabilityAnnotation.id)).limit(input.limit + 1);
  const data = rows.slice(0, input.limit).map(row => ({ ...row, environment: redactIncidentText(monitor, row.environment, t), version: redactIncidentText(monitor, row.version, t), text: redactIncidentText(monitor, row.text, t), link: row.link && redactIncidentText(monitor, row.link, t) === row.link ? row.link : null }));
  const last = data.at(-1);
  return { data, nextCursor: rows.length > input.limit && last ? { at: last.at, id: last.id } : null };
}
export async function listReliabilityPolicies(userId: string, monitorId: string, input: { limit: number; beforeVersion?: number }, t: Translator) {
  await ownedMonitor(userId, monitorId, t);
  const rows = await db.select().from(uptimeReliabilityPolicy).where(and(eq(uptimeReliabilityPolicy.userId, userId), eq(uptimeReliabilityPolicy.monitorId, monitorId), input.beforeVersion === undefined ? undefined : lt(uptimeReliabilityPolicy.version, input.beforeVersion))).orderBy(desc(uptimeReliabilityPolicy.version)).limit(input.limit + 1);
  const data = rows.slice(0, input.limit); return { data, nextVersion: rows.length > input.limit ? data.at(-1)!.version : null };
}
function addCounters(bucket: ReliabilityBucket, next: ReliabilityBucket) {
  for (const key of Object.keys(bucket.raw) as Array<keyof ReliabilityBucket["raw"]>) { bucket.raw[key] += next.raw[key]; bucket.adjusted[key] += next.adjusted[key]; }
  bucket.excludedMs += next.excludedMs; bucket.adjustmentEnabled ||= next.adjustmentEnabled;
  bucket.policyIds = [...new Set([...bucket.policyIds, ...next.policyIds])].sort();
  bucket.checks += next.checks; bucket.upChecks += next.upChecks; bucket.timingSumMs += next.timingSumMs; bucket.timingCount += next.timingCount;
  if (next.minTimingMs !== null) bucket.minTimingMs = Math.min(bucket.minTimingMs ?? next.minTimingMs, next.minTimingMs);
  if (next.maxTimingMs !== null) bucket.maxTimingMs = Math.max(bucket.maxTimingMs ?? next.maxTimingMs, next.maxTimingMs);
}
function addMeasured(bucket: ReliabilityBucket, segments: ReliabilitySegment[], from: number, to: number) {
  if (!segments.length) return;
  const measured = measureReliabilityWindow({ from, to, availabilityTargetBps: null }, segments);
  for (const key of Object.keys(bucket.raw) as Array<keyof ReliabilityBucket["raw"]>) { bucket.raw[key] += measured.raw[key]; bucket.adjusted[key] += (measured.maintenanceAdjusted ?? measured.raw)[key]; }
  bucket.excludedMs += measured.maintenanceAdjusted?.excludedMs ?? 0; bucket.adjustmentEnabled ||= Boolean(measured.maintenanceAdjusted);
  bucket.policyIds = [...new Set([...bucket.policyIds, ...measured.policyIds])].sort();
}
/** Compact complete UTC days plus at most two bounded boundary-day reads.
 * Legacy samples lack captured horizons and therefore supply no invented time.
 */
export async function readReliability(userId: string, monitorId: string, input: { from: string; to: string }, t: Translator) {
  return db.transaction(async tx => {
  const monitor = await ownedMonitor(userId, monitorId, t, tx); const requested = apiReliabilityWindow.parse(input);
  const now = Date.now(); const retentionDays = await reliabilityRetentionDays(userId);
  if (Date.parse(requested.to) - Date.parse(requested.from) > retentionDays * DAY_MS) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.reliabilityRetention") });
  const from = Date.parse(requested.from), to = Math.min(Date.parse(requested.to), now);
  if (to <= from) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.reliabilityWindow") });
  const retainedFrom = Math.max(from, now - retentionDays * DAY_MS);
  const scope = and(eq(uptimeReliabilityCursor.userId, userId), eq(uptimeReliabilityCursor.monitorId, monitorId));
  const [cursor] = await tx.select().from(uptimeReliabilityCursor).where(scope);
  const policy = await currentReliabilityPolicy(userId, monitorId, tx);
  const total = emptyReliabilityBucket(), series: Array<{ date: string; raw: ReturnType<typeof finalizeReliabilityTotals>; maintenanceAdjusted: ReturnType<typeof finalizeReliabilityTotals> | null; checks: number; checkSuccessPercent: number | null; averageTimingMs: number | null }> = [];
  let boundaryLimited = false;
  if (to > retainedFrom) {
    const startFull = Math.ceil(retainedFrom / DAY_MS) * DAY_MS, endFull = dayStart(to);
    const days = startFull < endFull ? await tx.select().from(uptimeReliabilityDay).where(and(eq(uptimeReliabilityDay.userId, userId), eq(uptimeReliabilityDay.monitorId, monitorId), gte(uptimeReliabilityDay.day, dayKey(startFull)), lt(uptimeReliabilityDay.day, dayKey(endFull)))).orderBy(asc(uptimeReliabilityDay.day)) : [];
    const byDay = new Map(days.map(day => [day.day, day.bucket]));
    const boundaries = [...new Set([dayStart(retainedFrom), dayStart(to - 1)])].filter(start => start < retainedFrom || start + DAY_MS > to);
    const boundaryConditions = boundaries.map(start => and(lt(uptimeCheckLog.createdAt, new Date(Math.min(to, start + DAY_MS)).toISOString()), or(gt(uptimeCheckLog.observationEndedAt, new Date(Math.max(retainedFrom, start)).toISOString()), gte(uptimeCheckLog.createdAt, new Date(Math.max(retainedFrom, start)).toISOString()))));
    // Technical bound: 10000 records across two boundary days; use finer compact buckets
    // when measured manual-check bursts require exact clipping beyond this bound.
    const logs = boundaries.length ? await tx.select().from(uptimeCheckLog).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeCheckLog.uptimeMonitorId)).where(and(eq(uptimeMonitor.userId, userId), eq(uptimeMonitor.uptimeMonitorId, monitorId), or(...boundaryConditions))).orderBy(asc(uptimeCheckLog.createdAt), asc(uptimeCheckLog.checkLogId)).limit(10001) : [];
    boundaryLimited = logs.length > 10000;
    const usableLogs = boundaryLimited ? [] : logs.map(row => row.uptime_check_log);
    const live = cursor ? boundedObservation(cursor.observation, to) : null;
    for (let start = dayStart(retainedFrom); start < to; start += DAY_MS) {
      const rangeFrom = Math.max(retainedFrom, start), rangeTo = Math.min(to, start + DAY_MS), day = dayKey(start);
      const boundary = boundaries.includes(start), bucket = boundary ? emptyReliabilityBucket() : byDay.get(day) ?? emptyReliabilityBucket();
      if (boundary) {
        const segments = usableLogs.flatMap(log => { if (!log.observation || !log.observationEndedAt) return []; const segment = boundedObservation(log.observation, Date.parse(log.observationEndedAt)); return segment && segment.from < rangeTo && segment.to > rangeFrom ? [segment] : []; });
        addMeasured(bucket, segments, rangeFrom, rangeTo);
        for (const log of usableLogs) if (log.observation && Date.parse(log.createdAt) >= rangeFrom && Date.parse(log.createdAt) < rangeTo) {
          bucket.checks++; if (log.status === "up") bucket.upChecks++;
          if (monitor.monitorType !== "heartbeat" && monitor.monitorType !== "server" && log.responseTime !== null) { bucket.timingCount++; bucket.timingSumMs += log.responseTime; }
        }
      }
      if (live && live.from < rangeTo && live.to > rangeFrom) addMeasured(bucket, [live], rangeFrom, rangeTo);
      const windowMs = rangeTo - rangeFrom, unknownMs = Math.max(0, windowMs - bucket.raw.observedMs), target = policy?.availabilityTargetBps ?? null;
      const raw = finalizeReliabilityTotals({ ...bucket.raw, windowMs, unknownMs, excludedMs: 0 }, target);
      const adjusted = bucket.adjustmentEnabled ? finalizeReliabilityTotals({ ...bucket.adjusted, windowMs, unknownMs, excludedMs: bucket.excludedMs }, target) : null;
      series.push({ date: day, raw, maintenanceAdjusted: adjusted, checks: bucket.checks, checkSuccessPercent: bucket.checks ? bucket.upChecks / bucket.checks * 100 : null, averageTimingMs: bucket.timingCount ? bucket.timingSumMs / bucket.timingCount : null });
      addCounters(total, bucket);
    }
  }
  const windowMs = to - from, unknownMs = Math.max(0, windowMs - total.raw.observedMs), target = policy?.availabilityTargetBps ?? null;
  return { monitorId, monitorType: monitor.monitorType, from: new Date(from).toISOString(), to: new Date(to).toISOString(), asOf: new Date(now).toISOString(), retainedFrom: new Date(retainedFrom).toISOString(), retentionClipped: retainedFrom > from, boundaryLimited,
    raw: finalizeReliabilityTotals({ ...total.raw, windowMs, unknownMs, excludedMs: 0 }, target), maintenanceAdjusted: total.adjustmentEnabled ? finalizeReliabilityTotals({ ...total.adjusted, windowMs, unknownMs, excludedMs: total.excludedMs }, target) : null,
    checks: total.checks, checkSuccessPercent: total.checks ? total.upChecks / total.checks * 100 : null, averageTimingMs: total.timingCount ? total.timingSumMs / total.timingCount : null, policyIds: total.policyIds, policy, series };
  }, { isolationLevel: "repeatable read" });
}
