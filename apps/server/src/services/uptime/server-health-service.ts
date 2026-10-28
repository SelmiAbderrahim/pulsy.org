import { DEFAULT_FAILURE_THRESHOLD } from "@pulsy/db/monitor-defaults";
import { recordServerReport } from "./server-health-alerts";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { db, user, apiServerConfiguration, apiServerSample, uptimeMonitor, uptimeMonitorChannelBinding, uptimeServer, uptimeServerMetric, type DbExecutor } from "@pulsy/db";
import { encrypt, decrypt } from "../../lib/crypto";
import type { Translator } from "../../lib/i18n";
import { assertOwnedMonitorChannels } from "./monitor-operations";
import type { z } from "zod";
import { serverInstallation } from "./server-health-installation";

function serverMetricRetentionDays(): number {
  const days = Number(process.env.CHECK_LOG_RETENTION_DAYS ?? 30);
  return Number.isSafeInteger(days) && days > 0 ? days : 30;
}

export const serverScope = (monitorId: string, userId: string) => and(eq(uptimeServer.monitorId, monitorId), eq(uptimeServer.userId, userId));
export const serverMonitorScope = (monitorId: string, userId: string) => and(eq(uptimeMonitor.uptimeMonitorId, monitorId), eq(uptimeMonitor.userId, userId), eq(uptimeMonitor.monitorType, "server"));
const metricScope = (monitorId: string, userId: string) => and(eq(uptimeServerMetric.monitorId, monitorId), eq(uptimeServerMetric.userId, userId));
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const credential = () => { const token = randomBytes(32).toString("base64url"); return { token, tokenHash: hash(token), tokenCipher: encrypt(token) }; };
const notFound = (t: Translator) => new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });

export async function createServerForUser(input: z.output<typeof apiServerConfiguration>, userId: string, t: Translator, locale: typeof uptimeServer.$inferSelect.locale = "en") {
  const config = apiServerConfiguration.parse(input);
  const interval = config.interval;
  const { token, ...secret } = credential();
  const monitor = await db.transaction(async tx => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
    await assertOwnedMonitorChannels(tx, userId, config.channelIds, t);
    const [row] = await tx.insert(uptimeMonitor).values({ name: config.name, userId, monitorType: "server", url: "", interval, active: config.active, tags: config.tags, failureThreshold: DEFAULT_FAILURE_THRESHOLD, nextCheckAt: null }).returning();
    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: t("errors.internal") });
    await tx.insert(uptimeServer).values({ monitorId: row.uptimeMonitorId, userId, ...secret, locale, thresholds: config.thresholds, excludedFilesystems: config.excludedFilesystems });
    if (config.channelIds.length) await tx.insert(uptimeMonitorChannelBinding).values(config.channelIds.map(channelId => ({ userId, monitorId: row.uptimeMonitorId, channelId })));
    return row;
  });
  return { monitor, token };
}

/** Deliberate projection: neither encrypted credentials nor lookup hashes escape. */
export async function readServerForUser(monitorId: string, userId: string, t: Translator) {
  const [row] = await db.select({ monitorId: uptimeServer.monitorId, thresholds: uptimeServer.thresholds, excludedFilesystems: uptimeServer.excludedFilesystems,
    conditions: uptimeServer.conditions, lastReceivedAt: uptimeServer.lastReceivedAt, nextDeadline: uptimeServer.nextDeadline, agent: uptimeServer.agent,
    interval: uptimeMonitor.interval, active: uptimeMonitor.active, createdAt: uptimeMonitor.createdAt })
    .from(uptimeServer).innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeServer.monitorId))
    .where(and(serverScope(monitorId, userId), serverMonitorScope(monitorId, userId))).limit(1);
  if (!row) throw notFound(t);
  const retentionDays = serverMetricRetentionDays();
  const [latest] = await db.select({ receivedAt: uptimeServerMetric.receivedAt, sample: uptimeServerMetric.sample }).from(uptimeServerMetric)
    .where(and(metricScope(monitorId, userId), gte(uptimeServerMetric.receivedAt, new Date(Date.now() - retentionDays * 86400000).toISOString())))
    .orderBy(desc(uptimeServerMetric.receivedAt)).limit(1);
  return { ...row, retentionDays, latest: latest ?? null, installation: serverInstallation() };
}

