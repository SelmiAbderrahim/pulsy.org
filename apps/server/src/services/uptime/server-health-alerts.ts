import { and, asc, eq, lte } from "drizzle-orm";
import { db, uptimeMonitor, uptimeServer, uptimeIncident, uptimeStatusChange, uptimeCheckLog, type DbTransaction, type ServerCondition, type ServerSample } from "@pulsy/db";
import { scheduledJobs, scheduleJob } from "node-schedule";
import { dispatchNotifications } from "./notification-service";
import { safeErrorSummary } from "../../lib/safe-error";
type Monitor = typeof uptimeMonitor.$inferSelect;
type Configuration = typeof uptimeServer.$inferSelect;
const scope = (monitor: Pick<Monitor, "uptimeMonitorId" | "userId">) => and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, monitor.userId));
const configScope = (monitor: Pick<Monitor, "uptimeMonitorId" | "userId">) => and(eq(uptimeServer.monitorId, monitor.uptimeMonitorId), eq(uptimeServer.userId, monitor.userId));

/** Unknown values break consecutive streaks but cannot clear an active condition. */
export function evaluateServerConditions(config: Pick<Configuration, "conditions" | "thresholds" | "excludedFilesystems">, sample: ServerSample): ServerCondition[] {
  const excluded = (path: string) => config.excludedFilesystems.some(prefix => path === prefix || path.startsWith(prefix.replace(/\/$/, "") + "/"));
  const previous = new Map(config.conditions.map(condition => [condition.key, condition]));
  const values = new Map<string, number | null>([["cpu", sample.cpuPercent], ["memory", sample.memoryPercent]]);
  // Keep active missing mounts until they are observed healthy or explicitly excluded.
  // Bound persisted cardinality to 64 filesystem conditions even under mount churn.
  for (const condition of config.conditions) if (condition.active && condition.key.startsWith("disk:") && !excluded(condition.key.slice(5)) && values.size < 66) values.set(condition.key, null);
  for (const fs of sample.filesystems) if (!excluded(fs.path) && (values.has(`disk:${fs.path}`) || values.size < 66)) values.set(`disk:${fs.path}`, fs.usedPercent);
  return [...values].map(([key, value]) => {
    const threshold = key === "cpu" ? config.thresholds.cpu : key === "memory" ? config.thresholds.memory : config.thresholds.disk;
    const before = previous.get(key);
    const sameThreshold = before?.threshold === threshold;
    const violating = value !== null && value >= threshold ? Math.min(3, (sameThreshold ? before?.violating ?? 0 : 0) + 1) : 0;
    const healthy = value !== null && value < threshold ? Math.min(2, (sameThreshold ? before?.healthy ?? 0 : 0) + 1) : 0;
    const active = violating >= 3 ? true : healthy >= 2 ? false : before?.active ?? false;
    return { key, value, threshold, violating, healthy, active };
  });
}
const reasonFor = (config: Configuration, status: "up" | "down" | "degraded", conditions: ServerCondition[]) => `server_health:${JSON.stringify({ locale: config.locale, status, conditions: conditions.filter(condition => condition.active).map(({ key, value, threshold }) => ({ key, value, threshold })) })}`;

async function recordHealth(tx: DbTransaction, monitor: Monitor, config: Configuration, status: "up" | "down" | "degraded", reason: string, now: Date) {
  const stamp = now.toISOString();
  await tx.insert(uptimeCheckLog).values({ uptimeMonitorId: monitor.uptimeMonitorId, status, errorMessage: status === "up" ? null : reason, createdAt: stamp, responseTime: null, httpStatus: null });
  await tx.update(uptimeMonitor).set({ status, lastCheckedAt: stamp, nextCheckAt: config.nextDeadline, responseTime: null, httpStatus: null }).where(scope(monitor));
  if (monitor.status === status) return;
  const [transition] = await tx.insert(uptimeStatusChange).values({ uptimeMonitorId: monitor.uptimeMonitorId, statusBefore: monitor.status, statusAfter: status, reason, createdAt: stamp }).returning();
  if (!transition) throw new Error("Server health transition failed");
  const bad = status !== "up";
  const outageId = bad ? (monitor.status === "down" || monitor.status === "degraded") && monitor.notificationOutageId ? monitor.notificationOutageId : transition.statusChangeId : monitor.notificationOutageId;
  await tx.update(uptimeMonitor).set({ notificationOutageId: outageId }).where(scope(monitor));
  const [ongoing] = await tx.select({ incident: uptimeIncident }).from(uptimeIncident).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeIncident.uptimeMonitorId)).where(and(scope(monitor), eq(uptimeIncident.status, "ongoing"))).limit(1);
  if (bad && !ongoing) await tx.insert(uptimeIncident).values({ uptimeMonitorId: monitor.uptimeMonitorId, cause: reason, startedAt: stamp, severity: "critical" });
  if (!bad && ongoing) await tx.update(uptimeIncident).set({ status: "resolved", resolvedAt: stamp, durationSeconds: Math.max(0, Math.round((now.getTime() - Date.parse(ongoing.incident.startedAt)) / 1000)) }).where(and(eq(uptimeIncident.incidentId, ongoing.incident.incidentId), eq(uptimeIncident.uptimeMonitorId, monitor.uptimeMonitorId)));
  if (bad || outageId) return { monitor: { ...monitor, status, notificationOutageId: outageId }, transition };
}

