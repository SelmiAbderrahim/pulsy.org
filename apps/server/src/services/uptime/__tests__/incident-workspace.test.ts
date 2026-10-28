import { appendIncidentAlert } from "../incident-timeline";
import { describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, uptimeIncident, uptimeMonitor, uptimeStatusChange, uptimeNotificationLog, uptimeCheckLog, uptimeIncidentEvent, uptimeIncidentResponse } from "@pulsy/db";
import { createTestUser, createTestMonitor, useCleanDatabase } from "../../../../test/db";
import { getTranslator } from "../../../lib/i18n";
import { encrypt } from "../../../lib/crypto";
import { unacknowledgeIncident, acknowledgeIncident, addIncidentNote, configureIncidentRunbook, createIncidentGroup, incidentWorkspaceDetail, listWorkspaceIncidents } from "../incident-workspace";
import { createHeartbeatForUser, receiveHeartbeat } from "../heartbeat-service";
useCleanDatabase(); const t = getTranslator("en");
async function fixture(ownerId: string, name = "API", startedAt = "2026-10-09T12:00:00.000Z") {
  const monitor = await createTestMonitor(ownerId, { name, status: "down" });
  const [incident] = await db.insert(uptimeIncident).values({ uptimeMonitorId: monitor.uptimeMonitorId, startedAt, cause: "HTTP 503" }).returning();
  return { monitor, incident: incident! };
}
describe("owner-scoped incident workspace", () => {

  it("rejects a concurrent stale runbook without losing the winning edit or changing health", async () => {
    const owner = await createTestUser(); const { monitor, incident } = await fixture(owner.id);
    const expected = { description: "", url: null };
    const results = await Promise.allSettled(["First draft", "Second draft"].map(description => configureIncidentRunbook(incident.incidentId, owner.id, { description, expected }, t)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    const saved = await incidentWorkspaceDetail(incident.incidentId, owner.id, t);
    expect(["First draft", "Second draft"]).toContain(saved.response.runbookDescription);
    expect(saved.timeline.filter(event => event.kind === "runbook")).toHaveLength(1);
    expect(saved.monitor.status).toBe("down");
    expect((await listWorkspaceIncidents(owner.id, { state: "all" })).items[0]).toMatchObject({ monitorId: monitor.uptimeMonitorId, measuredHealth: "down" });
  });

  it("uses the latest owned machine event for the incident list update time", async () => {
    const owner = await createTestUser(); const other = await createTestUser(); const { monitor, incident } = await fixture(owner.id);
    const latest = "2026-10-09T12:02:00.000Z";
    await db.insert(uptimeIncidentEvent).values({ userId: owner.id, monitorId: monitor.uptimeMonitorId, incidentId: incident.incidentId, kind: "alert", sourceId: "fixture-owned-alert", createdAt: latest, facts: { outcome: "delivered" } });
    await db.insert(uptimeIncidentEvent).values({ userId: other.id, monitorId: monitor.uptimeMonitorId, incidentId: incident.incidentId, kind: "alert", sourceId: "fixture-foreign-alert", createdAt: "2026-10-09T12:03:00.000Z" });
    expect((await listWorkspaceIncidents(owner.id, { state: "all" })).items[0]?.lastUpdatedAt).toBe(latest);
  });

  it("retains an append-only transition trail when raw check history is pruned", async () => {
    const owner = await createTestUser(); const start = new Date("2026-10-09T12:00:00.000Z");
    const heartbeat = await createHeartbeatForUser({ name: "Backup", interval: 300, graceSeconds: 60, active: true, tags: [] }, owner.id, t, start);
    await receiveHeartbeat(heartbeat.token, "fail", {}, new Date(start.getTime() + 1000));
    const [incident] = await db.select().from(uptimeIncident);
    await receiveHeartbeat(heartbeat.token, "success", {}, new Date(start.getTime() + 2000));
    await db.delete(uptimeCheckLog).where(eq(uptimeCheckLog.uptimeMonitorId, heartbeat.monitor.uptimeMonitorId));
    await db.delete(uptimeStatusChange).where(eq(uptimeStatusChange.uptimeMonitorId, heartbeat.monitor.uptimeMonitorId));
    const detail = await incidentWorkspaceDetail(incident!.incidentId, owner.id, t);
    expect(detail.incident.status).toBe("resolved");
    expect(detail.timeline.filter(event => event.kind === "check").map(event => event.status)).toEqual(["up", "down"]);
  });

  it("keeps concurrent acknowledgement idempotent and human response separate from measured health", async () => {
    const owner = await createTestUser(); const { monitor, incident } = await fixture(owner.id);
    await Promise.all([acknowledgeIncident(incident.incidentId, owner.id, t), acknowledgeIncident(incident.incidentId, owner.id, t)]);
    const detail = await incidentWorkspaceDetail(incident.incidentId, owner.id, t);
    expect(detail.response.acknowledgedAt).not.toBeNull(); expect(detail.response.acknowledgedBy).toBe(owner.id);
    expect(detail.timeline.filter(event => event.kind === "acknowledged")).toHaveLength(1);
    expect((await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId)))[0]?.status).toBe("down");
    expect((await db.select().from(uptimeIncident))[0]?.status).toBe("ongoing");
    expect((await listWorkspaceIncidents(owner.id, { state: "acknowledged", limit: 20 })).items).toHaveLength(1);
    expect((await listWorkspaceIncidents(owner.id, { state: "open", limit: 20 })).items).toHaveLength(1);
  });
  it("redacts known request secrets before storing notes/runbooks and does not return transport targets or errors in timelines", async () => {
    const owner = await createTestUser(); const { monitor, incident } = await fixture(owner.id);
    await db.update(uptimeMonitor).set({ requestCipher: encrypt(JSON.stringify({ headers: [{ name: "X-Key", value: "fixture-header-secret" }], body: '{"password":"fixture-body-secret"}', auth: { type: "bearer", token: "fixture-bearer-secret" } })) }).where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, owner.id)));
    await addIncidentNote(incident.incidentId, owner.id, "Inspect fixture-bearer-secret fixture-header-secret fixture-body-secret", t);
    await configureIncidentRunbook(incident.incidentId, owner.id, { description: "Rotate fixture-bearer-secret", url: "https://docs.example.com/runbook" }, t);
    await expect(configureIncidentRunbook(incident.incidentId, owner.id, { description: "Unsafe", url: "https://secret@example.com/private" }, t)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [change] = await db.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down", createdAt: incident.startedAt, reason: "fixture-bearer-secret" }).returning();
    await db.insert(uptimeNotificationLog).values({ uptimeMonitorId: monitor.uptimeMonitorId, userId: owner.id, channelType: "email", target: "private@fixtures.invalid", event: "down", outcome: "failed", statusChangeId: change!.statusChangeId, createdAt: incident.startedAt, error: "fixture-bearer-secret" });
    const detail = await incidentWorkspaceDetail(incident.incidentId, owner.id, t); const encoded = JSON.stringify(detail);
    const stored = JSON.stringify(await db.select().from(uptimeIncidentEvent).where(eq(uptimeIncidentEvent.userId, owner.id)));
    for (const secret of ["fixture-bearer-secret", "fixture-header-secret", "fixture-body-secret", "private@fixtures.invalid"]) expect(encoded).not.toContain(secret);
    for (const secret of ["fixture-bearer-secret", "fixture-header-secret", "fixture-body-secret"]) expect(stored).not.toContain(secret);
    expect(detail.timeline.some(event => event.kind === "check")).toBe(true); expect(detail.timeline.some(event => event.kind === "alert")).toBe(true);
    expect(detail.response.runbookUrl).toBe("https://docs.example.com/runbook");
    expect(detail.timeline.some(event => event.text?.includes("[redacted]"))).toBe(true);
  });
  it("paginates equal timestamps without omissions and handles literal search characters and resolved workflow", async () => {
    const owner = await createTestUser(); await fixture(owner.id, "API_%"); await fixture(owner.id, "Other"); const final = await fixture(owner.id, "Resolved");
    await db.update(uptimeIncident).set({ status: "resolved", resolvedAt: "2026-10-09T12:01:00.000Z", durationSeconds: 60 }).where(eq(uptimeIncident.incidentId, final.incident.incidentId));
    const page = await listWorkspaceIncidents(owner.id, { state: "all", limit: 2 }); expect(page.items).toHaveLength(2); expect(page.nextCursor).not.toBeNull();
    const next = await listWorkspaceIncidents(owner.id, { state: "all", limit: 2, cursor: page.nextCursor! });
    expect(new Set([...page.items, ...next.items].map(item => item.incidentId)).size).toBe(3);
    expect((await listWorkspaceIncidents(owner.id, { state: "all", limit: 20, search: "_%" })).items.map(item => item.monitorName)).toEqual(["API_%"]);
    expect((await listWorkspaceIncidents(owner.id, { state: "resolved", limit: 20 })).items).toHaveLength(1);
  });
  it("rejects every foreign action and manual group atomically without merging measured incidents", async () => {
    const owner = await createTestUser(); const other = await createTestUser(); const own = await fixture(owner.id); const foreign = await fixture(other.id);
    for (const action of [() => incidentWorkspaceDetail(foreign.incident.incidentId, owner.id, t), () => acknowledgeIncident(foreign.incident.incidentId, owner.id, t), () => addIncidentNote(foreign.incident.incidentId, owner.id, "Private note", t), () => configureIncidentRunbook(foreign.incident.incidentId, owner.id, { description: "Private" }, t), () => createIncidentGroup(owner.id, "Response", [own.incident.incidentId, foreign.incident.incidentId], t)]) await expect(action()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createIncidentGroup(owner.id, "Response", [own.incident.incidentId], t)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const second = await fixture(owner.id);
    const group = await createIncidentGroup(owner.id, "Response", [own.incident.incidentId, second.incident.incidentId], t);
    expect((await incidentWorkspaceDetail(own.incident.incidentId, owner.id, t)).response.group).toMatchObject({ id: group.id, name: "Response" });
    expect(await db.select().from(uptimeIncident)).toHaveLength(3);
    expect((await listWorkspaceIncidents(owner.id, { state: "all", limit: 20 })).items.map(item => item.incidentId).sort()).toEqual([own.incident.incidentId, second.incident.incidentId].sort());
  });
});


