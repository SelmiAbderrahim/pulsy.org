import { describe, expect, it } from "vitest";
import { db, uptimeIncident, uptimeNotificationChannel } from "@pulsy/db";
import { createTestMonitor, createTestStatusPage, createTestStatusPageMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
useCleanDatabase();
describe("protected personal incident response", () => {
  it("paginates owned channel choices with safe summaries and filters inconsistent foreign bindings", async () => {
    const owner = await createTestUser(); const other = await createTestUser(); const monitor = await createTestMonitor(owner.id); const foreign = await createTestMonitor(other.id);
    await db.insert(uptimeNotificationChannel).values(Array.from({ length: 51 }, (_, index) => ({ userId: owner.id, uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook" as const, webhookUrl: `https://fixtures.invalid/path-secret-${index}?token=fixture-secret`, webhookHeaders: { Authorization: "Bearer fixture-secret" } })));
    await db.insert(uptimeNotificationChannel).values({ userId: owner.id, uptimeMonitorId: foreign.uptimeMonitorId, channelType: "webhook", webhookUrl: "https://foreign.invalid/private" });
    const caller = authedCaller(owner); const page = await caller.uptimeMonitor.incidentWorkspace.channels({}); const next = await caller.uptimeMonitor.incidentWorkspace.channels({ cursor: page.nextCursor! });
    expect(page.items).toHaveLength(50); expect(next.items).toHaveLength(1); expect(new Set([...page.items, ...next.items].map(item => item.id)).size).toBe(51);
    expect(JSON.stringify(page)).not.toMatch(/path-secret|fixture-secret|Authorization|foreign.invalid/);
    expect((await authedCaller(other).uptimeMonitor.incidentWorkspace.channels({})).items).toEqual([]);
  });
  it("rejects single-incident and duplicate response groups at the input boundary", async () => {
    const caller = authedCaller(await createTestUser());
    for (const incidentIds of [["one"], ["one", "one"]]) {
      await expect(caller.uptimeMonitor.incidentWorkspace.group({ name: "Response", incidentIds })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
  it("offers core response on an owner session and rejects foreign or invented authority", async () => {
    const owner = await createTestUser(); const other = await createTestUser(); const monitor = await createTestMonitor(owner.id, { status: "down" });
    const [incident] = await db.insert(uptimeIncident).values({ uptimeMonitorId: monitor.uptimeMonitorId, severity: "critical" }).returning();
    const input = { incidentId: incident!.incidentId };
    await expect(publicCaller().uptimeMonitor.incidentWorkspace.one(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(authedCaller(other).uptimeMonitor.incidentWorkspace.acknowledge(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authedCaller(other).uptimeMonitor.incidentWorkspace.note({ ...input, text: "Private" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await authedCaller(other).uptimeMonitor.incidentWorkspace.list({ state: "all" })).items).toEqual([]);
    await expect(authedCaller(owner).uptimeMonitor.incidentWorkspace.list({ state: "all", limit: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const caller = authedCaller(owner); await caller.uptimeMonitor.incidentWorkspace.acknowledge(input); await caller.uptimeMonitor.incidentWorkspace.note({ ...input, text: "Looking at the deploy" });
    expect((await caller.uptimeMonitor.incidentWorkspace.one(input)).response.acknowledgedBy).toBe(owner.id);
    expect((await caller.uptimeMonitor.incidentWorkspace.list({ state: "acknowledged", severity: "critical" })).items).toHaveLength(1);
    expect((await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: monitor.uptimeMonitorId })).status).toBe("down");
  });
});

describe("private response data stays private", () => {
  it("never reaches the public status page, however the incident is acknowledged, noted, or given a runbook", async () => {
    const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { name: "Public API", status: "down" });
    const page = await createTestStatusPage(owner.id, { slug: "public", title: "Public", isPublished: true });
    await createTestStatusPageMonitor(page.statusPageId, monitor.uptimeMonitorId);
    const [incident] = await db.insert(uptimeIncident).values({ uptimeMonitorId: monitor.uptimeMonitorId, severity: "critical" }).returning();
    const caller = authedCaller(owner); const input = { incidentId: incident!.incidentId };
    await caller.uptimeMonitor.incidentWorkspace.acknowledge(input);
    await caller.uptimeMonitor.incidentWorkspace.note({ ...input, text: "PRIVATE-NOTE-MARKER root cause is the worker deploy" });
    await caller.uptimeMonitor.incidentWorkspace.runbook({ ...input, description: "PRIVATE-RUNBOOK-MARKER restart the worker", url: "https://docs.example.com/private-runbook", expected: { description: "", url: null } });
    const publicPage = await publicCaller().uptimeMonitor.public.statusPageBySlug({ userId: owner.id, slug: "public" });
    const encoded = JSON.stringify(publicPage);
    expect(encoded).not.toMatch(/PRIVATE-NOTE-MARKER|PRIVATE-RUNBOOK-MARKER|private-runbook|worker deploy/);
    expect((await caller.uptimeMonitor.incidentWorkspace.one(input)).timeline.some(event => event.text?.includes("PRIVATE-NOTE-MARKER"))).toBe(true);
  });
});


it("protects and validates unacknowledge at the procedure boundary", async () => {
  const owner = await createTestUser(); const other = await createTestUser(); const monitor = await createTestMonitor(owner.id);
  const [incident] = await db.insert(uptimeIncident).values({ uptimeMonitorId: monitor.uptimeMonitorId }).returning();
  const input = { incidentId: incident!.incidentId };
  await expect(publicCaller().uptimeMonitor.incidentWorkspace.unacknowledge(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(authedCaller(other).uptimeMonitor.incidentWorkspace.unacknowledge(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const caller = authedCaller(owner);
  await expect(caller.uptimeMonitor.incidentWorkspace.unacknowledge({ incidentId: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await caller.uptimeMonitor.incidentWorkspace.acknowledge(input);
  expect(await caller.uptimeMonitor.incidentWorkspace.unacknowledge(input)).toEqual({ acknowledged: false });
  expect((await caller.uptimeMonitor.incidentWorkspace.one(input)).response.acknowledgedAt).toBeNull();
});
