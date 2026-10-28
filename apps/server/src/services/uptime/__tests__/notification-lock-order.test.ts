import { configureIncidentEscalation, runIncidentEscalations } from "../incident-escalation";
import { getTranslator } from "../../../lib/i18n";
import { afterEach, expect, it, vi } from "vitest";
import { db, uptimeDeferredAlert, uptimeIncident, uptimeIncidentEvent, uptimeIncidentEscalation, uptimeIncidentResponse, uptimeMonitor, uptimeNotificationLog, uptimeStatusChange } from "@pulsy/db";
import { and, eq } from "drizzle-orm";
import { createTestChannel, createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { dispatchNotifications } from "../notification-service";
import { resumeSuppressedNotifications } from "../maintenance-service";
useCleanDatabase(); afterEach(() => vi.restoreAllMocks());
it("commits an accepted alert receipt alongside a concurrent monitor/incident write without deadlock", async () => {
  const owner = await createTestUser();
  const monitor = await createTestMonitor(owner.id, { status: "down", latencyPolicy: { thresholdMs: 200, slowCount: 1, recoveryThresholdMs: 150, recoveryCount: 1, importance: "critical", cooldownSeconds: 0 } });
  await createTestChannel(monitor.uptimeMonitorId);
  const [change] = await db.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down" }).returning();
  await db.update(uptimeMonitor).set({ notificationOutageId: change!.statusChangeId }).where(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId));
  const [incident] = await db.insert(uptimeIncident).values({ uptimeMonitorId: monitor.uptimeMonitorId, startedAt: change!.createdAt }).returning();
  await db.insert(uptimeIncidentEvent).values({ userId: owner.id, monitorId: monitor.uptimeMonitorId, incidentId: incident!.incidentId,
    kind: "check", sourceId: `check-${change!.statusChangeId}`, facts: { status: "down" }, createdAt: change!.createdAt });
  await dispatchNotifications({ ...monitor, notificationOutageId: change!.statusChangeId }, change!);
  let locked!: () => void, permitWrite!: () => void;
  const monitorLocked = new Promise<void>(resolve => { locked = resolve; });
  const mayWrite = new Promise<void>(resolve => { permitWrite = resolve; });
  const writer = db.transaction(async tx => {
    await tx.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, owner.id))).for("update");
    locked(); await mayWrite;
    await tx.update(uptimeIncident).set({ cause: "Concurrent owned observation" }).where(eq(uptimeIncident.incidentId, incident!.incidentId));
  });
  await monitorLocked;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("received"));
  const delivery = resumeSuppressedNotifications();
  const settled = Promise.allSettled([writer, delivery]);
  try {
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled(), { timeout: 5000 });
    // Let the receipt reach its incident write if it acquires child locks first.
    // A parent-first receipt waits for the writer, leaving the incident available.
    for (let attempt = 0; attempt < 20; attempt++) {
      const free = await db.transaction(tx => tx.select({ id: uptimeIncident.incidentId }).from(uptimeIncident)
        .where(eq(uptimeIncident.incidentId, incident!.incidentId)).for("update", { skipLocked: true }));
      if (!free.length) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally { permitWrite(); }
  expect((await settled).every(result => result.status === "fulfilled")).toBe(true);
  expect((await db.select().from(uptimeDeferredAlert))[0]?.state).toBe("sent");
  expect(await db.select().from(uptimeNotificationLog)).toEqual([expect.objectContaining({ outcome: "sent" })]);
});