it("stores one acknowledgement timestamp for the response, list and timeline", async () => {
  const owner = await createTestUser(); const { incident } = await fixture(owner.id);
  const iso = Date.prototype.toISOString;
  let tick = 0;
  // Advancing serialization exposes separate timestamp generation without sleeps.
  const clock = vi.spyOn(Date.prototype, "toISOString").mockImplementation(function (this: Date) { return iso.call(new Date(Date.parse("2026-10-14T12:00:00.000Z") + tick++ * 1000)); });
  try { await acknowledgeIncident(incident.incidentId, owner.id, t); } finally { clock.mockRestore(); }
  const detail = await incidentWorkspaceDetail(incident.incidentId, owner.id, t);
  const event = detail.timeline.find(item => item.kind === "acknowledged");
  expect(event?.createdAt).toBe(detail.response.acknowledgedAt);
  const list = await listWorkspaceIncidents(owner.id, { state: "acknowledged" });
  expect(list.items[0]?.acknowledgedAt).toBe(event?.createdAt);
  expect(list.items[0]?.lastUpdatedAt).toBe(event?.createdAt);
});

it("copies the owned delivery log timestamp to its durable timeline event", async () => {
  const owner = await createTestUser(); const { monitor, incident } = await fixture(owner.id);
  const [change] = await db.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down", createdAt: incident.startedAt }).returning();
  const entry = { uptimeMonitorId: monitor.uptimeMonitorId, userId: owner.id, channelType: "email" as const, target: "ops@example.invalid", event: "down" as const, outcome: "sent" as const, statusChangeId: change!.statusChangeId, createdAt: "2026-10-09T12:00:37.000Z" };
  const [log] = await db.insert(uptimeNotificationLog).values(entry).returning();
  await appendIncidentAlert(entry, log!.notificationLogId, db, incident.incidentId);
  const detail = await incidentWorkspaceDetail(incident.incidentId, owner.id, t);
  expect(detail.timeline.find(item => item.id === `alert-${log!.notificationLogId}`)?.createdAt).toBe(log!.createdAt);
});


