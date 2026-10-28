import { createHash } from "node:crypto";
import { type DbExecutor, db, uptimeMonitor, uptimeStatusPage, uptimeStatusPageMonitor } from "@pulsy/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Translator } from "../../lib/i18n";

async function selection(tx: DbExecutor, userId: string, pageId: string, selectedIds: string[], t: Translator, lock: boolean, mode: "add" | "replace" = "add") {
  const pages = tx.select().from(uptimeStatusPage).where(and(eq(uptimeStatusPage.userId, userId), eq(uptimeStatusPage.statusPageId, pageId)));
  const [page] = await (lock ? pages.for("update") : pages);
  if (!page) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "statusPage" }) });
  // Scope a pivot through the owned parent; a pivot ID never confers authority.
  const links = await tx.select({ id: uptimeStatusPageMonitor.uptimeMonitorId, order: uptimeStatusPageMonitor.sortOrder, publicName: uptimeStatusPageMonitor.publicName }).from(uptimeStatusPageMonitor)
    .innerJoin(uptimeStatusPage, eq(uptimeStatusPage.statusPageId, uptimeStatusPageMonitor.statusPageId))
    .where(and(eq(uptimeStatusPage.userId, userId), eq(uptimeStatusPageMonitor.statusPageId, pageId))).orderBy(asc(uptimeStatusPageMonitor.sortOrder), asc(uptimeStatusPageMonitor.uptimeMonitorId));
  const ids = [...new Set(selectedIds)]; const allIds = [...new Set([...links.map(link => link.id), ...ids])];
  const query = tx.select({ id: uptimeMonitor.uptimeMonitorId, name: uptimeMonitor.name }).from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, userId), inArray(uptimeMonitor.uptimeMonitorId, allIds)));
  const monitors = allIds.length ? await (lock ? query.for("share") : query) : [];
  if (monitors.length !== allIds.length) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });
  const names = new Map(monitors.map(monitor => [monitor.id, monitor.name]));
  const existing = new Set(links.map(link => link.id));
  const disclosure = ids.map(id => ({ id, publicName: links.find(link => link.id === id)?.publicName ?? names.get(id)! }));
  // Revision includes every disclosed name and publication state, not check samples.
  const revision = createHash("sha256").update(JSON.stringify({ mode, pageId, title: page.title, slug: page.slug, published: page.isPublished, links, disclosure })).digest("hex");
  return { statusPageId: pageId, title: page.title, slug: page.slug, isPublished: page.isPublished, currentCount: links.length, resultingCount: mode === "replace" ? ids.length : allIds.length,
    removed: mode === "replace" ? links.filter(link => !ids.includes(link.id)).map(link => ({ id: link.id, publicName: link.publicName ?? names.get(link.id)! })) : [],
    // Replacement persists the submitted order, including retained components
    // and a deselected/reselected component appended by the editor.
    components: disclosure,
    added: disclosure.filter(monitor => !existing.has(monitor.id)), alreadySelected: disclosure.filter(monitor => existing.has(monitor.id)), revision };
}
export function previewPageSelection(userId: string, pageId: string, ids: string[], t: Translator) {
  // One transaction gives a consistent selection snapshot, with no writes.
  return db.transaction(tx => selection(tx, userId, pageId, ids, t, true));
}
export function applyPageSelection(userId: string, pageId: string, ids: string[], revision: string, t: Translator) {
  return db.transaction(async tx => {
    const preview = await selection(tx, userId, pageId, ids, t, true);
    if (preview.revision !== revision) throw new TRPCError({ code: "CONFLICT", message: t("errors.pageSelectionChanged") });
    if (preview.added.length) await tx.insert(uptimeStatusPageMonitor).values(preview.added.map((monitor, index) => ({ statusPageId: pageId, uptimeMonitorId: monitor.id, sortOrder: preview.currentCount + index })));
    return { count: preview.resultingCount, added: preview.added.length, isPublished: preview.isPublished };
  });
}
export async function replacePageSelectionInTransaction(tx: DbExecutor, userId: string, pageId: string, ids: string[], t: Translator, revision?: string) {
    if (revision) {
      const preview = await selection(tx, userId, pageId, ids, t, true, "replace");
      if (preview.revision !== revision) throw new TRPCError({ code: "CONFLICT", message: t("errors.pageSelectionChanged") });
    }
    const [page] = await tx.select({ id: uptimeStatusPage.statusPageId }).from(uptimeStatusPage).where(and(eq(uptimeStatusPage.userId, userId), eq(uptimeStatusPage.statusPageId, pageId))).for("update");
    if (!page) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "statusPage" }) });
    const unique = [...new Set(ids)];
    if (unique.length) {
      const owned = await tx.select({ id: uptimeMonitor.uptimeMonitorId }).from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, userId), inArray(uptimeMonitor.uptimeMonitorId, unique))).for("share");
      if (owned.length !== unique.length) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });
    }
    const existing = await tx.select({ id: uptimeStatusPageMonitor.id, monitorId: uptimeStatusPageMonitor.uptimeMonitorId }).from(uptimeStatusPageMonitor).where(eq(uptimeStatusPageMonitor.statusPageId, page.id));
    const removed = existing.filter(member => !unique.includes(member.monitorId));
    if (removed.length) await tx.delete(uptimeStatusPageMonitor).where(and(eq(uptimeStatusPageMonitor.statusPageId, page.id), inArray(uptimeStatusPageMonitor.id, removed.map(member => member.id))));
    for (const [index, monitorId] of unique.entries()) {
      const retained = existing.find(member => member.monitorId === monitorId);
      if (retained) await tx.update(uptimeStatusPageMonitor).set({ sortOrder: index }).where(and(eq(uptimeStatusPageMonitor.statusPageId, page.id), eq(uptimeStatusPageMonitor.id, retained.id)));
      else await tx.insert(uptimeStatusPageMonitor).values({ statusPageId: page.id, uptimeMonitorId: monitorId, sortOrder: index });
    }
    return { success: true, count: unique.length };
}

export function replacePageSelection(userId: string, pageId: string, ids: string[], t: Translator, revision?: string) {
  return db.transaction(tx => replacePageSelectionInTransaction(tx, userId, pageId, ids, t, revision));
}

export function previewPageReplacement(userId: string, pageId: string, ids: string[], t: Translator) {
  return db.transaction(tx => selection(tx, userId, pageId, ids, t, true, "replace"));
}
