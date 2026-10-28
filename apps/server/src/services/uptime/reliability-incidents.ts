import { db, uptimeMonitor, uptimeIncident, apiReliabilityWindow } from "@pulsy/db";
import { and, eq, lt, gt, isNull, or, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Translator } from "../../lib/i18n";
import { reliabilityRetentionDays } from "./reliability-retention";
import { DAY_MS } from "./reliability-storage";
import { redactIncidentText } from "./incident-text";
import { describeCheckReason } from "./check-error";
export async function readReliabilityIncidents(userId: string, monitorId: string, input: { window: { from: string; to: string }; limit: number; cursor?: { startedAt: string; id: string } }, t: Translator) {
  const window = apiReliabilityWindow.parse(input.window), now = Date.now(), retention = await reliabilityRetentionDays(userId);
  if (Date.parse(window.to) - Date.parse(window.from) > retention * DAY_MS) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.reliabilityRetention") });
  const from = Math.max(Date.parse(window.from), now - retention * DAY_MS), to = Math.min(Date.parse(window.to), now);
  if (to <= from) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.reliabilityWindow") });
  return db.transaction(async tx => {
    const [monitor] = await tx.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, userId), eq(uptimeMonitor.uptimeMonitorId, monitorId)));
    if (!monitor) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });
    const scope = and(eq(uptimeMonitor.userId, userId), eq(uptimeMonitor.uptimeMonitorId, monitorId), lt(uptimeIncident.startedAt, new Date(to).toISOString()), or(isNull(uptimeIncident.resolvedAt), gt(uptimeIncident.resolvedAt, new Date(from).toISOString())));
    const query = () => tx.select({ incident: uptimeIncident }).from(uptimeIncident).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeIncident.uptimeMonitorId));
    // Technical bound: 1000 incidents per cause-summary window; refine with compact
    // incident aggregates when measured churn exceeds this bound. Pages remain complete.
    const summarized = await query().where(scope).orderBy(desc(uptimeIncident.startedAt), desc(uptimeIncident.incidentId)).limit(1001);
    const clipped = (row: typeof uptimeIncident.$inferSelect) => ({ id: row.incidentId, cause: redactIncidentText(monitor, describeCheckReason(row.cause, t, { timeoutMs: monitor.timeout }) ?? t("checkErrors.unknown"), t), status: row.status, startedAt: row.startedAt, resolvedAt: row.resolvedAt,
      durationMs: Math.max(0, Math.min(to, row.resolvedAt ? Date.parse(row.resolvedAt) : to) - Math.max(from, Date.parse(row.startedAt))) });
    const causes = new Map<string, { cause: string; count: number; durationMs: number }>();
    for (const { incident } of summarized.slice(0, 1000)) { const row = clipped(incident), cause = causes.get(row.cause) ?? { cause: row.cause, count: 0, durationMs: 0 }; cause.count++; cause.durationMs += row.durationMs; causes.set(row.cause, cause); }
    const cursor = input.cursor ? or(lt(uptimeIncident.startedAt, input.cursor.startedAt), and(eq(uptimeIncident.startedAt, input.cursor.startedAt), lt(uptimeIncident.incidentId, input.cursor.id))) : undefined;
    const rows = await query().where(and(scope, cursor)).orderBy(desc(uptimeIncident.startedAt), desc(uptimeIncident.incidentId)).limit(input.limit + 1);
    const data = rows.slice(0, input.limit).map(row => clipped(row.incident)), last = data.at(-1);
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), causesComplete: summarized.length <= 1000, incidentCount: Math.min(1000, summarized.length), causes: [...causes.values()].sort((a, b) => b.durationMs - a.durationMs || b.count - a.count || a.cause.localeCompare(b.cause)), data,
      nextCursor: rows.length > input.limit && last ? { startedAt: last.startedAt, id: last.id } : null };
  }, { isolationLevel: "repeatable read" });
}