it("projects historical acknowledgement time without rewriting durable history", async () => {
  const owner = await createTestUser(); const { monitor, incident } = await fixture(owner.id);
  const acknowledgedAt = "2026-10-09T12:00:10.000Z", appendedAt = "2026-10-09T12:00:11.000Z";
  await db.insert(uptimeIncidentResponse).values({ incidentId: incident.incidentId, monitorId: monitor.uptimeMonitorId, userId: owner.id, acknowledgedAt, acknowledgedBy: owner.id, updatedAt: appendedAt });
  const [stored] = await db.insert(uptimeIncidentEvent).values({ incidentId: incident.incidentId, monitorId: monitor.uptimeMonitorId, userId: owner.id, kind: "acknowledged", createdAt: appendedAt }).returning();
  const detail = await incidentWorkspaceDetail(incident.incidentId, owner.id, t);
  expect(detail.timeline.find(event => event.kind === "acknowledged")?.createdAt).toBe(detail.response.acknowledgedAt);
  expect((await listWorkspaceIncidents(owner.id, { state: "all" })).items[0]?.lastUpdatedAt).toBe(acknowledgedAt);
  expect((await db.select().from(uptimeIncidentEvent).where(eq(uptimeIncidentEvent.id, stored!.id)))[0]?.createdAt).toBe(appendedAt);
});

