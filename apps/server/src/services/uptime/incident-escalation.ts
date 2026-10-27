import { apiIncidentEscalation, db, uptimeIncident, uptimeIncidentEscalation, uptimeIncidentResponse, uptimeMonitor, uptimeNotificationChannel, type IncidentEscalationStep } from "@pulsy/db";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { scheduleJob, scheduledJobs } from "node-schedule";
import type { Translator } from "../../lib/i18n";
import { assertOwnedChannelReferences } from "./channel-bindings";
import { appendEvent, lockedIncident } from "./incident-workspace";
import { dispatchIncidentEscalation } from "./notification-service";
import { effectiveSuppression, loadMaintenance } from "./maintenance-service";
const jobScope = (id: string, ownerId: string) => and(eq(uptimeIncidentEscalation.id, id), eq(uptimeIncidentEscalation.userId, ownerId));
const invalid = (t: Translator) => new TRPCError({ code: "BAD_REQUEST", message: t("errors.incidentResponseInvalid") });
export async function configureIncidentEscalation(incidentId: string, ownerId: string, steps: IncidentEscalationStep[], t: Translator) {
  const result = apiIncidentEscalation.safeParse({ incidentId, steps }); if (!result.success) throw invalid(t);
  return db.transaction(async tx => {
    const target = await lockedIncident(incidentId, ownerId, t, tx);
    if (target.incident.status !== "ongoing" || target.response.acknowledgedAt || !target.monitor.active || target.monitor.latencyPolicy?.importance === "informational") throw invalid(t);
    if (target.response.escalationSteps) {
      if (!target.response.escalationDisabled && JSON.stringify(target.response.escalationSteps) === JSON.stringify(steps)) return { configured: true };
      // One immutable configuration per measured incident prevents reconfiguration loops.
      throw invalid(t);
    }
    await assertOwnedChannelReferences(tx, ownerId, steps.map(step => step.channelId), t);
    const channels = await tx.select().from(uptimeNotificationChannel).where(and(eq(uptimeNotificationChannel.userId, ownerId), inArray(uptimeNotificationChannel.channelId, steps.map(step => step.channelId))));
    if (channels.some(channel => target.monitor.status === "down" ? !channel.notifyOnDown : !channel.notifyOnDegraded) || channels.some(channel => channel.channelType === "email" && (!channel.emailProviderId || !channel.recipientAddresses?.length || channel.recipientAddresses.length > 20))) throw invalid(t);
    // Technical bound: two steps/20 recipients per step; extend after measured provider fan-out needs target-level jobs.
    await tx.update(uptimeIncidentResponse).set({ escalationSteps: steps, escalationDisabled: false }).where(and(eq(uptimeIncidentResponse.incidentId, incidentId), eq(uptimeIncidentResponse.userId, ownerId)));
    await tx.insert(uptimeIncidentEscalation).values(steps.map((step, index) => ({ userId: ownerId, incidentId, monitorId: target.monitor.uptimeMonitorId, channelId: step.channelId, step: index, sourceOutageId: target.monitor.notificationOutageId, dueAt: new Date(Date.parse(target.incident.startedAt) + step.afterSeconds * 1000).toISOString() })));
    await appendEvent(tx, target, "escalation_configured", null, t); return { configured: true };
  });
}
export async function cancelIncidentEscalation(incidentId: string, ownerId: string, t: Translator) {
  return db.transaction(async tx => {
    const target = await lockedIncident(incidentId, ownerId, t, tx);
    if (target.response.escalationSteps && !target.response.escalationDisabled) {
      await tx.update(uptimeIncidentResponse).set({ escalationDisabled: true }).where(and(eq(uptimeIncidentResponse.incidentId, incidentId), eq(uptimeIncidentResponse.userId, ownerId)));
      await tx.update(uptimeIncidentEscalation).set({ state: "cancelled" }).where(and(eq(uptimeIncidentEscalation.incidentId, incidentId), eq(uptimeIncidentEscalation.userId, ownerId), inArray(uptimeIncidentEscalation.state, ["pending", "processing"])));
      await appendEvent(tx, target, "escalation_cancelled", null, t);
    }
    return { cancelled: true };
  });
}
async function currentIncident(job: typeof uptimeIncidentEscalation.$inferSelect) {
  const [row] = await db.select({ monitor: uptimeMonitor, incident: uptimeIncident, response: uptimeIncidentResponse }).from(uptimeIncident).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeIncident.uptimeMonitorId)).innerJoin(uptimeIncidentResponse, and(eq(uptimeIncidentResponse.incidentId, uptimeIncident.incidentId), eq(uptimeIncidentResponse.monitorId, uptimeMonitor.uptimeMonitorId), eq(uptimeIncidentResponse.userId, job.userId))).where(and(eq(uptimeIncident.incidentId, job.incidentId), eq(uptimeMonitor.userId, job.userId), eq(uptimeMonitor.uptimeMonitorId, job.monitorId))).limit(1);
  return row && (!job.sourceOutageId || !row.monitor.notificationOutageId || job.sourceOutageId === row.monitor.notificationOutageId) && row.incident.status === "ongoing" && !row.response.acknowledgedAt && !row.response.escalationDisabled && row.monitor.active && ["down", "degraded"].includes(row.monitor.status) && row.monitor.latencyPolicy?.importance !== "informational" ? row : null;
}
async function runJob(job: { id: string; userId: string }) {
  const stamp = new Date().toISOString();
  const claimed = await db.transaction(async tx => {
    const scope = and(jobScope(job.id, job.userId), inArray(uptimeIncidentEscalation.state, ["pending", "processing"]), lte(uptimeIncidentEscalation.dueAt, stamp), or(eq(uptimeIncidentEscalation.state, "pending"), isNull(uptimeIncidentEscalation.leaseUntil), lte(uptimeIncidentEscalation.leaseUntil, stamp)));
    const [row] = await tx.select().from(uptimeIncidentEscalation).where(scope).for("update", { skipLocked: true });
    if (!row) return null;
    const leaseToken = randomUUID();
    await tx.update(uptimeIncidentEscalation).set({ state: "processing", leaseToken, leaseUntil: new Date(Date.now() + 300_000).toISOString() }).where(jobScope(row.id, row.userId)); return { ...row, leaseToken };
  });
  if (!claimed) return;
  const scope = and(jobScope(claimed.id, claimed.userId), eq(uptimeIncidentEscalation.leaseToken, claimed.leaseToken));
  try {
    const current = await currentIncident(claimed);
    if (!current) { await db.update(uptimeIncidentEscalation).set({ state: "cancelled" }).where(scope); return; }
    if (claimed.step > 0) {
      const [primary] = await db.select({ state: uptimeIncidentEscalation.state, attempts: uptimeIncidentEscalation.attempts }).from(uptimeIncidentEscalation).where(and(eq(uptimeIncidentEscalation.userId, claimed.userId), eq(uptimeIncidentEscalation.monitorId, claimed.monitorId), eq(uptimeIncidentEscalation.incidentId, claimed.incidentId), eq(uptimeIncidentEscalation.step, 0))).limit(1);
      if (!primary) { await db.update(uptimeIncidentEscalation).set({ state: "cancelled" }).where(scope); return; }
      if (primary.state === "processing" || primary.state === "pending" && primary.attempts === 0) {
        await db.update(uptimeIncidentEscalation).set({ state: "pending", dueAt: new Date(Date.now() + 15_000).toISOString() }).where(scope); return;
      }
    }
    const suppression = effectiveSuppression(await loadMaintenance(claimed.userId), claimed.monitorId);
    if (suppression) { await db.update(uptimeIncidentEscalation).set({ state: "pending", dueAt: suppression.until }).where(scope); return; }
    if (claimed.attempts >= 4) { await db.update(uptimeIncidentEscalation).set({ state: "failed" }).where(scope); return; }
    const [channel] = await db.select().from(uptimeNotificationChannel).where(and(eq(uptimeNotificationChannel.channelId, claimed.channelId), eq(uptimeNotificationChannel.userId, claimed.userId))).limit(1);
    if (!channel || channel.channelType === "email" && (channel.recipientAddresses?.length ?? 0) > 20) { await db.update(uptimeIncidentEscalation).set({ state: "cancelled" }).where(scope); return; }
    await db.update(uptimeIncidentEscalation).set({ attempts: claimed.attempts + 1 }).where(scope);
    let retryable = false, suppressed = false;
    const monitor = current.monitor;
    const snapshot = claimed.snapshot ?? { statusChangeId: `incident-escalation-${claimed.id}`, uptimeMonitorId: claimed.monitorId, statusBefore: monitor.status, statusAfter: monitor.status, httpStatus: monitor.httpStatus, responseTime: monitor.responseTime, reason: null, createdAt: new Date().toISOString() };
    if (snapshot.statusAfter !== monitor.status) { await db.update(uptimeIncidentEscalation).set({ state: "cancelled" }).where(scope); return; }
    if (!claimed.snapshot) await db.update(uptimeIncidentEscalation).set({ snapshot }).where(scope);
    await dispatchIncidentEscalation(monitor, snapshot, claimed.channelId, {
      delaysMs: [], deduplicate: true, strictAudit: true, escalationJobId: claimed.id, escalationLeaseToken: claimed.leaseToken, finishedTargets: claimed.finishedTargets,
      isIncidentCurrent: async () => {
        const [lease] = await db.select({ id: uptimeIncidentEscalation.id }).from(uptimeIncidentEscalation).where(and(scope, eq(uptimeIncidentEscalation.state, "processing"))).limit(1);
        return Boolean(lease) && (await currentIncident(claimed))?.monitor.status === snapshot.statusAfter;
      },
      onSuppressed: () => { suppressed = true; }, onResult: result => { if (result.retryable) retryable = true; },
    });
    const [final] = await db.select().from(uptimeIncidentEscalation).where(scope).limit(1); if (!final) return;
    if (!await currentIncident(claimed)) { await db.update(uptimeIncidentEscalation).set({ state: "cancelled" }).where(scope); return; }
    if (suppressed) {
      const nowSuppressed = effectiveSuppression(await loadMaintenance(claimed.userId), claimed.monitorId);
      await db.update(uptimeIncidentEscalation).set({ state: "pending", dueAt: nowSuppressed?.until ?? new Date(Date.now() + 15_000).toISOString() }).where(scope); return;
    }
    const failed = final.finishedTargets.some(target => !final.deliveredTargets.includes(target));
    await db.update(uptimeIncidentEscalation).set({ state: retryable ? final.attempts >= 4 ? "failed" : "pending" : failed ? "failed" : final.deliveredTargets.length ? "sent" : "cancelled", dueAt: retryable && final.attempts < 4 ? new Date(Date.now() + [30_000, 120_000, 600_000, 600_000][Math.min(final.attempts - 1, 3)]!).toISOString() : final.dueAt, leaseUntil: null }).where(scope);
  } catch { console.error(`[uptime] Incident escalation ${claimed.id} could not finish`); }
  finally {
    await db.update(uptimeIncidentEscalation).set({ leaseUntil: null, leaseToken: null })
      .where(and(scope, inArray(uptimeIncidentEscalation.state, ["sent", "failed", "cancelled"])));
  }
}
export async function runIncidentEscalations() {
  // Global worker enumeration is bounded; every subsequent access uses the persisted owner.
  const now = new Date().toISOString();
  const jobs = await db.select({ id: uptimeIncidentEscalation.id, userId: uptimeIncidentEscalation.userId }).from(uptimeIncidentEscalation).where(and(inArray(uptimeIncidentEscalation.state, ["pending", "processing"]), lte(uptimeIncidentEscalation.dueAt, now), or(eq(uptimeIncidentEscalation.state, "pending"), isNull(uptimeIncidentEscalation.leaseUntil), lte(uptimeIncidentEscalation.leaseUntil, now)))).orderBy(asc(uptimeIncidentEscalation.dueAt)).limit(25);
  for (let offset = 0; offset < jobs.length; offset += 4) await Promise.all(jobs.slice(offset, offset + 4).map(runJob));
}
let runningScan: Promise<void> | undefined;
export function startIncidentEscalationWorker(): void {
  scheduledJobs["uptime-incident-escalations"]?.cancel();
  const tick = () => {
    if (runningScan) return runningScan;
    runningScan = runIncidentEscalations().catch(() => { console.error("[uptime] Incident escalation scan failed"); })
      .finally(() => { runningScan = undefined; });
    return runningScan;
  };
  scheduleJob("uptime-incident-escalations", "*/15 * * * * *", tick);
  void tick();
}
export async function stopIncidentEscalationWorker(): Promise<void> {
  scheduledJobs["uptime-incident-escalations"]?.cancel();
  await runningScan;
}
