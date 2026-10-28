import { expect, it } from "vitest";
import { db, uptimeIncident, uptimeIncidentEscalation } from "@pulsy/db";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { incidentRecoveryDelivery } from "../incident-delivery";
useCleanDatabase();
it("never reuses an older resolved incident's escalation receipts for an unrelated recovery", async () => {
  const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { status: "up" });
  const [old] = await db.insert(uptimeIncident).values({ uptimeMonitorId: monitor.uptimeMonitorId, status: "resolved", startedAt: "2026-10-09T12:00:00.000Z", resolvedAt: "2026-10-09T12:01:00.000Z" }).returning();
  await db.insert(uptimeIncidentEscalation).values({ incidentId: old!.incidentId, monitorId: monitor.uptimeMonitorId, userId: owner.id, channelId: "former-channel", step: 0, dueAt: old!.startedAt, state: "sent", deliveredTargets: ["former-target"] });
  expect(await incidentRecoveryDelivery(monitor, "2026-10-09T12:10:00.000Z")).toEqual({ targets: [], channelIds: [], processing: false });
});