it("projects a historical recovery delivery after resolution and falls back when its log is pruned", async () => {
  const owner = await createTestUser(); const { monitor, incident } = await fixture(owner.id);
  const resolvedAt = "2026-10-09T12:01:00.000Z", deliveredAt = "2026-10-09T12:01:10.000Z", appendedAt = "2026-10-09T12:01:11.000Z";
  await db.update(uptimeIncident).set({ status: "resolved", resolvedAt }).where(eq(uptimeIncident.incidentId, incident.incidentId));
  const [log] = await db.insert(uptimeNotificationLog).values({ uptimeMonitorId: monitor.uptimeMonitorId, userId: owner.id, channelType: "email", target: "ops@example.invalid", event: "recovery", outcome: "sent", createdAt: deliveredAt }).returning();
  const sourceId = `alert-${log!.notificationLogId}`;
  const [stored] = await db.insert(uptimeIncidentEvent).values({ incidentId: incident.incidentId, monitorId: monitor.uptimeMonitorId, userId: owner.id, kind: "alert", sourceId, createdAt: appendedAt }).returning();
  expect((await incidentWorkspaceDetail(incident.incidentId, owner.id, t)).timeline.find(event => event.id === sourceId)?.createdAt).toBe(deliveredAt);
  expect((await listWorkspaceIncidents(owner.id, { state: "all" })).items[0]?.lastUpdatedAt).toBe(deliveredAt);
  expect((await db.select().from(uptimeIncidentEvent).where(eq(uptimeIncidentEvent.id, stored!.id)))[0]?.createdAt).toBe(appendedAt);
  await db.delete(uptimeNotificationLog).where(eq(uptimeNotificationLog.notificationLogId, log!.notificationLogId));
  expect((await incidentWorkspaceDetail(incident.incidentId, owner.id, t)).timeline.find(event => event.id === sourceId)?.createdAt).toBe(appendedAt);
  expect((await listWorkspaceIncidents(owner.id, { state: "all" })).items[0]?.lastUpdatedAt).toBe(appendedAt);
});

it("never projects a delivery timestamp from another owner or monitor", async () => {
  const owner = await createTestUser(); const other = await createTestUser(); const { monitor, incident } = await fixture(owner.id);
  const otherMonitor = await createTestMonitor(owner.id);
  const appendedAt = "2026-10-09T12:01:11.000Z";
  for (const scope of [{ userId: other.id, uptimeMonitorId: monitor.uptimeMonitorId }, { userId: owner.id, uptimeMonitorId: otherMonitor.uptimeMonitorId }]) {
    const [log] = await db.insert(uptimeNotificationLog).values({ ...scope, channelType: "email", target: "ops@example.invalid", event: "down", outcome: "sent", createdAt: "2026-10-09T12:01:10.000Z" }).returning();
    const sourceId = `alert-${log!.notificationLogId}`;
    await db.insert(uptimeIncidentEvent).values({ incidentId: incident.incidentId, monitorId: monitor.uptimeMonitorId, userId: owner.id, kind: "alert", sourceId, createdAt: appendedAt });
    expect((await incidentWorkspaceDetail(incident.incidentId, owner.id, t)).timeline.find(event => event.id === sourceId)?.createdAt).toBe(appendedAt);
  }
  expect((await listWorkspaceIncidents(owner.id, { state: "all" })).items[0]?.lastUpdatedAt).toBe(appendedAt);
});


