import { apiIncidentWorkspaceList, db, user, uptimeIncident, uptimeIncidentResponse, uptimeIncidentEvent, uptimeIncidentGroup, uptimeIncidentEscalation, uptimeMonitor, uptimeNotificationLog, uptimeStatusChange, type DbExecutor } from "@pulsy/db";
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, or, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { redactIncidentText } from "./incident-text";
export { redactIncidentText } from "./incident-text";
import { getTranslator, type Translator } from "../../lib/i18n";

type Monitor = typeof uptimeMonitor.$inferSelect;
type Incident = typeof uptimeIncident.$inferSelect;
const responseScope = (incidentId: string, ownerId: string) => and(eq(uptimeIncidentResponse.incidentId, incidentId), eq(uptimeIncidentResponse.userId, ownerId));
const missing = (t: Translator) => new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "incident" }) });
const invalid = (t: Translator) => new TRPCError({ code: "BAD_REQUEST", message: t("errors.incidentResponseInvalid") });

async function ownedIncident(incidentId: string, ownerId: string, t: Translator, dbc: DbExecutor = db) {
  const [row] = await dbc.select({ incident: uptimeIncident, monitor: uptimeMonitor }).from(uptimeIncident).innerJoin(uptimeMonitor, eq(uptimeIncident.uptimeMonitorId, uptimeMonitor.uptimeMonitorId)).where(and(eq(uptimeIncident.incidentId, incidentId), eq(uptimeMonitor.userId, ownerId))).limit(1);
  if (!row) throw missing(t); return row;
}
export async function lockedIncident(incidentId: string, ownerId: string, t: Translator, tx: DbExecutor) {
  const target = await ownedIncident(incidentId, ownerId, t, tx);
  const [monitor] = await tx.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.uptimeMonitorId, target.monitor.uptimeMonitorId), eq(uptimeMonitor.userId, ownerId))).for("update");
  if (!monitor) throw missing(t);
  const { incident } = await ownedIncident(incidentId, ownerId, t, tx);
  await tx.insert(uptimeIncidentResponse).values({ incidentId, monitorId: monitor.uptimeMonitorId, userId: ownerId }).onConflictDoNothing();
  const [response] = await tx.select().from(uptimeIncidentResponse).where(and(responseScope(incidentId, ownerId), eq(uptimeIncidentResponse.monitorId, monitor.uptimeMonitorId))).for("update");
  if (!response) throw missing(t); return { incident, monitor, response };
}
export async function appendEvent(tx: DbExecutor, target: Awaited<ReturnType<typeof lockedIncident>>, kind: typeof uptimeIncidentEvent.$inferInsert.kind, text: string | null, t: Translator, createdAt?: string) {
  // Technical bound: 1,000 private actions per incident; add archival paging when real response histories approach this bound.
  if (target.response.eventCount >= 1000) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.incidentTimelineLimit") });
  const now = createdAt ?? new Date().toISOString();
  await tx.insert(uptimeIncidentEvent).values({ incidentId: target.incident.incidentId, monitorId: target.monitor.uptimeMonitorId, userId: target.monitor.userId, actorId: target.monitor.userId, kind, text, createdAt: now, facts: kind === "acknowledged" ? { acknowledgedAt: now } : undefined });
  await tx.update(uptimeIncidentResponse).set({ eventCount: target.response.eventCount + 1, updatedAt: now }).where(responseScope(target.incident.incidentId, target.monitor.userId));
}
export async function acknowledgeIncident(incidentId: string, ownerId: string, t: Translator) {
  return db.transaction(async tx => {
    const target = await lockedIncident(incidentId, ownerId, t, tx);
    if (target.incident.status !== "ongoing") throw invalid(t);
    if (!target.response.acknowledgedAt) {
      const acknowledgedAt = new Date().toISOString();
      await tx.update(uptimeIncidentResponse).set({ acknowledgedAt, acknowledgedBy: ownerId }).where(responseScope(incidentId, ownerId));
      await appendEvent(tx, target, "acknowledged", null, t, acknowledgedAt);
    }
    return { acknowledged: true };
  });
}
export async function unacknowledgeIncident(incidentId: string, ownerId: string, t: Translator) {
  return db.transaction(async tx => {
    const target = await lockedIncident(incidentId, ownerId, t, tx);
    if (target.incident.status !== "ongoing") throw invalid(t);
    if (target.response.acknowledgedAt) {
      // Older events projected the response timestamp. Freeze that projection in
      // event metadata before clearing it, so later acknowledgements cannot retime history.
      const acknowledgements = await tx.select().from(uptimeIncidentEvent).where(and(
        eq(uptimeIncidentEvent.incidentId, incidentId), eq(uptimeIncidentEvent.monitorId, target.monitor.uptimeMonitorId),
        eq(uptimeIncidentEvent.userId, ownerId), eq(uptimeIncidentEvent.kind, "acknowledged"),
      ));
      for (const event of acknowledgements) if (!event.facts?.acknowledgedAt) {
        await tx.update(uptimeIncidentEvent).set({ facts: { ...event.facts, acknowledgedAt: target.response.acknowledgedAt } })
          .where(and(eq(uptimeIncidentEvent.id, event.id), eq(uptimeIncidentEvent.userId, ownerId), eq(uptimeIncidentEvent.monitorId, target.monitor.uptimeMonitorId)));
      }
      await tx.update(uptimeIncidentResponse).set({ acknowledgedAt: null, acknowledgedBy: null }).where(responseScope(incidentId, ownerId));
      await appendEvent(tx, target, "unacknowledged", null, t);
    }
    return { acknowledged: false };
  });
}
export async function addIncidentNote(incidentId: string, ownerId: string, text: string, t: Translator) {
  if (!text.trim() || text.length > 2000) throw invalid(t);
  return db.transaction(async tx => { const target = await lockedIncident(incidentId, ownerId, t, tx); await appendEvent(tx, target, "note", redactIncidentText(target.monitor, text.trim(), t), t); return { saved: true }; });
}
export async function configureIncidentRunbook(incidentId: string, ownerId: string, input: { description: string; url?: string; expected?: { description: string; url: string | null } }, t: Translator) {
  if (input.description.length > 2000 || (input.url?.length ?? 0) > 1000) throw invalid(t);
  if (input.url) { try { const url = new URL(input.url); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw invalid(t); } catch { throw invalid(t); } }
  return db.transaction(async tx => {
    const target = await lockedIncident(incidentId, ownerId, t, tx); const description = redactIncidentText(target.monitor, input.description, t);
    if (input.expected && (target.response.runbookDescription !== input.expected.description || target.response.runbookUrl !== input.expected.url)) {
      throw new TRPCError({ code: "CONFLICT", message: t("errors.incidentRunbookConflict") });
    }
    if (input.url && redactIncidentText(target.monitor, input.url, t) !== input.url) throw invalid(t);
    await tx.update(uptimeIncidentResponse).set({ runbookDescription: description, runbookUrl: input.url || null }).where(responseScope(incidentId, ownerId));
    await appendEvent(tx, target, "runbook", description, t); return { saved: true };
  });
}
export async function createIncidentGroup(ownerId: string, name: string, incidentIds: string[], t: Translator) {
  if (!name.trim() || name.length > 80 || incidentIds.length < 2 || incidentIds.length > 100 || new Set(incidentIds).size !== incidentIds.length) throw invalid(t);
  return db.transaction(async tx => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, ownerId)).for("update");
    const [groups] = await tx.select({ total: count() }).from(uptimeIncidentGroup).where(eq(uptimeIncidentGroup.userId, ownerId));
    // Technical bound: 200 response groups per account; add archive/remove controls when measured usage approaches this ceiling.
    if (groups!.total >= 200) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.incidentGroupLimit") });
    // Parent locks are acquired in stable monitor order for selections spanning incidents.
    const targets = await tx.select({ id: uptimeMonitor.uptimeMonitorId, requestCipher: uptimeMonitor.requestCipher }).from(uptimeIncident).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeIncident.uptimeMonitorId)).where(and(inArray(uptimeIncident.incidentId, incidentIds), eq(uptimeMonitor.userId, ownerId)));
    if (targets.length !== incidentIds.length) throw missing(t);
    for (const id of [...new Set(targets.map(target => target.id))].sort()) await tx.select({ id: uptimeMonitor.uptimeMonitorId }).from(uptimeMonitor).where(and(eq(uptimeMonitor.uptimeMonitorId, id), eq(uptimeMonitor.userId, ownerId))).for("update");
    let groupName = name.trim();
    for (const target of targets) groupName = redactIncidentText(target, groupName, t);
    const [group] = await tx.insert(uptimeIncidentGroup).values({ name: groupName, userId: ownerId }).returning();
    for (const incidentId of [...incidentIds].sort()) {
      const target = await lockedIncident(incidentId, ownerId, t, tx);
      await tx.update(uptimeIncidentResponse).set({ groupId: group!.id }).where(responseScope(incidentId, ownerId));
      await appendEvent(tx, target, "grouped", null, t);
    }
    return { id: group!.id, name: group!.name };
  });
}
function safeCause(requestCipher: string | null, text: string) { try { return redactIncidentText({ requestCipher }, text, getTranslator("en")); } catch { return "[redacted]"; } }
/** Project legacy source timestamps without rewriting the append-only trail.
 * Keyset batches bound query and memory sizes; every source lookup is owner/monitor scoped.
 */
