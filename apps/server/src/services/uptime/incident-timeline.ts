import { db, uptimeIncident, uptimeIncidentEvent, uptimeMonitor, uptimeNotificationLog, type DbExecutor, type UptimeMonitorRow } from "@pulsy/db";
import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import { getTranslator } from "../../lib/i18n";
import { redactIncidentText } from "./incident-text";

/** Called under the owning monitor lock, after incident creation/recovery. */
export async function appendIncidentTransition(monitor: UptimeMonitorRow, change: { statusChangeId: string; statusAfter: string; createdAt: string; reason: string | null }, dbc: DbExecutor) {
  const [incident] = await dbc.select({ id: uptimeIncident.incidentId }).from(uptimeIncident).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeIncident.uptimeMonitorId)).where(and(eq(uptimeMonitor.userId, monitor.userId), eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), or(eq(uptimeIncident.status, "ongoing"), gte(uptimeIncident.resolvedAt, change.createdAt)))).orderBy(desc(uptimeIncident.startedAt), desc(uptimeIncident.incidentId)).limit(1);
  if (!incident) return;
  let text: string | null = null;
  if (change.reason) { try { text = redactIncidentText(monitor, change.reason, getTranslator("en")); } catch { text = "[redacted]"; } }
  await dbc.insert(uptimeIncidentEvent).values({ incidentId: incident.id, monitorId: monitor.uptimeMonitorId, userId: monitor.userId, actorId: null, kind: "check", sourceId: `check-${change.statusChangeId}`, text, facts: { status: change.statusAfter }, createdAt: change.createdAt }).onConflictDoNothing({ target: [uptimeIncidentEvent.userId, uptimeIncidentEvent.sourceId] });
}
/** No recipient/provider/error/request values enter the durable response trail. */
export async function appendIncidentAlert(entry: { userId: string; uptimeMonitorId: string; statusChangeId: string | null; event: string; outcome: string; channelType: string }, logId: string, dbc: DbExecutor = db, incidentId?: string) {
  if (!entry.statusChangeId || entry.event === "tls_expiry") return;
  const [transition] = incidentId ? await dbc.select({ incidentId: uptimeIncident.incidentId }).from(uptimeIncident).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeIncident.uptimeMonitorId)).where(and(eq(uptimeIncident.incidentId, incidentId), eq(uptimeMonitor.userId, entry.userId), eq(uptimeMonitor.uptimeMonitorId, entry.uptimeMonitorId))).limit(1) : await dbc.select({ incidentId: uptimeIncidentEvent.incidentId }).from(uptimeIncidentEvent).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeIncidentEvent.monitorId)).where(and(eq(uptimeMonitor.userId, entry.userId), eq(uptimeMonitor.uptimeMonitorId, entry.uptimeMonitorId), eq(uptimeIncidentEvent.userId, entry.userId), eq(uptimeIncidentEvent.sourceId, `check-${entry.statusChangeId}`))).limit(1);
  if (!transition) return;
  // A durable copy of this delivery retains the source observation time. The
  // time spent appending an audit event is not a second delivery event.
  const [log] = await dbc.select({ createdAt: uptimeNotificationLog.createdAt }).from(uptimeNotificationLog).where(and(
    eq(uptimeNotificationLog.notificationLogId, logId), eq(uptimeNotificationLog.userId, entry.userId),
    eq(uptimeNotificationLog.uptimeMonitorId, entry.uptimeMonitorId), eq(uptimeNotificationLog.statusChangeId, entry.statusChangeId),
  )).limit(1);
  if (!log) return;
  await dbc.insert(uptimeIncidentEvent).values({ incidentId: transition.incidentId, monitorId: entry.uptimeMonitorId, userId: entry.userId, actorId: null, kind: "alert", sourceId: `alert-${logId}`, createdAt: log.createdAt, facts: { event: entry.event, outcome: entry.outcome, channelType: entry.channelType } }).onConflictDoNothing({ target: [uptimeIncidentEvent.userId, uptimeIncidentEvent.sourceId] });
  // "Alert sent at" is the first delivered outage alert, kept apart from the incident start.
  if (entry.outcome === "sent" && (entry.event === "down" || entry.event === "degraded")) await dbc.update(uptimeIncident).set({ notifiedAt: log.createdAt }).where(and(eq(uptimeIncident.incidentId, transition.incidentId), eq(uptimeIncident.uptimeMonitorId, entry.uptimeMonitorId), isNull(uptimeIncident.notifiedAt)));
}