it("unacknowledges idempotently and retains actor/time through re-acknowledgement", async () => {
  const owner = await createTestUser(); const { incident, monitor } = await fixture(owner.id);
  await acknowledgeIncident(incident.incidentId, owner.id, t);
  const before = await incidentWorkspaceDetail(incident.incidentId, owner.id, t);
  await Promise.all([unacknowledgeIncident(incident.incidentId, owner.id, t), unacknowledgeIncident(incident.incidentId, owner.id, t)]);
  const cleared = await incidentWorkspaceDetail(incident.incidentId, owner.id, t);
  expect(cleared.response).toMatchObject({ acknowledgedAt: null, acknowledgedBy: null });
  const removal = cleared.timeline.filter(event => event.kind === "unacknowledged");
  expect(removal).toHaveLength(1);
  expect(removal[0]?.actorId).toBe(owner.id);
  expect(Date.parse(removal[0]!.createdAt)).toBeGreaterThanOrEqual(Date.parse(before.response.acknowledgedAt!));
  expect((await listWorkspaceIncidents(owner.id, { state: "acknowledged" })).items).toHaveLength(0);
  expect((await listWorkspaceIncidents(owner.id, { state: "open" })).items).toHaveLength(1);
  await acknowledgeIncident(incident.incidentId, owner.id, t);
  const after = await incidentWorkspaceDetail(incident.incidentId, owner.id, t);
  const original = before.timeline.find(event => event.kind === "acknowledged")!;
  expect(after.timeline.find(event => event.id === original.id)).toEqual(original);
  expect(after.timeline.filter(event => event.kind === "acknowledged")).toHaveLength(2);
  expect(after.incident.status).toBe("ongoing");
  expect(after.monitor.status).toBe("down");
  const other = await createTestUser();
  await expect(unacknowledgeIncident(incident.incidentId, other.id, t)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await db.update(uptimeIncident).set({ status: "resolved" }).where(eq(uptimeIncident.incidentId, incident.incidentId));
  await expect(unacknowledgeIncident(incident.incidentId, owner.id, t)).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("freezes a legacy acknowledgement projection before unacknowledgement", async () => {
  const owner = await createTestUser(); const { incident, monitor } = await fixture(owner.id);
  const acknowledgedAt = "2026-10-09T12:00:10.000Z", createdAt = "2026-10-09T12:00:11.000Z";
  await db.insert(uptimeIncidentResponse).values({ incidentId: incident.incidentId, monitorId: monitor.uptimeMonitorId, userId: owner.id, acknowledgedAt, acknowledgedBy: owner.id });
  const [event] = await db.insert(uptimeIncidentEvent).values({ incidentId: incident.incidentId, monitorId: monitor.uptimeMonitorId, userId: owner.id, actorId: owner.id, kind: "acknowledged", createdAt }).returning();
  await unacknowledgeIncident(incident.incidentId, owner.id, t);
  await acknowledgeIncident(incident.incidentId, owner.id, t);
  const detail = await incidentWorkspaceDetail(incident.incidentId, owner.id, t);
  expect(detail.timeline.find(item => item.id === `human-${event!.id}`)?.createdAt).toBe(acknowledgedAt);
  expect((await db.select().from(uptimeIncidentEvent).where(eq(uptimeIncidentEvent.id, event!.id)))[0]?.createdAt).toBe(createdAt);
});

it("keeps the newest hundred projected events across ORM keyset batches", async () => {
  const owner = await createTestUser(); const { monitor, incident } = await fixture(owner.id);
  const start = Date.parse(incident.startedAt);
  await db.insert(uptimeIncidentEvent).values(Array.from({ length: 501 }, (_, index) => ({
    userId: owner.id, monitorId: monitor.uptimeMonitorId, incidentId: incident.incidentId, kind: "check" as const,
    sourceId: `check-fixture-${index}`, facts: { status: "down" }, createdAt: new Date(start + index * 1000).toISOString(),
  })));
  const detail = await incidentWorkspaceDetail(incident.incidentId, owner.id, t);
  expect(detail.timeline).toHaveLength(100); expect(detail.timelineTruncated).toBe(true);
  expect(detail.timeline[0]?.createdAt).toBe(new Date(start + 500_000).toISOString());
  expect(detail.timeline.at(-1)?.createdAt).toBe(new Date(start + 401_000).toISOString());
  expect((await listWorkspaceIncidents(owner.id, { state: "all" })).items[0]?.lastUpdatedAt).toBe(new Date(start + 500_000).toISOString());
});
