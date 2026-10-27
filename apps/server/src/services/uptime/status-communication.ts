import { enqueuePublishedStatusUpdate } from "./status-subscription";
import { createHash } from "node:crypto";
import { apiAnnouncementDraft, apiPublicComponents, db, uptimeMaintenance, uptimeMonitor, uptimeStatusAnnouncement, uptimeStatusPage, uptimeStatusPageMonitor, type DbExecutor } from "@pulsy/db";
import { and, asc, count, desc, eq, isNotNull, isNull, lte, gt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import type { Translator } from "../../lib/i18n";
import { redactIncidentText } from "./incident-text";
import { previewMaintenance } from "./maintenance-service";
const missing = (t: Translator) => new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "statusPage" }) });
const invalid = (t: Translator) => new TRPCError({ code: "BAD_REQUEST", message: t("errors.statusPageCommunicationInvalid") });
const changed = (t: Translator) => new TRPCError({ code: "CONFLICT", message: t("errors.pageSelectionChanged") });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function ownedPage(tx: DbExecutor, ownerId: string, pageId: string, t: Translator, lock = false) {
  const query = tx.select().from(uptimeStatusPage).where(and(eq(uptimeStatusPage.userId, ownerId), eq(uptimeStatusPage.statusPageId, pageId)));
  const [page] = await (lock ? query.for("update") : query); if (!page) throw missing(t); return page;
}
async function members(tx: DbExecutor, ownerId: string, pageId: string) {
  return tx.select({ member: uptimeStatusPageMonitor, monitor: uptimeMonitor }).from(uptimeStatusPageMonitor).innerJoin(uptimeStatusPage, eq(uptimeStatusPage.statusPageId, uptimeStatusPageMonitor.statusPageId)).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeStatusPageMonitor.uptimeMonitorId)).where(and(eq(uptimeStatusPage.userId, ownerId), eq(uptimeMonitor.userId, ownerId), eq(uptimeStatusPageMonitor.statusPageId, pageId))).orderBy(asc(uptimeStatusPageMonitor.sortOrder), asc(uptimeStatusPageMonitor.id));
}
function safeFor(text: string, rows: Awaited<ReturnType<typeof members>>, t: Translator) { let safe = text; for (const row of rows) safe = redactIncidentText(row.monitor, safe, t); return safe; }
export async function readPageCommunication(ownerId: string, pageId: string, t: Translator) {
  const page = await ownedPage(db, ownerId, pageId, t); const links = await members(db, ownerId, pageId);
  const announcements = await db.select().from(uptimeStatusAnnouncement).where(and(eq(uptimeStatusAnnouncement.userId, ownerId), eq(uptimeStatusAnnouncement.statusPageId, pageId))).orderBy(desc(uptimeStatusAnnouncement.updatedAt), desc(uptimeStatusAnnouncement.id)).limit(100);
  return { page: { id: page.statusPageId, title: page.title, slug: page.slug, published: page.isPublished, historyEnabled: page.historyEnabled }, components: links.map(({ member, monitor }) => ({ componentId: member.id, monitorId: monitor.uptimeMonitorId, privateName: monitor.name, name: member.publicName ?? monitor.name, description: member.publicDescription ?? "", group: member.publicGroup ?? "", active: monitor.active, sortOrder: member.sortOrder })), announcements };
}
async function componentsPreview(tx: DbExecutor, ownerId: string, pageId: string, input: z.input<typeof apiPublicComponents>["components"], t: Translator) {
  const parsed = apiPublicComponents.safeParse({ statusPageId: pageId, components: input }); if (!parsed.success) throw invalid(t);
  const page = await ownedPage(tx, ownerId, pageId, t, true); const rows = await members(tx, ownerId, pageId);
  if (rows.length !== parsed.data.components.length || rows.some(row => !parsed.data.components.some(component => component.componentId === row.member.id))) throw missing(t);
  const components = parsed.data.components.map(component => ({ ...component, name: safeFor(component.name, rows, t), description: safeFor(component.description, rows, t), group: safeFor(component.group, rows, t) }));
  const revision = hash({ page: { id: page.statusPageId, title: page.title, slug: page.slug, published: page.isPublished }, previous: rows.map(row => ({ member: row.member, name: row.monitor.name, cipher: row.monitor.requestCipher })), components });
  return { statusPageId: pageId, title: page.title, slug: page.slug, published: page.isPublished, components, revision };
}
export function previewPublicComponents(ownerId: string, pageId: string, input: z.input<typeof apiPublicComponents>["components"], t: Translator) { return db.transaction(tx => componentsPreview(tx, ownerId, pageId, input, t)); }
export function applyPublicComponents(ownerId: string, pageId: string, input: z.input<typeof apiPublicComponents>["components"], revision: string, t: Translator) {
  return db.transaction(async tx => {
    const preview = await componentsPreview(tx, ownerId, pageId, input, t); if (preview.revision !== revision) throw changed(t);
    for (const [index, component] of preview.components.entries()) await tx.update(uptimeStatusPageMonitor).set({ publicName: component.name, publicDescription: component.description || null, publicGroup: component.group || null, sortOrder: index }).where(and(eq(uptimeStatusPageMonitor.statusPageId, pageId), eq(uptimeStatusPageMonitor.id, component.componentId)));
    return { saved: true };
  });
}
async function announcementContext(tx: DbExecutor, ownerId: string, pageId: string, componentIds: string[], t: Translator) {
  const page = await ownedPage(tx, ownerId, pageId, t, true); const links = await members(tx, ownerId, pageId); const selected = links.filter(row => componentIds.includes(row.member.id));
  if (selected.length !== componentIds.length) throw missing(t); return { page, selected };
}
async function maintenanceOccurrence(tx: DbExecutor, ownerId: string, selected: Awaited<ReturnType<typeof members>>, input: { id: string; startsAt: string; endsAt: string } | undefined, timezone: string, t: Translator) {
  if (!input) return null;
  const [schedule] = await tx.select().from(uptimeMaintenance).where(and(eq(uptimeMaintenance.userId, ownerId), eq(uptimeMaintenance.id, input.id))).for("share");
  if (!schedule || schedule.kind !== "maintenance" || !schedule.enabled || schedule.timezone !== timezone || selected.some(row => !schedule.monitorIds.includes(row.monitor.uptimeMonitorId))) throw invalid(t);
  if (!previewMaintenance(schedule).some(occurrence => occurrence.startsAt === input.startsAt && occurrence.endsAt === input.endsAt)) throw invalid(t);
  return { id: schedule.id, startsAt: input.startsAt, endsAt: input.endsAt, timezone: schedule.timezone };
}
export async function saveAnnouncementDraft(ownerId: string, input: z.input<typeof apiAnnouncementDraft>, t: Translator) {
  const parsed = apiAnnouncementDraft.safeParse(input);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: t("validation.reviewFields"), cause: parsed.error });
  const config = parsed.data;
  return db.transaction(async tx => {
    const { selected } = await announcementContext(tx, ownerId, config.statusPageId, config.componentIds, t);
    const occurrence = await maintenanceOccurrence(tx, ownerId, selected, config.maintenance, config.timezone, t);
    if (config.previousId) {
      const [previous] = await tx.select({ id: uptimeStatusAnnouncement.id }).from(uptimeStatusAnnouncement).where(and(eq(uptimeStatusAnnouncement.id, config.previousId), eq(uptimeStatusAnnouncement.userId, ownerId), eq(uptimeStatusAnnouncement.statusPageId, config.statusPageId), isNotNull(uptimeStatusAnnouncement.publishedAt)));
      if (!previous) throw missing(t);
    }
    const fields = { title: safeFor(config.title, selected, t), text: safeFor(config.text, selected, t), stage: config.stage, componentIds: config.componentIds, timezone: config.timezone, previousId: config.previousId ?? null, maintenanceId: occurrence?.id ?? null, kind: occurrence ? "maintenance" as const : "incident" as const, startsAt: occurrence?.startsAt ?? null, endsAt: occurrence?.endsAt ?? null, updatedAt: new Date().toISOString() };
    if (config.id) {
      const [existing] = await tx.select().from(uptimeStatusAnnouncement).where(and(eq(uptimeStatusAnnouncement.id, config.id), eq(uptimeStatusAnnouncement.userId, ownerId), eq(uptimeStatusAnnouncement.statusPageId, config.statusPageId))).for("update");
      if (!existing) throw missing(t); if (existing.publishedAt) throw changed(t);
      const [saved] = await tx.update(uptimeStatusAnnouncement).set(fields).where(and(eq(uptimeStatusAnnouncement.id, config.id), eq(uptimeStatusAnnouncement.userId, ownerId))).returning(); return saved!;
    }
    const [total] = await tx.select({ value: count() }).from(uptimeStatusAnnouncement).where(and(eq(uptimeStatusAnnouncement.userId, ownerId), eq(uptimeStatusAnnouncement.statusPageId, config.statusPageId)));
    // Technical bound: 1,000 updates/page and latest 100 in management; add archive/paging before measured histories reach this bound.
    if (total!.value >= 1000) throw invalid(t);
    const [saved] = await tx.insert(uptimeStatusAnnouncement).values({ ...fields, userId: ownerId, statusPageId: config.statusPageId }).returning(); return saved!;
  });
}
export function deleteAnnouncementDraft(ownerId: string, announcementId: string, t: Translator) {
  return db.transaction(async tx => {
    const [identity] = await tx.select({ pageId: uptimeStatusAnnouncement.statusPageId }).from(uptimeStatusAnnouncement)
      .where(and(eq(uptimeStatusAnnouncement.id, announcementId), eq(uptimeStatusAnnouncement.userId, ownerId))).limit(1);
    if (!identity) throw missing(t);
    // Match save/publish lock order so a concurrent publication cannot be deleted.
    await ownedPage(tx, ownerId, identity.pageId, t, true);
    const [draft] = await tx.select().from(uptimeStatusAnnouncement)
      .where(and(eq(uptimeStatusAnnouncement.id, announcementId), eq(uptimeStatusAnnouncement.userId, ownerId), eq(uptimeStatusAnnouncement.statusPageId, identity.pageId))).for("update");
    if (!draft) throw missing(t);
    if (draft.publishedAt) throw changed(t);
    await tx.delete(uptimeStatusAnnouncement).where(and(eq(uptimeStatusAnnouncement.id, announcementId), eq(uptimeStatusAnnouncement.userId, ownerId), eq(uptimeStatusAnnouncement.statusPageId, identity.pageId), isNull(uptimeStatusAnnouncement.publishedAt)));
    return { deleted: true };
  });
}
async function announcementPreview(tx: DbExecutor, ownerId: string, announcementId: string, t: Translator) {
  const [identity] = await tx.select({ pageId: uptimeStatusAnnouncement.statusPageId }).from(uptimeStatusAnnouncement).where(and(eq(uptimeStatusAnnouncement.id, announcementId), eq(uptimeStatusAnnouncement.userId, ownerId))).limit(1); if (!identity) throw missing(t);
  await ownedPage(tx, ownerId, identity.pageId, t, true);
  const [draft] = await tx.select().from(uptimeStatusAnnouncement).where(and(eq(uptimeStatusAnnouncement.id, announcementId), eq(uptimeStatusAnnouncement.userId, ownerId), eq(uptimeStatusAnnouncement.statusPageId, identity.pageId))).for("update"); if (!draft) throw missing(t);
  const { page, selected } = await announcementContext(tx, ownerId, draft.statusPageId, draft.componentIds, t);
  if (!draft.publishedAt) {
    if (safeFor(draft.title, selected, t) !== draft.title || safeFor(draft.text, selected, t) !== draft.text) throw invalid(t);
    if (draft.kind === "maintenance") {
      if (!draft.maintenanceId || !draft.startsAt || !draft.endsAt) throw invalid(t);
      await maintenanceOccurrence(tx, ownerId, selected, { id: draft.maintenanceId, startsAt: draft.startsAt, endsAt: draft.endsAt }, draft.timezone, t);
    }
  }
  const components = selected.map(({ member, monitor }) => ({ componentId: member.id, name: member.publicName ?? monitor.name }));
  return { page: { id: page.statusPageId, title: page.title, slug: page.slug, published: page.isPublished }, announcement: toPublicAnnouncement(draft), components, revision: hash({ draft, page: { title: page.title, slug: page.slug, published: page.isPublished }, components }) };
}
export function previewAnnouncement(ownerId: string, announcementId: string, t: Translator) { return db.transaction(tx => announcementPreview(tx, ownerId, announcementId, t)); }
export function publishAnnouncement(ownerId: string, announcementId: string, revision: string, t: Translator) {
  return db.transaction(async tx => {
    const preview = await announcementPreview(tx, ownerId, announcementId, t);
    if (preview.announcement.publishedAt) return { published: true };
    if (!preview.page.published) throw invalid(t); if (revision !== preview.revision) throw changed(t);
    await tx.update(uptimeStatusAnnouncement).set({ publishedAt: new Date().toISOString() }).where(and(eq(uptimeStatusAnnouncement.id, announcementId), eq(uptimeStatusAnnouncement.userId, ownerId), eq(uptimeStatusAnnouncement.statusPageId, preview.page.id)));
    await enqueuePublishedStatusUpdate(tx, ownerId, preview.page.id, announcementId);
    return { published: true };
  });
}
export function toPublicAnnouncement(row: typeof uptimeStatusAnnouncement.$inferSelect) {
  return { id: row.id, previousId: row.previousId, title: row.title, text: row.text, stage: row.stage, componentIds: row.componentIds, timezone: row.timezone, kind: row.kind, startsAt: row.startsAt, endsAt: row.endsAt, publishedAt: row.publishedAt };
}
export async function publishedAnnouncements(ownerId: string, pageId: string) {
  const rows = await db.select().from(uptimeStatusAnnouncement).innerJoin(uptimeStatusPage, eq(uptimeStatusPage.statusPageId, uptimeStatusAnnouncement.statusPageId)).where(and(eq(uptimeStatusAnnouncement.userId, ownerId), eq(uptimeStatusPage.userId, ownerId), eq(uptimeStatusPage.statusPageId, pageId), eq(uptimeStatusPage.isPublished, true), isNotNull(uptimeStatusAnnouncement.publishedAt))).orderBy(desc(uptimeStatusAnnouncement.publishedAt), desc(uptimeStatusAnnouncement.id)).limit(100);
  return rows.map(row => toPublicAnnouncement(row.uptime_status_announcement));
}

