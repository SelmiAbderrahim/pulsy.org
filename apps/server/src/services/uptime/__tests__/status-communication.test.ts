import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeStatusPage, uptimeStatusPageMonitor, uptimeStatusAnnouncement, uptimeMaintenance, uptimeMonitor } from "@pulsy/db";
import { createTestUser, createTestMonitor, useCleanDatabase } from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
import { and, eq } from "drizzle-orm";
import { getTranslator } from "../../../lib/i18n";
import { previewPublicComponents, applyPublicComponents, saveAnnouncementDraft, previewAnnouncement, publishAnnouncement, readPageCommunication } from "../status-communication";
useCleanDatabase(); afterEach(() => vi.useRealTimers()); const t = getTranslator("en");
async function fixture() {
  const owner = await createTestUser(); const other = await createTestUser(); const monitor = await createTestMonitor(owner.id, { name: "Private deployment API", status: "up" });
  const [page] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "components", title: "Customer status", isPublished: true }).returning();
  const [member] = await db.insert(uptimeStatusPageMonitor).values({ statusPageId: page!.statusPageId, uptimeMonitorId: monitor.uptimeMonitorId }).returning();
  return { owner, other, monitor, page: page!, member: member! };
}
describe("explicit public communication", () => {
  it("restricts draft read/edit/delete to its owner, validates deletion, and preserves published updates", async () => {
    const fx = await fixture();
    const input = { statusPageId: fx.page.statusPageId, title: "Private issue", text: "Investigating", stage: "investigating" as const, componentIds: [fx.member.id], timezone: "US/Eastern" };
    const owner = authedCaller(fx.owner).uptimeMonitor.statusPage.communication;
    const other = authedCaller(fx.other).uptimeMonitor.statusPage.communication;
    const draft = await owner.draft(input);
    expect((await owner.one({ statusPageId: input.statusPageId })).announcements[0]?.timezone).toBe("US/Eastern");
    await expect(other.one({ statusPageId: input.statusPageId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.preview({ id: draft.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.draft({ ...input, id: draft.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.deleteDraft({ id: draft.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(publicCaller().uptimeMonitor.statusPage.communication.deleteDraft({ id: draft.id })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(owner.deleteDraft({ id: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const published = await owner.draft({ ...input, title: "Published notice" });
    await owner.publish({ id: published.id, revision: (await owner.preview({ id: published.id })).revision });
    await expect(owner.deleteDraft({ id: published.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await owner.deleteDraft({ id: draft.id })).toEqual({ deleted: true });
    await expect(owner.preview({ id: draft.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const view = await publicCaller().uptimeMonitor.public.statusPageBySlug({ userId: fx.owner.id, slug: fx.page.slug });
    expect(view.announcements.map(row => row.id)).toEqual([published.id]);
    expect(JSON.stringify(view)).not.toContain("Private issue");
  });
  it("accepts body-based previews without writes and preserves the older query and owner boundary", async () => {
    const fx = await fixture();
    const input = { statusPageId: fx.page.statusPageId, components: [{ componentId: fx.member.id, name: "Public API", description: "Preview only", group: "Production" }] };
    const before = await readPageCommunication(fx.owner.id, fx.page.statusPageId, t);
    const routes = authedCaller(fx.owner).uptimeMonitor.statusPage.communication;
    expect(await routes.componentsPreviewPost(input)).toEqual(await routes.componentsPreview(input));
    expect(await readPageCommunication(fx.owner.id, fx.page.statusPageId, t)).toEqual(before);
    await expect(authedCaller(fx.other).uptimeMonitor.statusPage.communication.componentsPreviewPost(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("shows public maintenance only for the explicitly published still-effective owned occurrence and keeps raw health", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); const now = Date.now(); const fx = await fixture();
    await db.update(uptimeMonitor).set({ status: "down" }).where(eq(uptimeMonitor.uptimeMonitorId, fx.monitor.uptimeMonitorId));
    const [schedule] = await db.insert(uptimeMaintenance).values({ userId: fx.owner.id, monitorIds: [fx.monitor.uptimeMonitorId], kind: "maintenance", name: "Private deployment", reason: "never disclose internal reason", startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 1_800_000).toISOString(), timezone: "Europe/Berlin", recurrence: "once" }).returning();
    const input = { statusPageId: fx.page.statusPageId, title: "Scheduled deployment", text: "Customer notice", stage: "monitoring" as const, componentIds: [fx.member.id], timezone: "Europe/Berlin", maintenance: { id: schedule!.id, startsAt: schedule!.startsAt, endsAt: schedule!.endsAt } };
    const caller = authedCaller(fx.owner); const draft = await saveAnnouncementDraft(fx.owner.id, input, t);
    expect((await caller.uptimeMonitor.public.statusPageBySlug({ userId: fx.owner.id, slug: fx.page.slug })).monitors[0]).toMatchObject({ maintenance: false, status: "down" });
    await publishAnnouncement(fx.owner.id, draft.id, (await previewAnnouncement(fx.owner.id, draft.id, t)).revision, t);
    const view = await caller.uptimeMonitor.public.statusPageBySlug({ userId: fx.owner.id, slug: fx.page.slug });
    expect(view.monitors[0]).toMatchObject({ maintenance: true, status: "down" }); expect(JSON.stringify(view)).not.toContain(schedule!.reason);
    await db.update(uptimeMaintenance).set({ enabled: false }).where(and(eq(uptimeMaintenance.userId, fx.owner.id), eq(uptimeMaintenance.id, schedule!.id)));
    expect((await caller.uptimeMonitor.public.statusPageBySlug({ userId: fx.owner.id, slug: fx.page.slug })).monitors[0]).toMatchObject({ maintenance: false, status: "down" });
    const otherDraft = await saveAnnouncementDraft(fx.owner.id, { ...input, maintenance: undefined }, t);
    await expect(saveAnnouncementDraft(fx.owner.id, { ...input, id: otherDraft.id }, t)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not publish a concurrent unpreviewed draft edit while waiting for the owned page lock", async () => {
    const fx = await fixture(); const draft = await saveAnnouncementDraft(fx.owner.id, { statusPageId: fx.page.statusPageId, title: "API issue", text: "Approved preview", stage: "investigating", componentIds: [fx.member.id] }, t);
    const preview = await previewAnnouncement(fx.owner.id, draft.id, t);
    let release!: () => void; let ready!: () => void; const held = new Promise<void>(resolve => { ready = resolve; }); const go = new Promise<void>(resolve => { release = resolve; });
    const editor = db.transaction(async tx => {
      await tx.select().from(uptimeStatusPage).where(and(eq(uptimeStatusPage.userId, fx.owner.id), eq(uptimeStatusPage.statusPageId, fx.page.statusPageId))).for("update"); ready(); await go;
      await tx.update(uptimeStatusAnnouncement).set({ text: "Concurrent unapproved text" }).where(and(eq(uptimeStatusAnnouncement.userId, fx.owner.id), eq(uptimeStatusAnnouncement.id, draft.id)));
    });
    await held; const publication = publishAnnouncement(fx.owner.id, draft.id, preview.revision, t);
    await new Promise(resolve => setTimeout(resolve, 100)); release(); await editor;
    await expect(publication).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await readPageCommunication(fx.owner.id, fx.page.statusPageId, t)).announcements[0]?.publishedAt).toBeNull();
  });
  it("publishes chosen component identity while preserving private names, membership and health", async () => {
    const fx = await fixture(); const draft = [{ componentId: fx.member.id, name: "Public API", description: "Customer requests", group: "Production" }];
    const preview = await previewPublicComponents(fx.owner.id, fx.page.statusPageId, draft, t);
    expect((await authedCaller(fx.owner).uptimeMonitor.public.statusPageBySlug({ userId: fx.owner.id, slug: fx.page.slug })).monitors[0]?.name).toBe("Private deployment API");
    await applyPublicComponents(fx.owner.id, fx.page.statusPageId, draft, preview.revision, t);
    const view = await authedCaller(fx.owner).uptimeMonitor.public.statusPageBySlug({ userId: fx.owner.id, slug: fx.page.slug });
    expect(view.monitors[0]).toMatchObject({ name: "Public API", description: "Customer requests", group: "Production", componentId: fx.member.id, status: "up" });
    expect(JSON.stringify(view)).not.toContain("Private deployment API"); expect(JSON.stringify(view)).not.toContain(fx.monitor.url);
    await authedCaller(fx.owner).uptimeMonitor.statusPage.setMonitors({ statusPageId: fx.page.statusPageId, uptimeMonitorIds: [fx.monitor.uptimeMonitorId] });
    expect((await readPageCommunication(fx.owner.id, fx.page.statusPageId, t)).components[0]?.componentId).toBe(fx.member.id);
  });
  it("keeps drafts private and publishes only an explicitly previewed immutable announcement", async () => {
    const fx = await fixture(); const draft = await saveAnnouncementDraft(fx.owner.id, { statusPageId: fx.page.statusPageId, title: "API issue", text: "Investigating\n<script>not executed</script>", stage: "investigating", componentIds: [fx.member.id], timezone: "Europe/Berlin" }, t);
    expect((await authedCaller(fx.owner).uptimeMonitor.public.statusPageBySlug({ userId: fx.owner.id, slug: fx.page.slug })).announcements).toEqual([]);
    const preview = await previewAnnouncement(fx.owner.id, draft.id, t);
    await expect(publishAnnouncement(fx.other.id, draft.id, preview.revision, t)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await publishAnnouncement(fx.owner.id, draft.id, preview.revision, t);
    const view = await authedCaller(fx.owner).uptimeMonitor.public.statusPageBySlug({ userId: fx.owner.id, slug: fx.page.slug });
    expect(view.announcements).toHaveLength(1); expect(view.announcements[0]).toMatchObject({ title: "API issue", stage: "investigating", componentIds: [fx.member.id] });
    await expect(saveAnnouncementDraft(fx.owner.id, { id: draft.id, statusPageId: fx.page.statusPageId, title: "Silent edit", text: "Changed", stage: "resolved", componentIds: [fx.member.id], timezone: "UTC" }, t)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects foreign components and stale previews without changing publication", async () => {
    const fx = await fixture(); const draft = [{ componentId: fx.member.id, name: "Public API", description: "", group: "" }];
    const preview = await previewPublicComponents(fx.owner.id, fx.page.statusPageId, draft, t);
    await expect(applyPublicComponents(fx.other.id, fx.page.statusPageId, draft, preview.revision, t)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(previewPublicComponents(fx.owner.id, fx.page.statusPageId, [{ ...draft[0]!, componentId: "foreign" }], t)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await applyPublicComponents(fx.owner.id, fx.page.statusPageId, draft, preview.revision, t);
    await expect(applyPublicComponents(fx.owner.id, fx.page.statusPageId, [{ ...draft[0]!, name: "Changed" }], preview.revision, t)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
