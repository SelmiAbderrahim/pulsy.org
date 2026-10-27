import { db, uptimeMonitor, uptimeStatusPage, uptimeStatusPageMonitor } from "@pulsy/db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestUser, createTestMonitor, createTestStatusPage, useCleanDatabase } from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
useCleanDatabase();
describe("explicit add-selected page preview", () => {
  it("previews exact owned names without writes, then adds idempotently without publishing", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const one = await createTestMonitor(owner.id, { name: "Private health" }); const two = await createTestMonitor(owner.id, { name: "API" });
    const page = await createTestStatusPage(owner.id, { isPublished: false });
    await caller.uptimeMonitor.statusPage.setMonitors({ statusPageId: page.statusPageId, uptimeMonitorIds: [one.uptimeMonitorId] });
    const input = { statusPageId: page.statusPageId, monitorIds: [one.uptimeMonitorId, two.uptimeMonitorId, two.uptimeMonitorId] };
    const preview = await caller.uptimeMonitor.statusPage.addSelectionPreview(input);
    expect(preview).toMatchObject({ isPublished: false, currentCount: 1, resultingCount: 2, added: [{ id: two.uptimeMonitorId, publicName: "API" }], alreadySelected: [{ id: one.uptimeMonitorId, publicName: "Private health" }] });
    expect(JSON.stringify(preview)).not.toMatch(/https?:|requestCipher|userId/);
    expect((await caller.uptimeMonitor.statusPage.one({ statusPageId: page.statusPageId })).monitorIds).toEqual([one.uptimeMonitorId]);
    await caller.uptimeMonitor.statusPage.addSelectionApply({ ...input, revision: preview.revision });
    const next = await caller.uptimeMonitor.statusPage.addSelectionPreview(input);
    expect(next.added).toEqual([]);
    await caller.uptimeMonitor.statusPage.addSelectionApply({ ...input, revision: next.revision });
    expect(await caller.uptimeMonitor.statusPage.one({ statusPageId: page.statusPageId })).toMatchObject({ isPublished: false, monitorIds: [one.uptimeMonitorId, two.uptimeMonitorId] });
    expect(await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: two.uptimeMonitorId })).toMatchObject({ isPublic: false });
  });
  it("rejects foreign pages/monitors and never trusts an account-external ID", async () => {
    const owner = await createTestUser(); const other = await createTestUser(); const caller = authedCaller(owner);
    const page = await createTestStatusPage(owner.id); const foreignPage = await createTestStatusPage(other.id); const foreign = await createTestMonitor(other.id);
    await expect(caller.uptimeMonitor.statusPage.addSelectionPreview({ statusPageId: foreignPage.statusPageId, monitorIds: [foreign.uptimeMonitorId] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.uptimeMonitor.statusPage.addSelectionPreview({ statusPageId: page.statusPageId, monitorIds: [foreign.uptimeMonitorId] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.uptimeMonitor.statusPage.addSelectionApply({ statusPageId: page.statusPageId, monitorIds: [foreign.uptimeMonitorId], revision: "0".repeat(64) })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rejects stale membership, publication and disclosed-name previews with zero writes", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner); const monitor = await createTestMonitor(owner.id); const page = await createTestStatusPage(owner.id, { isPublished: false });
    const input = { statusPageId: page.statusPageId, monitorIds: [monitor.uptimeMonitorId] };
    const preview = await caller.uptimeMonitor.statusPage.addSelectionPreview(input);
    await db.update(uptimeStatusPage).set({ isPublished: true }).where(and(eq(uptimeStatusPage.userId, owner.id), eq(uptimeStatusPage.statusPageId, page.statusPageId)));
    await expect(caller.uptimeMonitor.statusPage.addSelectionApply({ ...input, revision: preview.revision })).rejects.toMatchObject({ code: "CONFLICT" });
    const renamed = await caller.uptimeMonitor.statusPage.addSelectionPreview(input);
    await db.update(uptimeMonitor).set({ name: "Changed disclosure" }).where(eq(uptimeMonitor.userId, owner.id));
    await expect(caller.uptimeMonitor.statusPage.addSelectionApply({ ...input, revision: renamed.revision })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.select().from(uptimeStatusPageMonitor).where(eq(uptimeStatusPageMonitor.statusPageId, page.statusPageId))).toEqual([]);
  });
  it("serializes competing add previews and preserves the successful explicit set", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner); const page = await createTestStatusPage(owner.id, { isPublished: true }); const one = await createTestMonitor(owner.id); const two = await createTestMonitor(owner.id);
    const inputs = [one, two].map(monitor => ({ statusPageId: page.statusPageId, monitorIds: [monitor.uptimeMonitorId] }));
    const previews = await Promise.all(inputs.map(input => caller.uptimeMonitor.statusPage.addSelectionPreview(input)));
    const results = await Promise.allSettled(inputs.map((input, i) => caller.uptimeMonitor.statusPage.addSelectionApply({ ...input, revision: previews[i]!.revision })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await caller.uptimeMonitor.statusPage.one({ statusPageId: page.statusPageId })).monitorIds).toHaveLength(1);
  });
  it("adds past 100 components without a page-monitor count limit", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner); const page = await createTestStatusPage(owner.id); const monitors = await Promise.all(Array.from({ length: 101 }, () => createTestMonitor(owner.id)));
    await caller.uptimeMonitor.statusPage.setMonitors({ statusPageId: page.statusPageId, uptimeMonitorIds: monitors.slice(0,100).map(m => m.uptimeMonitorId) });
    const input = { statusPageId: page.statusPageId, monitorIds: [monitors[100]!.uptimeMonitorId] };
    const preview = await caller.uptimeMonitor.statusPage.addSelectionPreview(input);
    await caller.uptimeMonitor.statusPage.addSelectionApply({ ...input, revision: preview.revision });
    expect((await caller.uptimeMonitor.statusPage.one({ statusPageId: page.statusPageId })).monitorIds).toHaveLength(101);
  });
});