/** Dispatch committed transitions without holding ingestion or deadline scans for retries. */
export function dispatchServerHealth(delivery: Awaited<ReturnType<typeof recordHealth>>): void {
  if (!delivery) return;
  void dispatchNotifications(delivery.monitor, delivery.transition).catch(error => {
    console.error(`[uptime] Server notification failed: ${safeErrorSummary(error)}`);
  });
}

/** Called in the ingestion transaction, under parent/configuration locks. */
export async function recordServerReport(tx: DbTransaction, monitor: Monitor, config: Configuration, sample: ServerSample, now: Date) {
  if (!monitor.active) return;
  const conditions = evaluateServerConditions(config, sample);
  const missingHealthy = monitor.status === "down" ? config.missingHealthy + 1 : 0;
  const status = monitor.status === "down" && missingHealthy < 2 ? "down" : conditions.some(condition => condition.active) ? "degraded" : "up";
  await tx.update(uptimeServer).set({ conditions, missingHealthy: status === "down" ? missingHealthy : 0 }).where(configScope(monitor));
  return recordHealth(tx, monitor, config, status, reasonFor(config, status, conditions), now);
}

export async function scanServerDeadlines(now = new Date()): Promise<number> {
  const candidates = await db.select({ monitorId: uptimeServer.monitorId, userId: uptimeServer.userId }).from(uptimeServer)
    .innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeServer.monitorId))
    .where(and(eq(uptimeMonitor.userId, uptimeServer.userId), eq(uptimeMonitor.active, true), eq(uptimeMonitor.monitorType, "server"), lte(uptimeServer.nextDeadline, now.toISOString())))
    .orderBy(asc(uptimeServer.nextDeadline), asc(uptimeServer.monitorId)).limit(50);
  let processed = 0;
  for (const target of candidates) {
    let delivery: Awaited<ReturnType<typeof recordHealth>>;
    const changed = await db.transaction(async tx => {
      const [monitor] = await tx.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.uptimeMonitorId, target.monitorId), eq(uptimeMonitor.userId, target.userId), eq(uptimeMonitor.monitorType, "server"), eq(uptimeMonitor.active, true))).for("update", { skipLocked: true });
      if (!monitor) return false;
      const [config] = await tx.select().from(uptimeServer).where(configScope(monitor)).for("update");
      if (!config?.lastReceivedAt || !config.nextDeadline || Date.parse(config.nextDeadline) > now.getTime()) return false;
      const interval = monitor.interval;
      // A receipt or another scan may have overtaken this scan's entry time.
      if (monitor.lastCheckedAt && Date.parse(monitor.lastCheckedAt) > now.getTime()) return false;
      const deadline = Date.parse(config.lastReceivedAt) + interval * 3000;
      if (deadline > now.getTime()) { await tx.update(uptimeServer).set({ nextDeadline: new Date(deadline).toISOString() }).where(configScope(monitor)); return false; }
      // Continue bounded outage observations at the reporting cadence; no duplicate transitions.
      const nextDeadline = new Date(now.getTime() + interval * 1000).toISOString();
      await tx.update(uptimeServer).set({ nextDeadline, missingHealthy: 0, conditions: config.conditions.map(condition => ({ ...condition, healthy: 0, violating: 0 })) }).where(configScope(monitor));
      delivery = await recordHealth(tx, monitor, { ...config, nextDeadline }, "down", reasonFor(config, "down", config.conditions), now);
      return true;
    });
    if (changed) processed++;
    dispatchServerHealth(delivery);
  }
  return processed;
}
let runningScan: Promise<void> | undefined;
export function startServerHealthWorker() {
  scheduledJobs["uptime-server-deadlines"]?.cancel();
  const scan = () => {
    if (runningScan) return runningScan;
    runningScan = scanServerDeadlines().then(() => undefined).catch(() => {
      console.error("[uptime] Server deadline scan failed");
    }).finally(() => { runningScan = undefined; });
    return runningScan;
  };
  void scan();
  return scheduleJob("uptime-server-deadlines", "*/5 * * * * *", scan);
}

/** Cancellation also drains the initial scan, which is outside node-schedule. */
export async function stopServerHealthWorker(): Promise<void> {
  scheduledJobs["uptime-server-deadlines"]?.cancel();
  await runningScan;
}