export async function rotateServerCredential(monitorId: string, userId: string, t: Translator) {
  const { token, ...secret } = credential();
  await db.transaction(async tx => {
    const [monitor] = await tx.select({ id: uptimeMonitor.uptimeMonitorId }).from(uptimeMonitor).where(serverMonitorScope(monitorId, userId)).for("update");
    if (!monitor) throw notFound(t);
    const [row] = await tx.update(uptimeServer).set(secret).where(serverScope(monitorId, userId)).returning({ id: uptimeServer.monitorId });
    if (!row) throw notFound(t);
  });
  return { token };
}

/** Pause/resume does not invent a healthy sample or resolve an incident. */
export async function rearmResumedServer(executor: DbExecutor, before: typeof uptimeMonitor.$inferSelect, after: typeof uptimeMonitor.$inferSelect, now = new Date()): Promise<string | null | undefined> {
  if (before.monitorType !== "server" || before.active === after.active) return;
  const [config] = await executor.select().from(uptimeServer).where(serverScope(before.uptimeMonitorId, before.userId)).for("update");
  if (!config) return;
  const nextDeadline = after.active && config.lastReceivedAt ? new Date(now.getTime() + after.interval * 3000).toISOString() : null;
  await executor.update(uptimeServer).set({ nextDeadline, missingHealthy: 0, conditions: config.conditions.map(condition => ({ ...condition, violating: 0, healthy: 0 })) }).where(serverScope(before.uptimeMonitorId, before.userId));
  await executor.update(uptimeMonitor).set({ nextCheckAt: nextDeadline }).where(serverMonitorScope(before.uptimeMonitorId, before.userId));
  return nextDeadline;
}

export async function updateServerForUser(input: z.output<typeof apiServerConfiguration> & { monitorId: string }, userId: string, t: Translator, locale: typeof uptimeServer.$inferSelect.locale = "en") {
  const { monitorId, ...raw } = input;
  const config = apiServerConfiguration.parse(raw);
  const interval = config.interval;
  return db.transaction(async tx => {
    const [before] = await tx.select().from(uptimeMonitor).where(serverMonitorScope(monitorId, userId)).for("update");
    if (!before) throw notFound(t);
    await assertOwnedMonitorChannels(tx, userId, config.channelIds, t);
    const [state] = await tx.select().from(uptimeServer).where(serverScope(monitorId, userId)).for("update");
    if (!state) throw notFound(t);
    const nextDeadline = config.active && state.lastReceivedAt ? new Date(Date.parse(state.lastReceivedAt) + interval * 3000).toISOString() : null;
    await tx.update(uptimeServer).set({ locale, thresholds: config.thresholds, excludedFilesystems: config.excludedFilesystems, nextDeadline }).where(serverScope(monitorId, userId));
    const [after] = await tx.update(uptimeMonitor).set({ name: config.name, interval, active: config.active, tags: config.tags, nextCheckAt: nextDeadline }).where(serverMonitorScope(monitorId, userId)).returning();
    if (!after) throw notFound(t);
    await tx.delete(uptimeMonitorChannelBinding).where(and(eq(uptimeMonitorChannelBinding.userId, userId), eq(uptimeMonitorChannelBinding.monitorId, monitorId)));
    if (config.channelIds.length) await tx.insert(uptimeMonitorChannelBinding).values(config.channelIds.map(channelId => ({ userId, monitorId, channelId })));
    const rearmed = await rearmResumedServer(tx, before, after);
    return rearmed === undefined ? after : { ...after, nextCheckAt: rearmed };
  });
}

export async function serverHistoryForUser(input: { monitorId: string; from: string; to: string; limit: number }, userId: string, t: Translator) {
  const config = await readServerForUser(input.monitorId, userId, t);
  const from = new Date(Math.max(Date.parse(input.from), Date.now() - config.retentionDays * 86400000)).toISOString();
  return db.select({ receivedAt: uptimeServerMetric.receivedAt, sample: uptimeServerMetric.sample }).from(uptimeServerMetric)
    .where(and(metricScope(input.monitorId, userId), gte(uptimeServerMetric.receivedAt, from), lte(uptimeServerMetric.receivedAt, input.to)))
    .orderBy(desc(uptimeServerMetric.receivedAt)).limit(Math.min(1000, Math.max(1, input.limit)));
}