/** Only deliberately published, still-effective schedule occurrences contribute a public overlay. */
export async function publicMaintenanceComponents(ownerId: string, pageId: string, now = new Date()) {
  const time = now.toISOString();
  const notices = await db.select({ ids: uptimeStatusAnnouncement.componentIds, startsAt: uptimeStatusAnnouncement.startsAt, endsAt: uptimeStatusAnnouncement.endsAt, schedule: uptimeMaintenance })
    .from(uptimeStatusAnnouncement)
    .innerJoin(uptimeStatusPage, eq(uptimeStatusPage.statusPageId, uptimeStatusAnnouncement.statusPageId))
    .innerJoin(uptimeMaintenance, eq(uptimeMaintenance.id, uptimeStatusAnnouncement.maintenanceId))
    .where(and(eq(uptimeStatusAnnouncement.userId, ownerId), eq(uptimeStatusPage.userId, ownerId), eq(uptimeMaintenance.userId, ownerId), eq(uptimeStatusPage.statusPageId, pageId), eq(uptimeStatusPage.isPublished, true), isNotNull(uptimeStatusAnnouncement.publishedAt), eq(uptimeStatusAnnouncement.kind, "maintenance"), eq(uptimeMaintenance.kind, "maintenance"), eq(uptimeMaintenance.enabled, true), lte(uptimeStatusAnnouncement.startsAt, time), gt(uptimeStatusAnnouncement.endsAt, time))).limit(100);
  if (!notices.length) return new Set<string>();
  const links = await members(db, ownerId, pageId); const result = new Set<string>();
  for (const notice of notices) {
    if (!previewMaintenance(notice.schedule, now).some(occurrence => occurrence.startsAt === notice.startsAt && occurrence.endsAt === notice.endsAt)) continue;
    for (const row of links) if (notice.ids.includes(row.member.id) && notice.schedule.monitorIds.includes(row.monitor.uptimeMonitorId)) result.add(row.member.id);
  }
  return result;
}

