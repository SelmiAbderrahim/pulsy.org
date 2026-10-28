import { db, uptimeStatusPage, uptimeStatusPageMonitor, uptimeMonitor, uptimeReliabilityDay, uptimeReliabilityCursor } from "@pulsy/db";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { reliabilityRetentionDays } from "./reliability-retention";
import { DAY_MS, dayStart, dayKey, emptyReliabilityBucket } from "./reliability-storage";
import { finalizeReliabilityTotals, boundedObservation, measureReliabilityWindow } from "./reliability-math";
/** Deliberately public, seven completed UTC days. One batched aggregate read,
 * no raw check scan, private names, goals, URLs, notes, policy IDs or N+1 reads.
 */
export async function readPublicReliability(pageId: string) {
  return db.transaction(async tx => {
    const [page] = await tx.select().from(uptimeStatusPage).where(and(eq(uptimeStatusPage.statusPageId, pageId), eq(uptimeStatusPage.isPublished, true), eq(uptimeStatusPage.historyEnabled, true))).for("share");
    if (!page) return null;
    const now = Date.now(), to = dayStart(now), from = to - 7 * DAY_MS;
    const retainedDay = Math.ceil((now - await reliabilityRetentionDays(page.userId) * DAY_MS) / DAY_MS) * DAY_MS;
    const components = await tx.select({ componentId: uptimeStatusPageMonitor.id, monitorId: uptimeMonitor.uptimeMonitorId, monitorType: uptimeMonitor.monitorType }).from(uptimeStatusPageMonitor).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeStatusPageMonitor.uptimeMonitorId)).where(and(eq(uptimeStatusPageMonitor.statusPageId, pageId), eq(uptimeMonitor.userId, page.userId), eq(uptimeMonitor.active, true))).orderBy(asc(uptimeStatusPageMonitor.sortOrder), asc(uptimeStatusPageMonitor.id));
    const rows: Array<typeof uptimeReliabilityDay.$inferSelect> = [];
    const cursors: Array<typeof uptimeReliabilityCursor.$inferSelect> = [];
    // One bounded pair of reads per hundred components; page size never gates history.
    for (let offset = 0; offset < components.length; offset += 100) {
      const ids = components.slice(offset, offset + 100).map(component => component.monitorId);
      rows.push(...await tx.select().from(uptimeReliabilityDay).where(and(eq(uptimeReliabilityDay.userId, page.userId), inArray(uptimeReliabilityDay.monitorId, ids),
        gte(uptimeReliabilityDay.day, dayKey(Math.max(from, retainedDay))), lt(uptimeReliabilityDay.day, dayKey(to)))).limit(700));
      cursors.push(...await tx.select().from(uptimeReliabilityCursor).where(and(eq(uptimeReliabilityCursor.userId, page.userId), inArray(uptimeReliabilityCursor.monitorId, ids))).limit(100));
    }
    const live = new Map(cursors.map(cursor => [cursor.monitorId, boundedObservation(cursor.observation, to)]));
    const byMonitor = new Map<string, Map<string, (typeof rows)[number]["bucket"]>>();
    for (const row of rows) { const days = byMonitor.get(row.monitorId) ?? new Map(); days.set(row.day, row.bucket); byMonitor.set(row.monitorId, days); }
    return { version: 1 as const, asOf: new Date(now).toISOString(), from: new Date(from).toISOString(), to: new Date(to).toISOString(), timezone: "UTC" as const,
      components: components.map(component => ({ componentId: component.componentId, timingKind: (component.monitorType === "heartbeat" || component.monitorType === "server") ? "none" as const : component.monitorType === "tcp" ? "connection" as const : component.monitorType === "dns" ? "resolution" as const : "response" as const,
        days: Array.from({ length: 7 }, (_, index) => {
          const start = from + index * DAY_MS, date = dayKey(start), bucket = byMonitor.get(component.monitorId)?.get(date) ?? emptyReliabilityBucket();
          const segment = live.get(component.monitorId);
          if (start >= retainedDay && segment && segment.from < start + DAY_MS && segment.to > start) {
            const measured = measureReliabilityWindow({ from: start, to: start + DAY_MS, availabilityTargetBps: null }, [segment]);
            for (const key of Object.keys(bucket.raw) as Array<keyof typeof bucket.raw>) { bucket.raw[key] += measured.raw[key]; bucket.adjusted[key] += (measured.maintenanceAdjusted ?? measured.raw)[key]; }
            bucket.excludedMs += measured.maintenanceAdjusted?.excludedMs ?? 0; bucket.adjustmentEnabled ||= Boolean(measured.maintenanceAdjusted);
          }
          const unknownMs = Math.max(0, DAY_MS - bucket.raw.observedMs);
          return { date, raw: finalizeReliabilityTotals({ ...bucket.raw, windowMs: DAY_MS, unknownMs, excludedMs: 0 }, null),
            maintenanceAdjusted: bucket.adjustmentEnabled ? finalizeReliabilityTotals({ ...bucket.adjusted, windowMs: DAY_MS, unknownMs, excludedMs: bucket.excludedMs }, null) : null,
            averageTimingMs: (component.monitorType === "heartbeat" || component.monitorType === "server") || !bucket.timingCount ? null : bucket.timingSumMs / bucket.timingCount };
        }) })) };
  }, { isolationLevel: "repeatable read" });
}