async function projectedEvents(ownerId: string, monitorId: string, incidentId: string, limit: number) {
  type Event = typeof uptimeIncidentEvent.$inferSelect;
  let cursor: Pick<Event, "createdAt" | "id"> | undefined;
  let latest: Event[] = [];
  for (;;) {
    const rows = await db.select({ event: uptimeIncidentEvent, acknowledgedAt: uptimeIncidentResponse.acknowledgedAt })
      .from(uptimeIncidentEvent).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeIncidentEvent.monitorId))
      .leftJoin(uptimeIncidentResponse, and(eq(uptimeIncidentResponse.incidentId, uptimeIncidentEvent.incidentId), eq(uptimeIncidentResponse.monitorId, uptimeIncidentEvent.monitorId), eq(uptimeIncidentResponse.userId, ownerId)))
      .where(and(eq(uptimeIncidentEvent.userId, ownerId), eq(uptimeMonitor.userId, ownerId), eq(uptimeIncidentEvent.monitorId, monitorId), eq(uptimeIncidentEvent.incidentId, incidentId),
        cursor ? or(lt(uptimeIncidentEvent.createdAt, cursor.createdAt), and(eq(uptimeIncidentEvent.createdAt, cursor.createdAt), lt(uptimeIncidentEvent.id, cursor.id))) : undefined))
      .orderBy(desc(uptimeIncidentEvent.createdAt), desc(uptimeIncidentEvent.id)).limit(500);
    if (!rows.length) break;
    const logIds = rows.flatMap(({ event }) => event.kind === "alert" && event.sourceId?.startsWith("alert-") ? [event.sourceId.slice(6)] : []);
    const logs = logIds.length ? await db.select({ id: uptimeNotificationLog.notificationLogId, createdAt: uptimeNotificationLog.createdAt })
      .from(uptimeNotificationLog).where(and(eq(uptimeNotificationLog.userId, ownerId), eq(uptimeNotificationLog.uptimeMonitorId, monitorId), inArray(uptimeNotificationLog.notificationLogId, logIds))) : [];
    const deliveredAt = new Map(logs.map(log => [log.id, log.createdAt]));
    latest.push(...rows.map(({ event, acknowledgedAt }) => ({ ...event, createdAt: event.kind === "acknowledged"
      ? event.facts?.acknowledgedAt ?? acknowledgedAt ?? event.createdAt
      : event.kind === "alert" && event.sourceId?.startsWith("alert-") ? deliveredAt.get(event.sourceId.slice(6)) ?? event.createdAt : event.createdAt })));
    latest.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    latest = latest.slice(0, limit);
    if (rows.length < 500) break;
    cursor = rows.at(-1)!.event;
  }
  return latest;
}
export async function listWorkspaceIncidents(ownerId: string, input: z.input<typeof apiIncidentWorkspaceList>) {
  const config = apiIncidentWorkspaceList.parse(input); const conditions: Array<SQL | undefined> = [eq(uptimeMonitor.userId, ownerId)];
  if (config.state === "resolved") conditions.push(eq(uptimeIncident.status, "resolved"));
  // The stable `state=open` URL means unresolved: both open and acknowledged
  // incidents remain actionable until they are resolved. The explicit
  // acknowledged filter narrows that set to acknowledged rows.
  if (config.state === "open") conditions.push(eq(uptimeIncident.status, "ongoing"));
  if (config.state === "acknowledged") conditions.push(eq(uptimeIncident.status, "ongoing"), isNotNull(uptimeIncidentResponse.acknowledgedAt));
  if (config.monitorId) conditions.push(eq(uptimeMonitor.uptimeMonitorId, config.monitorId));
  if (config.groupId) conditions.push(eq(uptimeIncidentResponse.groupId, config.groupId));
  if (config.severity) conditions.push(eq(uptimeIncident.severity, config.severity));
  if (config.search) { const pattern = `%${config.search.replace(/[\\%_]/g, char => `\\${char}`)}%`; conditions.push(or(ilike(uptimeMonitor.name, pattern), ilike(uptimeIncident.cause, pattern))); }
  if (config.cursor) conditions.push(or(lt(uptimeIncident.startedAt, config.cursor.startedAt), and(eq(uptimeIncident.startedAt, config.cursor.startedAt), lt(uptimeIncident.incidentId, config.cursor.incidentId))));
  const rows = await db.select({ requestCipher: uptimeMonitor.requestCipher, incidentId: uptimeIncident.incidentId, monitorId: uptimeIncident.uptimeMonitorId, monitorName: uptimeMonitor.name, measuredHealth: uptimeMonitor.status, monitorActive: uptimeMonitor.active, status: uptimeIncident.status, severity: uptimeIncident.severity, cause: uptimeIncident.cause, startedAt: uptimeIncident.startedAt, resolvedAt: uptimeIncident.resolvedAt, durationSeconds: uptimeIncident.durationSeconds, ownerId: uptimeMonitor.userId, acknowledgedAt: uptimeIncidentResponse.acknowledgedAt, acknowledgedBy: uptimeIncidentResponse.acknowledgedBy, responseUpdatedAt: uptimeIncidentResponse.updatedAt, groupId: uptimeIncidentResponse.groupId }).from(uptimeIncident).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeIncident.uptimeMonitorId)).leftJoin(uptimeIncidentResponse, and(eq(uptimeIncidentResponse.incidentId, uptimeIncident.incidentId), eq(uptimeIncidentResponse.userId, ownerId), eq(uptimeIncidentResponse.monitorId, uptimeMonitor.uptimeMonitorId))).where(and(...conditions)).orderBy(desc(uptimeIncident.startedAt), desc(uptimeIncident.incidentId)).limit(config.limit + 1);
  const more = rows.length > config.limit; const pageRows = rows.slice(0, config.limit);
  const eventTimes = new Map<string, string>();
  for (let offset = 0; offset < pageRows.length; offset += 4) {
    await Promise.all(pageRows.slice(offset, offset + 4).map(async row => {
      const [event] = await projectedEvents(ownerId, row.monitorId, row.incidentId, 1);
      if (event) eventTimes.set(row.incidentId, event.createdAt);
    }));
  }
  const items = pageRows.map(({ responseUpdatedAt, requestCipher, ...row }) => ({ ...row, cause: row.cause ? safeCause(requestCipher, row.cause) : null, lastUpdatedAt: [eventTimes.get(row.incidentId) ?? responseUpdatedAt, row.resolvedAt, row.startedAt].filter((value): value is string => !!value).sort().at(-1)! }));
  const last = items.at(-1); return { items, nextCursor: more && last ? { startedAt: last.startedAt, incidentId: last.incidentId } : null };
}
export interface IncidentTimelineItem { id: string; kind: string; createdAt: string; actorId: string | null; text: string | null; status?: string; event?: string; outcome?: string; channelType?: string; }
async function timelineFor(incident: Incident, monitor: Monitor, t: Translator) {
  const incidentId = incident.incidentId; const ownerId = monitor.userId; const monitorId = monitor.uptimeMonitorId;
  const start = incident.startedAt, end = incident.resolvedAt ?? new Date().toISOString();
  const events = await projectedEvents(ownerId, monitorId, incidentId, 101);
  const changes = await db.select({ id: uptimeStatusChange.statusChangeId, createdAt: uptimeStatusChange.createdAt, status: uptimeStatusChange.statusAfter, text: uptimeStatusChange.reason }).from(uptimeStatusChange).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeStatusChange.uptimeMonitorId)).where(and(eq(uptimeMonitor.userId, ownerId), eq(uptimeMonitor.uptimeMonitorId, monitorId), gte(uptimeStatusChange.createdAt, start), lte(uptimeStatusChange.createdAt, end))).orderBy(desc(uptimeStatusChange.createdAt), desc(uptimeStatusChange.statusChangeId)).limit(101);
  const alerts = await db.select({ id: uptimeNotificationLog.notificationLogId, createdAt: uptimeNotificationLog.createdAt, event: uptimeNotificationLog.event, outcome: uptimeNotificationLog.outcome, channelType: uptimeNotificationLog.channelType }).from(uptimeNotificationLog).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeNotificationLog.uptimeMonitorId)).where(and(eq(uptimeNotificationLog.userId, ownerId), eq(uptimeMonitor.userId, ownerId), eq(uptimeMonitor.uptimeMonitorId, monitorId), gte(uptimeNotificationLog.createdAt, start), lte(uptimeNotificationLog.createdAt, end), inArray(uptimeNotificationLog.event, ["down", "degraded", "recovery"]))).orderBy(desc(uptimeNotificationLog.createdAt), desc(uptimeNotificationLog.notificationLogId)).limit(101);
  const all: IncidentTimelineItem[] = [...events.map(event => ({ id: event.sourceId ?? `human-${event.id}`, kind: event.kind, createdAt: event.createdAt, actorId: event.actorId, text: event.text && redactIncidentText(monitor, event.text, t), ...event.facts })), ...changes.filter(event => !events.some(stored => stored.sourceId === `check-${event.id}`)).map(event => ({ ...event, id: `check-${event.id}`, kind: "check", actorId: null, text: event.text && redactIncidentText(monitor, event.text, t) })), ...alerts.filter(event => !events.some(stored => stored.sourceId === `alert-${event.id}`)).map(event => ({ ...event, id: `alert-${event.id}`, kind: "alert", actorId: null, text: null }))];
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)); return { timeline: all.slice(0, 100), timelineTruncated: all.length > 100 };
}
export async function incidentWorkspaceDetail(incidentId: string, ownerId: string, t: Translator) {
  const { incident, monitor } = await ownedIncident(incidentId, ownerId, t);
  const [response] = await db.select().from(uptimeIncidentResponse).where(and(responseScope(incidentId, ownerId), eq(uptimeIncidentResponse.monitorId, monitor.uptimeMonitorId))).limit(1);
  const group = response?.groupId ? (await db.select({ id: uptimeIncidentGroup.id, name: uptimeIncidentGroup.name }).from(uptimeIncidentGroup).where(and(eq(uptimeIncidentGroup.id, response.groupId), eq(uptimeIncidentGroup.userId, ownerId))).limit(1))[0] ?? null : null;
  const escalationJobs = await db.select({ step: uptimeIncidentEscalation.step, state: uptimeIncidentEscalation.state, dueAt: uptimeIncidentEscalation.dueAt, attempts: uptimeIncidentEscalation.attempts, deliveredCount: uptimeIncidentEscalation.deliveredTargets }).from(uptimeIncidentEscalation).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeIncidentEscalation.monitorId)).where(and(eq(uptimeIncidentEscalation.incidentId, incidentId), eq(uptimeIncidentEscalation.userId, ownerId), eq(uptimeMonitor.userId, ownerId), eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId))).orderBy(uptimeIncidentEscalation.step).limit(2);
  return { incident: { ...incident, cause: incident.cause && redactIncidentText(monitor, incident.cause, t) }, monitor: { id: monitor.uptimeMonitorId, name: monitor.name, status: monitor.status, active: monitor.active }, response: { acknowledgedAt: response?.acknowledgedAt ?? null, acknowledgedBy: response?.acknowledgedBy ?? null, runbookDescription: response?.runbookDescription ?? "", runbookUrl: response?.runbookUrl ?? null, group, escalationSteps: response?.escalationSteps ?? null, escalationDisabled: response?.escalationDisabled ?? false }, escalationJobs: escalationJobs.map(job => ({ ...job, deliveredCount: job.deliveredCount.length })), ...await timelineFor(incident, monitor, t) };
}
