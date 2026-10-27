import { describe, expect, it } from "vitest";
import { db, uptimeStatusPage, uptimeStatusPageMonitor } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { createTestUser, createTestMonitor, useCleanDatabase } from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
useCleanDatabase();
describe("explicit public history disclosure", () => {
  it("previews exact public components without enabling, rejects stale and foreign actions, and requires explicit apply", async () => {
    const owner = await createTestUser(), other = await createTestUser(), monitor = await createTestMonitor(owner.id, { active: true });
    const [page] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "history-opt-in", title: "Customer", isPublished: true }).returning();
    await db.insert(uptimeStatusPageMonitor).values({ statusPageId: page!.statusPageId, uptimeMonitorId: monitor.uptimeMonitorId, publicName: "Public API" });
    const caller = authedCaller(owner);
    const preview = await caller.uptimeMonitor.statusPage.communication.historyPreview({ statusPageId: page!.statusPageId, enabled: true }); expect(preview.components.map(component => component.name)).toEqual(["Public API"]); expect(preview.page.published).toBe(true);
    expect((await db.select().from(uptimeStatusPage).where(eq(uptimeStatusPage.statusPageId, page!.statusPageId)))[0]!.historyEnabled).toBe(false);
    await expect(authedCaller(other).uptimeMonitor.statusPage.communication.historyPreview({ statusPageId: page!.statusPageId, enabled: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(publicCaller().uptimeMonitor.statusPage.communication.historyPreview({ statusPageId: page!.statusPageId, enabled: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await db.update(uptimeStatusPage).set({ title: "Changed" }).where(eq(uptimeStatusPage.statusPageId, page!.statusPageId));
    await expect(caller.uptimeMonitor.statusPage.communication.historyApply({ statusPageId: page!.statusPageId, enabled: true, revision: preview.revision })).rejects.toMatchObject({ code: "CONFLICT" });
    const latest = await caller.uptimeMonitor.statusPage.communication.historyPreview({ statusPageId: page!.statusPageId, enabled: true }); await caller.uptimeMonitor.statusPage.communication.historyApply({ statusPageId: page!.statusPageId, enabled: true, revision: latest.revision });
    expect((await db.select().from(uptimeStatusPage).where(eq(uptimeStatusPage.statusPageId, page!.statusPageId)))[0]!.historyEnabled).toBe(true);
    const off = await caller.uptimeMonitor.statusPage.communication.historyPreview({ statusPageId: page!.statusPageId, enabled: false }); await caller.uptimeMonitor.statusPage.communication.historyApply({ statusPageId: page!.statusPageId, enabled: false, revision: off.revision });
    expect((await db.select().from(uptimeStatusPage).where(eq(uptimeStatusPage.statusPageId, page!.statusPageId)))[0]!.historyEnabled).toBe(false);
  });
});