async function historyPreview(tx: DbExecutor, ownerId: string, pageId: string, enabled: boolean, t: Translator) {
  const page = await ownedPage(tx, ownerId, pageId, t, true), links = await members(tx, ownerId, pageId);
  const components = links.filter(row => row.monitor.active).map(row => ({ componentId: row.member.id, name: safeFor(row.member.publicName ?? row.monitor.name, links, t) }));
  const to = new Date(Math.floor(Date.now() / 86400000) * 86400000), from = new Date(to.getTime() - 7 * 86400000);
  const revision = hash({ enabled, from: from.toISOString(), to: to.toISOString(), page: { id: page.statusPageId, title: page.title, slug: page.slug, published: page.isPublished, historyEnabled: page.historyEnabled, customDomain: page.customDomain, domainVerified: page.domainVerified }, components });
  return { enabled, revision, page: { id: page.statusPageId, title: page.title, slug: page.slug, published: page.isPublished }, components, from: from.toISOString(), to: to.toISOString(), timezone: "UTC" as const };
}
export function previewPublicHistory(ownerId: string, pageId: string, enabled: boolean, t: Translator) { return db.transaction(tx => historyPreview(tx, ownerId, pageId, enabled, t)); }
export function applyPublicHistory(ownerId: string, pageId: string, enabled: boolean, revision: string, t: Translator) {
  return db.transaction(async tx => {
    const preview = await historyPreview(tx, ownerId, pageId, enabled, t); if (preview.revision !== revision) throw changed(t);
    await tx.update(uptimeStatusPage).set({ historyEnabled: enabled }).where(and(eq(uptimeStatusPage.userId, ownerId), eq(uptimeStatusPage.statusPageId, pageId)));
    return { enabled, published: preview.page.published };
  });
}