type Receipt = { statusCode: number; outcome: string; interval?: number; retryAfter?: number; excludedFilesystems?: string[] };
export async function receiveServerSample(token: string, payload: unknown, now = new Date()): Promise<Receipt> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { statusCode: 401, outcome: "unavailable" };
  const parsed = apiServerSample.safeParse(payload);
  if (!parsed.success || JSON.stringify(parsed.data).includes(token)) return { statusCode: 400, outcome: "invalid" };
  const sample = parsed.data, stamp = now.toISOString(), tokenHash = hash(token);
  if (Date.parse(sample.sampledAt) > now.getTime() + 300000 || Date.parse(sample.sampledAt) < now.getTime() - 86400000) return { statusCode: 400, outcome: "invalid" };
  // Capability lookup is the only unscoped read; all subsequent reads/writes use its owner.
  const [target] = await db.select({ monitorId: uptimeServer.monitorId, userId: uptimeServer.userId }).from(uptimeServer).where(eq(uptimeServer.tokenHash, tokenHash)).limit(1);
  if (!target) return { statusCode: 401, outcome: "unavailable" };
  const result = await db.transaction<Receipt>(async tx => {
    const [monitor] = await tx.select().from(uptimeMonitor).where(serverMonitorScope(target.monitorId, target.userId)).for("update");
    const [config] = await tx.select().from(uptimeServer).where(and(serverScope(target.monitorId, target.userId), eq(uptimeServer.tokenHash, tokenHash))).for("update");
    if (!monitor || !config) return { statusCode: 401, outcome: "unavailable" };
    const expected = Buffer.from(decrypt(config.tokenCipher)), supplied = Buffer.from(token);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return { statusCode: 401, outcome: "unavailable" };
    const interval = monitor.interval;
    const response = { interval, excludedFilesystems: config.excludedFilesystems };
    // An older entry may acquire these locks after a newer receipt or scan.
    // Ignore it before admission counters or persisted health can move backward.
    if ([config.lastReceivedAt, monitor.lastCheckedAt].some(value => value !== null && Date.parse(value) > now.getTime())) {
      return { statusCode: 200, outcome: "ignored", ...response };
    }
    const admissionAt = Math.max(now.getTime(), config.rateWindowAt ? Date.parse(config.rateWindowAt) : now.getTime());
    const reset = !config.rateWindowAt || admissionAt - Date.parse(config.rateWindowAt) >= 60000;
    if (!reset && config.rateCount >= 12) return { statusCode: 429, outcome: "limited", retryAfter: 60, ...response };
    await tx.update(uptimeServer).set({ rateWindowAt: reset ? new Date(admissionAt).toISOString() : config.rateWindowAt, rateCount: reset ? 1 : config.rateCount + 1 }).where(serverScope(target.monitorId, target.userId));
    if (config.lastSampledAt && Date.parse(sample.sampledAt) <= Date.parse(config.lastSampledAt) || config.lastBootId === sample.bootId && sample.sequence <= (config.lastSequence ?? 0)) return { statusCode: 200, outcome: "ignored", ...response };
    if (config.lastReceivedAt && now.getTime() - Date.parse(config.lastReceivedAt) < interval * 1000) return { statusCode: 429, outcome: "limited", retryAfter: Math.ceil((Date.parse(config.lastReceivedAt) + interval * 1000 - now.getTime()) / 1000), ...response };
    const nextDeadline = monitor.active ? new Date(now.getTime() + interval * 3000).toISOString() : null;
    await tx.insert(uptimeServerMetric).values({ monitorId: target.monitorId, userId: target.userId, receivedAt: stamp, sample });
    await tx.update(uptimeServer).set({ lastReceivedAt: stamp, lastSampledAt: sample.sampledAt, lastBootId: sample.bootId, lastSequence: sample.sequence, agent: sample.agent, nextDeadline }).where(serverScope(target.monitorId, target.userId));
    await recordServerReport(tx, monitor, { ...config, nextDeadline }, sample, now);
    return { statusCode: 200, outcome: "accepted", ...response };
  });
  return result;
}

export async function cleanupServerMetrics(): Promise<number> {
  const owners = await db.selectDistinct({ userId: uptimeServer.userId }).from(uptimeServer);
  let removed = 0;
  for (const { userId } of owners) {
    const retentionDays = serverMetricRetentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    for (;;) {
      const batch = await db.select({ id: uptimeServerMetric.id }).from(uptimeServerMetric).where(and(eq(uptimeServerMetric.userId, userId), lt(uptimeServerMetric.receivedAt, cutoff))).limit(1000);
      if (!batch.length) break;
      await db.delete(uptimeServerMetric).where(and(eq(uptimeServerMetric.userId, userId), inArray(uptimeServerMetric.id, batch.map(row => row.id))));
      removed += batch.length;
    }
  }
  return removed;
}