describe("reviewed replacement and page settings", () => {
 it("rejects concurrent membership/name/publication changes and preserves retained public metadata", async () => {
  const owner = await createTestUser(), caller = authedCaller(owner);
  const page = await createTestStatusPage(owner.id, { isPublished: true });
  const one = await createTestMonitor(owner.id, { name: "First" }), two = await createTestMonitor(owner.id, { name: "Second" });
  const identity = { statusPageId: page.statusPageId };
  await caller.uptimeMonitor.statusPage.setMonitors({ ...identity, uptimeMonitorIds: [one.uptimeMonitorId] });
  await db.update(uptimeStatusPageMonitor).set({ publicName: "Public first", publicDescription: "Retain this" }).where(eq(uptimeStatusPageMonitor.statusPageId, page.statusPageId));
  const input = { ...identity, uptimeMonitorIds: [two.uptimeMonitorId] };
  const preview = await caller.uptimeMonitor.statusPage.setMonitorsPreview(input);
  expect(preview).toMatchObject({ resultingCount: 1, added: [{ id: two.uptimeMonitorId, publicName: "Second" }], removed: [{ id: one.uptimeMonitorId, publicName: "Public first" }] });
  await db.update(uptimeMonitor).set({ name: "Renamed" }).where(and(eq(uptimeMonitor.userId, owner.id), eq(uptimeMonitor.uptimeMonitorId, two.uptimeMonitorId)));
  await expect(caller.uptimeMonitor.statusPage.setMonitors({ ...input, revision: preview.revision })).rejects.toMatchObject({ code: "CONFLICT" });
  const finalInput = { ...identity, uptimeMonitorIds: [one.uptimeMonitorId, two.uptimeMonitorId] };
  const current = await caller.uptimeMonitor.statusPage.setMonitorsPreview(finalInput);
  await caller.uptimeMonitor.statusPage.setMonitors({ ...finalInput, revision: current.revision });
  expect((await db.select().from(uptimeStatusPageMonitor).where(eq(uptimeStatusPageMonitor.uptimeMonitorId, one.uptimeMonitorId)))[0]).toMatchObject({ publicName: "Public first", publicDescription: "Retain this" });
  const empty = await caller.uptimeMonitor.statusPage.setMonitorsPreview({ ...identity, uptimeMonitorIds: [] });
  await caller.uptimeMonitor.statusPage.update({ ...identity, isPublished: false });
  await expect(caller.uptimeMonitor.statusPage.setMonitors({ ...identity, uptimeMonitorIds: [], revision: empty.revision })).rejects.toMatchObject({ code: "CONFLICT" });
 });
 it("serializes page drafts and prevents a stale save from overwriting another editor", async () => {
  const owner = await createTestUser(), other = await createTestUser(), caller = authedCaller(owner);
  const page = await createTestStatusPage(owner.id);
  const expected = { title: page.title, slug: page.slug, description: page.description, isPublished: page.isPublished };
  const input = { statusPageId: page.statusPageId, expected };
  await expect(authedCaller(other).uptimeMonitor.statusPage.update({ ...input, title: "Foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  const results = await Promise.allSettled([caller.uptimeMonitor.statusPage.update({ ...input, title: "First editor" }), caller.uptimeMonitor.statusPage.update({ ...input, title: "Second editor" })]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
 });
});

describe("atomic status-page creation", () => {
 it("never leaves a published partial page when membership validation fails", async () => {
  const owner = await createTestUser(), foreign = await createTestUser(), caller = authedCaller(owner);
  const monitor = await createTestMonitor(owner.id), other = await createTestMonitor(foreign.id);
  const draft = { slug: "atomic-page", title: "Atomic page", isPublished: true };
  await expect(caller.uptimeMonitor.statusPage.create({ ...draft, uptimeMonitorIds: [monitor.uptimeMonitorId, other.uptimeMonitorId] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.select().from(uptimeStatusPage).where(and(eq(uptimeStatusPage.userId, owner.id), eq(uptimeStatusPage.slug, draft.slug)))).toHaveLength(0);
  const created = await caller.uptimeMonitor.statusPage.create({ ...draft, uptimeMonitorIds: [monitor.uptimeMonitorId] });
  expect(await caller.uptimeMonitor.statusPage.one({ statusPageId: created.statusPageId })).toMatchObject({ isPublished: true, monitorIds: [monitor.uptimeMonitorId] });
 });
});

it("keeps replacement preview, apply, reload and manual reordering in the same order", async () => {
  const owner = await createTestUser(), caller = authedCaller(owner);
  const page = await createTestStatusPage(owner.id, { isPublished: true });
  const http = await createTestMonitor(owner.id, { name: "HTTP" }), dns = await createTestMonitor(owner.id, { name: "DNS" });
  const identity = { statusPageId: page.statusPageId };
  await caller.uptimeMonitor.statusPage.setMonitors({ ...identity, uptimeMonitorIds: [http.uptimeMonitorId] });
  const input = { ...identity, uptimeMonitorIds: [http.uptimeMonitorId, dns.uptimeMonitorId] };
  const preview = await caller.uptimeMonitor.statusPage.setMonitorsPreview(input);
  expect(preview.components.map(row => row.publicName)).toEqual(["HTTP", "DNS"]);
  await caller.uptimeMonitor.statusPage.setMonitors({ ...input, revision: preview.revision });
  expect((await caller.uptimeMonitor.statusPage.one(identity)).monitorIds).toEqual(input.uptimeMonitorIds);
  expect((await caller.uptimeMonitor.public.statusPageBySlug({ userId: owner.id, slug: page.slug })).monitors.map(row => row.name)).toEqual(["HTTP", "DNS"]);
  const communication = caller.uptimeMonitor.statusPage.communication;
  const rows = (await communication.one(identity)).components.slice().reverse().map(row => ({ componentId: row.componentId, name: row.name, description: row.description, group: row.group }));
  const reordered = await communication.componentsPreview({ ...identity, components: rows });
  await communication.componentsApply({ ...identity, components: rows, revision: reordered.revision });
  expect((await communication.one(identity)).components.map(row => row.name)).toEqual(["DNS", "HTTP"]);
  expect((await caller.uptimeMonitor.statusPage.one(identity)).monitorIds).toEqual([dns.uptimeMonitorId, http.uptimeMonitorId]);
  // Retain the configured order while adding another selection, even if its
  // private name sorts first. Deselect/reselect HTTP explicitly moves it last.
  const added = await createTestMonitor(owner.id, { name: "AAA" });
  const selected = [dns.uptimeMonitorId, added.uptimeMonitorId, http.uptimeMonitorId];
  const replacement = await caller.uptimeMonitor.statusPage.setMonitorsPreview({ ...identity, uptimeMonitorIds: selected });
  expect(replacement.components.map(row => row.id)).toEqual(selected);
  await caller.uptimeMonitor.statusPage.setMonitors({ ...identity, uptimeMonitorIds: selected, revision: replacement.revision });
  expect((await caller.uptimeMonitor.statusPage.one(identity)).monitorIds).toEqual(selected);
});

it("returns the same not-found error for private and missing named pages without draft data", async () => {
  const owner = await createTestUser(), caller = publicCaller();
  const page = await createTestStatusPage(owner.id, { slug: "private-page", title: "Private title", description: "Private description", isPublished: false });
  for (const slug of [page.slug, "nonexistent"]) {
    await expect(caller.uptimeMonitor.public.statusPageBySlug({ userId: owner.id, slug })).rejects.toMatchObject({ code: "NOT_FOUND" });
    try { await caller.uptimeMonitor.public.statusPageBySlug({ userId: owner.id, slug }); }
    catch (error) { expect(JSON.stringify(error)).not.toMatch(/Private title|Private description/); }
  }
});

it("duplicates every component as a draft with no shared custom domain or publication", async () => {
  const owner = await createTestUser(); const caller = authedCaller(owner);
  const page = await createTestStatusPage(owner.id, { isPublished: true, customDomain: "status.example.invalid", domainVerified: true, historyEnabled: true });
  const monitors = await db.insert(uptimeMonitor).values(Array.from({ length: 101 }, (_, index) => ({ userId: owner.id, name: `Private ${index}`, url: `https://fixture.invalid/${index}` }))).returning();
  const input = { statusPageId: page.statusPageId, monitorIds: monitors.map(monitor => monitor.uptimeMonitorId) };
  const preview = await caller.uptimeMonitor.statusPage.addSelectionPreview(input);
  await caller.uptimeMonitor.statusPage.addSelectionApply({ ...input, revision: preview.revision });
  const copy = await caller.uptimeMonitor.statusPage.duplicate({ statusPageId: page.statusPageId, title: "Draft copy" });
  const details = await caller.uptimeMonitor.statusPage.one({ statusPageId: copy.statusPageId });
  expect(details).toMatchObject({ isPublished: false, customDomain: null, domainVerified: false, historyEnabled: true });
  expect(details.monitorIds).toHaveLength(101);
  const components = (await caller.uptimeMonitor.statusPage.communication.one({ statusPageId: copy.statusPageId })).components;
  expect(components).toHaveLength(101);
  const history = await caller.uptimeMonitor.statusPage.communication.historyPreview({ statusPageId: copy.statusPageId, enabled: true });
  expect(history.components).toHaveLength(101);
});


it("offers a protected POST replacement preview with the same revision and ownership checks as GET", async () => {
 const owner = await createTestUser(), other = await createTestUser(), caller = authedCaller(owner);
 const page = await createTestStatusPage(owner.id), monitor = await createTestMonitor(owner.id), foreign = await createTestMonitor(other.id);
 const input = { statusPageId: page.statusPageId, uptimeMonitorIds: [monitor.uptimeMonitorId] };
 const preview = await caller.uptimeMonitor.statusPage.setMonitorsPreviewPost(input);
 expect(preview).toEqual(await caller.uptimeMonitor.statusPage.setMonitorsPreview(input));
 expect((await caller.uptimeMonitor.statusPage.one({ statusPageId: page.statusPageId })).monitorIds).toEqual([]);
 await expect(authedCaller(other).uptimeMonitor.statusPage.setMonitorsPreviewPost(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
 await expect(caller.uptimeMonitor.statusPage.setMonitorsPreviewPost({ ...input, uptimeMonitorIds: [foreign.uptimeMonitorId] })).rejects.toMatchObject({ code: "NOT_FOUND" });
 await expect(publicCaller().uptimeMonitor.statusPage.setMonitorsPreviewPost(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
