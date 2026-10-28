import { createHash, createHmac } from "node:crypto";
import { db, uptimeIncident, uptimeMonitor } from "@pulsy/db";
import { checkErrorCodeOf } from "@pulsy/db/check-error";
import { and, desc, eq, lte, or, isNull, gte } from "drizzle-orm";
import { z } from "zod";
import { getTranslator } from "../../lib/i18n";
import { describeCheckReason } from "./check-error";
import { serverHealthNotice } from "./server-health-notice";

export const webhookV1 = z.object({
  version: z.literal(1), id: z.string().uuid(),
  event: z.enum(["monitor.down", "monitor.up", "monitor.degraded", "monitor.tls_expiring", "test"]),
  test: z.boolean(), timestamp: z.string().datetime(),
  monitor: z.object({ id: z.string(), name: z.string(), url: z.string(), type: z.string() }),
  reason: z.object({ code: z.string(), message: z.string() }).optional(),
  incident: z.object({ id: z.string(), startedAt: z.string().datetime(), url: z.string().url() }).optional(),
  recovery: z.object({ recoveredAt: z.string().datetime(), downtimeSeconds: z.number().nonnegative() }).optional(),
});

type Change = { statusChangeId: string; statusAfter: string; createdAt: string; reason: string | null; httpStatus: number | null; test?: boolean; webhookEvent?: "monitor.tls_expiring" };

/** Stable UUID for the logical channel/event delivery, including durable retries. */
function deliveryId(channelId: string, changeId: string) {
  const bytes = createHash("sha256").update(JSON.stringify([channelId, changeId])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function buildWebhookBody(channelId: string, monitor: typeof uptimeMonitor.$inferSelect, change: Change) {
  const event = change.test ? "test" : change.webhookEvent ?? (change.statusAfter === "up" ? "monitor.up" : change.statusAfter === "degraded" ? "monitor.degraded" : "monitor.down");
  const incident = change.test || event === "monitor.tls_expiring" ? undefined : (await db.select({ id: uptimeIncident.incidentId, startedAt: uptimeIncident.startedAt, resolvedAt: uptimeIncident.resolvedAt, durationSeconds: uptimeIncident.durationSeconds })
    .from(uptimeIncident).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeIncident.uptimeMonitorId))
    .where(and(eq(uptimeMonitor.userId, monitor.userId), eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), lte(uptimeIncident.startedAt, change.createdAt), or(isNull(uptimeIncident.resolvedAt), gte(uptimeIncident.resolvedAt, change.createdAt))))
    .orderBy(desc(uptimeIncident.startedAt)).limit(1))[0];
  const code = event === "monitor.tls_expiring" ? "tls_expiring" : monitor.monitorType === "server" ? "server_health" : checkErrorCodeOf(change.reason) ?? "unknown";
  const message = monitor.monitorType === "server" ? serverHealthNotice(monitor, change).reason : describeCheckReason(change.reason ?? "unknown", getTranslator("en"), { httpStatus: change.httpStatus, timeoutMs: monitor.timeout });
  const base = process.env.PUBLIC_WEB_URL;
  if (incident && !base) throw new Error(getTranslator("en")("errors.internal"));
  return JSON.stringify(webhookV1.parse({
    version: 1, id: deliveryId(channelId, change.statusChangeId), event, test: Boolean(change.test), timestamp: change.createdAt,
    monitor: { id: monitor.uptimeMonitorId, name: monitor.name, url: monitor.url, type: monitor.monitorType },
    ...(!change.test && (change.reason || event !== "monitor.up") ? { reason: { code, message: message! } } : {}),
    ...(incident ? { incident: { id: incident.id, startedAt: incident.startedAt, url: new URL(`/dashboard/incidents?incidentId=${encodeURIComponent(incident.id)}`, base).href } } : {}),
    ...(event === "monitor.up" && incident?.resolvedAt ? { recovery: { recoveredAt: incident.resolvedAt, downtimeSeconds: incident.durationSeconds ?? Math.max(0, (Date.parse(incident.resolvedAt) - Date.parse(incident.startedAt)) / 1000) } } : {}),
  }));
}

export function webhookHeaders(body: string, secret: string) {
  const payload = webhookV1.parse(JSON.parse(body));
  return {
    "Content-Type": "application/json", "User-Agent": "Pulsy/0.1.0",
    "X-Pulsy-Event": payload.event, "X-Pulsy-Delivery": payload.id,
    "Idempotency-Key": payload.id, "X-Pulsy-Timestamp": payload.timestamp,
    "X-Pulsy-Signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
  };
}