it("retains an accepted escalation receipt while cancellation locks the same parent and job", async () => {
  const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { status: "down" });
  const channel = await createTestChannel(monitor.uptimeMonitorId);
  const [incident] = await db.insert(uptimeIncident).values({ uptimeMonitorId: monitor.uptimeMonitorId, startedAt: new Date(Date.now() - 120_000).toISOString() }).returning();
  await configureIncidentEscalation(incident!.incidentId, owner.id, [{ channelId: channel.channelId, afterSeconds: 60 }], getTranslator("en"));
  const [job] = await db.select().from(uptimeIncidentEscalation).where(eq(uptimeIncidentEscalation.userId, owner.id));
  let locked!: () => void, permitWrite!: () => void;
  const monitorLocked = new Promise<void>(resolve => { locked = resolve; });
  const mayWrite = new Promise<void>(resolve => { permitWrite = resolve; });
  const writer = db.transaction(async tx => {
    await tx.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, owner.id))).for("update");
    locked(); await mayWrite;
    await tx.update(uptimeIncidentResponse).set({ escalationDisabled: true }).where(and(eq(uptimeIncidentResponse.incidentId, incident!.incidentId), eq(uptimeIncidentResponse.userId, owner.id)));
    await tx.update(uptimeIncidentEscalation).set({ state: "cancelled" }).where(and(eq(uptimeIncidentEscalation.id, job!.id), eq(uptimeIncidentEscalation.userId, owner.id)));
  });
  await monitorLocked;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("received"));
  const delivery = runIncidentEscalations(); const settled = Promise.allSettled([writer, delivery]);
  try {
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled(), { timeout: 5000 });
    for (let attempt = 0; attempt < 20; attempt++) {
      const free = await db.transaction(tx => tx.select({ id: uptimeIncidentEscalation.id }).from(uptimeIncidentEscalation)
        .where(and(eq(uptimeIncidentEscalation.id, job!.id), eq(uptimeIncidentEscalation.userId, owner.id))).for("update", { skipLocked: true }));
      if (!free.length) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally { permitWrite(); }
  expect((await settled).every(result => result.status === "fulfilled")).toBe(true);
  const [final] = await db.select().from(uptimeIncidentEscalation).where(eq(uptimeIncidentEscalation.id, job!.id));
  expect(final).toMatchObject({ state: "cancelled", leaseUntil: null, leaseToken: null });
  expect(final?.deliveredTargets).toHaveLength(1);
  expect(await db.select().from(uptimeNotificationLog)).toEqual([expect.objectContaining({ outcome: "sent" })]);
});

it("allows owner deletion during an accepted deferred send without losing the transport result", async () => {
  const owner = await createTestUser();
  const monitor = await createTestMonitor(owner.id, { status: "down", latencyPolicy: { thresholdMs: 200, slowCount: 1, recoveryThresholdMs: 150, recoveryCount: 1, importance: "critical", cooldownSeconds: 0 } });
  await createTestChannel(monitor.uptimeMonitorId);
  const [change] = await db.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: "up", statusAfter: "down" }).returning();
  await db.update(uptimeMonitor).set({ notificationOutageId: change!.statusChangeId }).where(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId));
  const [incident] = await db.insert(uptimeIncident).values({ uptimeMonitorId: monitor.uptimeMonitorId, startedAt: change!.createdAt }).returning();
  await db.insert(uptimeIncidentEvent).values({ userId: owner.id, monitorId: monitor.uptimeMonitorId, incidentId: incident!.incidentId,
    kind: "check", sourceId: `check-${change!.statusChangeId}`, facts: { status: "down" }, createdAt: change!.createdAt });
  await dispatchNotifications({ ...monitor, notificationOutageId: change!.statusChangeId }, change!);
  const [job] = await db.select().from(uptimeDeferredAlert).where(eq(uptimeDeferredAlert.userId, owner.id));
  let locked!: () => void, permitWrite!: () => void;
  const monitorLocked = new Promise<void>(resolve => { locked = resolve; });
  const mayWrite = new Promise<void>(resolve => { permitWrite = resolve; });
  const writer = db.transaction(async tx => {
    await tx.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, owner.id))).for("update");
    locked(); await mayWrite;
    await tx.delete(uptimeMonitor).where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, owner.id)));
  });
  await monitorLocked;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("received"));
  const onResult = vi.fn(); const delivery = resumeSuppressedNotifications({ onResult });
  const settled = Promise.allSettled([writer, delivery]);
  try {
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled(), { timeout: 5000 });
    for (let attempt = 0; attempt < 20; attempt++) {
      const free = await db.transaction(tx => tx.select({ id: uptimeDeferredAlert.id }).from(uptimeDeferredAlert)
        .where(and(eq(uptimeDeferredAlert.id, job!.id), eq(uptimeDeferredAlert.userId, owner.id))).for("update", { skipLocked: true }));
      if (!free.length) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally { permitWrite(); }
  expect((await settled).every(result => result.status === "fulfilled")).toBe(true);
  expect(onResult).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ok: true }));
  expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId))).toEqual([]);
  expect(await db.select().from(uptimeNotificationLog)).toEqual([]);
});
