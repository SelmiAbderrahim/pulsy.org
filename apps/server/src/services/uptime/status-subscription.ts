import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  apiStatusSubscriptionConfig, apiStatusSubscriptionRedeem, apiStatusSubscriptionRequest,
  db, uptimeEmailProvider, uptimeMonitor, uptimeStatusAnnouncement, uptimeStatusMailGate,
  uptimeStatusMailJob, uptimeStatusPage, uptimeStatusPageMonitor, uptimeStatusSubscriber,
  uptimeStatusSubscriptionConfig, type DbExecutor,
} from "@pulsy/db";
import { and, asc, count, eq, gt, inArray, isNull, lt, lte, ne, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { scheduleJob, scheduledJobs } from "node-schedule";
import type { z } from "zod";
import { decrypt, encrypt } from "../../lib/crypto";
import { escapeHtml } from "../../lib/html";
import { getTranslator, type Translator } from "../../lib/i18n";
import { isTransientSendError, isAmbiguousDeliveryError, NotificationSendError } from "../../lib/retry";
import { findEmailProviderById, sendViaProvider } from "./email-provider-service";
import { subscriptionPageUrl } from "./status-public-url";
const accepted = () => ({ outcome: "accepted" as const });
const stamp = () => new Date().toISOString();
const newToken = () => randomBytes(32).toString("base64url");
const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
const emailHash = (pageId: string, email: string) => {
  const key = process.env.ENCRYPTION_KEY; if (!key) throw new Error("Encryption unavailable");
  return createHmac("sha256", key).update(`${pageId}\0${email}`).digest("hex");
};
const invalid = (t: Translator) => new TRPCError({ code: "BAD_REQUEST", message: t("errors.statusSubscriptionInvalid") });
const missing = (t: Translator) => new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "statusPage" }) });
async function ownedPage(tx: DbExecutor, ownerId: string, pageId: string, t: Translator) {
  const [page] = await tx.select().from(uptimeStatusPage).where(and(eq(uptimeStatusPage.statusPageId, pageId), eq(uptimeStatusPage.userId, ownerId))).for("update");
  if (!page) throw missing(t); return page;
}
function usableProvider(provider: typeof uptimeEmailProvider.$inferSelect) {
  try {
    if (provider.providerType === "smtp") return !!(provider.smtpHost && provider.smtpPort && provider.smtpUsername && provider.smtpPassword && decrypt(provider.smtpPassword));
    return !!(provider.apiKey && decrypt(provider.apiKey));
  } catch { return false; }
}
async function currentConfig(tx: DbExecutor, ownerId: string, pageId: string, lockProvider = false) {
  const [config] = await tx.select().from(uptimeStatusSubscriptionConfig).where(and(eq(uptimeStatusSubscriptionConfig.userId, ownerId), eq(uptimeStatusSubscriptionConfig.statusPageId, pageId))).limit(1);
  if (!config?.enabled || !config.providerId) return null;
  const providers = tx.select().from(uptimeEmailProvider).where(and(eq(uptimeEmailProvider.userId, ownerId), eq(uptimeEmailProvider.emailProviderId, config.providerId), eq(uptimeEmailProvider.verified, true))).limit(1);
  const [provider] = await (lockProvider ? providers.for("share") : providers);
  return provider && usableProvider(provider) ? config : null;
}
async function validComponents(tx: DbExecutor, ownerId: string, pageId: string, ids: string[]) {
  if (!ids.length) return true;
  const rows = await tx.select({ id: uptimeStatusPageMonitor.id }).from(uptimeStatusPageMonitor)
    .innerJoin(uptimeStatusPage, eq(uptimeStatusPage.statusPageId, uptimeStatusPageMonitor.statusPageId))
    .innerJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeStatusPageMonitor.uptimeMonitorId))
    .where(and(eq(uptimeStatusPage.userId, ownerId), eq(uptimeMonitor.userId, ownerId), eq(uptimeStatusPageMonitor.statusPageId, pageId), inArray(uptimeStatusPageMonitor.id, ids)));
  return rows.length === ids.length;
}
export async function configureSubscriptions(ownerId: string, input: z.input<typeof apiStatusSubscriptionConfig>, t: Translator) {
  const parsed = apiStatusSubscriptionConfig.safeParse(input); if (!parsed.success || !parsed.data.confirmChange) throw invalid(t);
  const config = parsed.data;
  await db.transaction(async tx => {
    await ownedPage(tx, ownerId, config.statusPageId, t);
    if (config.enabled) {
      if (!config.providerId) throw invalid(t);
      const [provider] = await tx.select().from(uptimeEmailProvider).where(and(eq(uptimeEmailProvider.userId, ownerId), eq(uptimeEmailProvider.emailProviderId, config.providerId), eq(uptimeEmailProvider.verified, true))).for("share");
      if (!provider || !usableProvider(provider)) throw invalid(t);
    } else if (config.providerId) {
      const [provider] = await tx.select({ id: uptimeEmailProvider.emailProviderId }).from(uptimeEmailProvider).where(and(eq(uptimeEmailProvider.userId, ownerId), eq(uptimeEmailProvider.emailProviderId, config.providerId))); if (!provider) throw invalid(t);
    }
    const [previous] = await tx.select().from(uptimeStatusSubscriptionConfig).where(and(eq(uptimeStatusSubscriptionConfig.userId, ownerId), eq(uptimeStatusSubscriptionConfig.statusPageId, config.statusPageId)));
    if (previous && previous.enabled === config.enabled && previous.providerId === config.providerId && previous.messagesPerMinute === config.messagesPerMinute) return;
    const values = { enabled: config.enabled, providerId: config.providerId, messagesPerMinute: config.messagesPerMinute, version: (previous?.version ?? 0) + 1 };
    if (previous) await tx.update(uptimeStatusSubscriptionConfig).set(values).where(and(eq(uptimeStatusSubscriptionConfig.userId, ownerId), eq(uptimeStatusSubscriptionConfig.statusPageId, config.statusPageId)));
    else await tx.insert(uptimeStatusSubscriptionConfig).values({ ...values, userId: ownerId, statusPageId: config.statusPageId });
    await tx.update(uptimeStatusMailJob).set({ state: "cancelled", payloadCipher: null }).where(and(eq(uptimeStatusMailJob.userId, ownerId), eq(uptimeStatusMailJob.statusPageId, config.statusPageId), inArray(uptimeStatusMailJob.state, ["pending", "processing"])));
  });
  return readSubscriptionReadiness(ownerId, config.statusPageId, t);
}
export async function readSubscriptionReadiness(ownerId: string, pageId: string, t: Translator) {
  const [page] = await db.select({ published: uptimeStatusPage.isPublished }).from(uptimeStatusPage).where(and(eq(uptimeStatusPage.userId, ownerId), eq(uptimeStatusPage.statusPageId, pageId))); if (!page) throw missing(t);
  const [config] = await db.select().from(uptimeStatusSubscriptionConfig).where(and(eq(uptimeStatusSubscriptionConfig.userId, ownerId), eq(uptimeStatusSubscriptionConfig.statusPageId, pageId)));
  const provider = config?.providerId ? await db.query.uptimeEmailProvider.findFirst({ where: and(eq(uptimeEmailProvider.userId, ownerId), eq(uptimeEmailProvider.emailProviderId, config.providerId)) }) : undefined;
  const providerReady = Boolean(provider?.verified && usableProvider(provider));
  const ready = page.published && Boolean(config?.enabled) && providerReady;
  const subscribers = await db.select({ state: uptimeStatusSubscriber.state, count: count() }).from(uptimeStatusSubscriber).where(and(eq(uptimeStatusSubscriber.userId, ownerId), eq(uptimeStatusSubscriber.statusPageId, pageId))).groupBy(uptimeStatusSubscriber.state);
  const jobs = await db.select({ state: uptimeStatusMailJob.state, kind: uptimeStatusMailJob.kind, count: count() }).from(uptimeStatusMailJob).where(and(eq(uptimeStatusMailJob.userId, ownerId), eq(uptimeStatusMailJob.statusPageId, pageId))).groupBy(uptimeStatusMailJob.state, uptimeStatusMailJob.kind);
  const failures = await db.select({ reason: uptimeStatusMailJob.failure, count: count() }).from(uptimeStatusMailJob).where(and(eq(uptimeStatusMailJob.userId, ownerId), eq(uptimeStatusMailJob.statusPageId, pageId), eq(uptimeStatusMailJob.state, "failed"))).groupBy(uptimeStatusMailJob.failure);
  return { enabled: config?.enabled ?? false, ready, providerReady, providerId: config?.providerId ?? null, messagesPerMinute: config?.messagesPerMinute ?? 30, confirmed: subscribers.find(row => row.state === "confirmed")?.count ?? 0, pending: subscribers.find(row => row.state === "pending")?.count ?? 0, queued: jobs.filter(row => ["pending", "processing"].includes(row.state)).reduce((total, row) => total + row.count, 0), delivered: jobs.filter(row => row.state === "done" && row.kind !== "fanout").reduce((total, row) => total + row.count, 0), failures: failures.map(row => ({ reason: row.reason, count: row.count })) };
}
export async function publicSubscriptionReady(ownerId: string, pageId: string) { return !!await currentConfig(db, ownerId, pageId); }

/** Public responses deliberately conceal email existence and accepted scope. */
export async function requestSubscription(pageId: string, input: z.input<typeof apiStatusSubscriptionRequest>) {
  const parsed = apiStatusSubscriptionRequest.safeParse(input); if (!parsed.success) return accepted(); const request = parsed.data;
  await db.transaction(async tx => {
    const [page] = await tx.select().from(uptimeStatusPage).where(and(eq(uptimeStatusPage.statusPageId, pageId), eq(uptimeStatusPage.isPublished, true))).for("update"); if (!page) return;
    const config = await currentConfig(tx, page.userId, pageId); if (!config || !await validComponents(tx, page.userId, pageId, request.componentIds)) return;
    const hash = emailHash(pageId, request.email), now = stamp();
    const scope = and(eq(uptimeStatusSubscriber.userId, page.userId), eq(uptimeStatusSubscriber.statusPageId, pageId), eq(uptimeStatusSubscriber.emailHash, hash));
    const [existing] = await tx.select().from(uptimeStatusSubscriber).where(scope).for("update");
    if (existing && Date.parse(existing.requestedAt) + 900_000 > Date.now()) return;
    // Technical bound: 10,000 confirmed subscribers/page; add measured archival/fan-out capacity before increasing this technical ceiling.
    // Unconfirmed requests are untrusted input: bound them to 2,000 and evict the oldest instead of
    // refusing, so a flood of made-up addresses can neither fill the page nor lock real people out.
    if (!existing) {
      const pageScope = and(eq(uptimeStatusSubscriber.userId, page.userId), eq(uptimeStatusSubscriber.statusPageId, pageId));
      const [confirmed] = await tx.select({ value: count() }).from(uptimeStatusSubscriber).where(and(pageScope, eq(uptimeStatusSubscriber.state, "confirmed")));
      if (confirmed!.value >= 10_000) return;
      const [unconfirmed] = await tx.select({ value: count() }).from(uptimeStatusSubscriber).where(and(pageScope, ne(uptimeStatusSubscriber.state, "confirmed")));
      if (unconfirmed!.value >= 2_000) {
        const oldest = await tx.select({ id: uptimeStatusSubscriber.id }).from(uptimeStatusSubscriber).where(and(pageScope, ne(uptimeStatusSubscriber.state, "confirmed"))).orderBy(asc(uptimeStatusSubscriber.requestedAt)).limit(100);
        if (oldest.length) await tx.delete(uptimeStatusSubscriber).where(and(pageScope, inArray(uptimeStatusSubscriber.id, oldest.map(row => row.id))));
      }
    }
    const token = newToken(), version = (existing?.pendingVersion ?? 0) + 1;
    const values = { pendingVersion: version, pendingComponents: request.componentIds, pendingLanguage: request.language, confirmHash: tokenHash(token), confirmExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), requestedAt: now };
    let subscriberId: string;
    if (existing) { subscriberId = existing.id; await tx.update(uptimeStatusSubscriber).set(values).where(scope); }
    else { const [row] = await tx.insert(uptimeStatusSubscriber).values({ ...values, userId: page.userId, statusPageId: pageId, emailHash: hash, emailCipher: encrypt(request.email) }).returning({ id: uptimeStatusSubscriber.id }); subscriberId = row!.id; }
    await tx.insert(uptimeStatusMailJob).values({ userId: page.userId, statusPageId: pageId, providerId: config.providerId, configVersion: config.version, subscriberId, subscriberVersion: version, kind: "confirmation", dedupKey: `confirmation:${subscriberId}:${version}`, payloadCipher: encrypt(token), dueAt: now });
  });
  return accepted();
}
export async function redeemSubscriptionToken(pageId: string, input: z.input<typeof apiStatusSubscriptionRedeem>) {
  const parsed = apiStatusSubscriptionRedeem.safeParse(input); if (!parsed.success) return accepted(); const { action, token } = parsed.data;
  await db.transaction(async tx => {
    const [page] = await tx.select().from(uptimeStatusPage).where(eq(uptimeStatusPage.statusPageId, pageId)).for("update"); if (!page) return;
    const field = action === "confirm" ? uptimeStatusSubscriber.confirmHash : uptimeStatusSubscriber.unsubscribeHash;
    const scope = and(eq(uptimeStatusSubscriber.userId, page.userId), eq(uptimeStatusSubscriber.statusPageId, pageId), eq(field, tokenHash(token)));
    const [subscriber] = await tx.select().from(uptimeStatusSubscriber).where(scope).for("update"); if (!subscriber) return;
    if (action === "unsubscribe") {
      await tx.update(uptimeStatusSubscriber).set({ state: "unsubscribed", confirmHash: null, pendingComponents: null, unsubscribeHash: null, unsubscribeCipher: null }).where(scope);
      await tx.update(uptimeStatusMailJob).set({ state: "cancelled", payloadCipher: null }).where(and(eq(uptimeStatusMailJob.userId, page.userId), eq(uptimeStatusMailJob.subscriberId, subscriber.id), inArray(uptimeStatusMailJob.state, ["pending", "processing"]))); return;
    }
    if (!page.isPublished || !await currentConfig(tx, page.userId, pageId) || !subscriber.confirmExpiresAt || Date.parse(subscriber.confirmExpiresAt) <= Date.now() || !subscriber.pendingComponents || !await validComponents(tx, page.userId, pageId, subscriber.pendingComponents)) return;
    const unsubscribe = newToken();
    await tx.update(uptimeStatusSubscriber).set({ state: "confirmed", componentIds: subscriber.pendingComponents, language: subscriber.pendingLanguage ?? "en", confirmedVersion: subscriber.pendingVersion, confirmedAt: stamp(), pendingComponents: null, pendingLanguage: null, confirmHash: null, confirmExpiresAt: null, unsubscribeHash: tokenHash(unsubscribe), unsubscribeCipher: encrypt(unsubscribe) }).where(scope);
  });
  return accepted();
}
/** Called in the publication transaction under the same owned page lock. */
export async function enqueuePublishedStatusUpdate(tx: DbExecutor, ownerId: string, pageId: string, announcementId: string) {
  const config = await currentConfig(tx, ownerId, pageId); if (!config) return;
  await tx.insert(uptimeStatusMailJob).values({ userId: ownerId, statusPageId: pageId, providerId: config.providerId, configVersion: config.version, announcementId, kind: "fanout", dedupKey: `fanout:${announcementId}`, dueAt: stamp() }).onConflictDoNothing();
}
const jobScope = (id: string, ownerId: string) => and(eq(uptimeStatusMailJob.id, id), eq(uptimeStatusMailJob.userId, ownerId));
const leasedJobScope = (job: MailJob) => and(jobScope(job.id, job.userId), eq(uptimeStatusMailJob.state, "processing"), eq(uptimeStatusMailJob.leaseUntil, job.leaseUntil!));
const eligibleJobs = (now: string) => and(inArray(uptimeStatusMailJob.state, ["pending", "processing"]), lte(uptimeStatusMailJob.dueAt, now), or(eq(uptimeStatusMailJob.state, "pending"), isNull(uptimeStatusMailJob.leaseUntil), lte(uptimeStatusMailJob.leaseUntil, now)));
type MailJob = typeof uptimeStatusMailJob.$inferSelect;
async function jobContext(tx: DbExecutor, job: MailJob, lock = false) {
  const query = tx.select().from(uptimeStatusPage).where(and(eq(uptimeStatusPage.userId, job.userId), eq(uptimeStatusPage.statusPageId, job.statusPageId), eq(uptimeStatusPage.isPublished, true)));
  const [page] = await (lock ? query.for("share") : query);
  const config = page && await currentConfig(tx, job.userId, job.statusPageId, lock);
  return page && config && config.version === job.configVersion && config.providerId === job.providerId ? { page, config } : null;
}
async function runFanout(job: MailJob) {
  await db.transaction(async tx => {
    const context = await jobContext(tx, job, true); if (!context) { await tx.update(uptimeStatusMailJob).set({ state: "cancelled", leaseUntil: null }).where(leasedJobScope(job)); return; }
    const [announcement] = await tx.select().from(uptimeStatusAnnouncement).where(and(eq(uptimeStatusAnnouncement.userId, job.userId), eq(uptimeStatusAnnouncement.statusPageId, job.statusPageId), eq(uptimeStatusAnnouncement.id, job.announcementId!)));
    if (!announcement?.publishedAt) throw new Error("Published update unavailable");
    const rows = await tx.select().from(uptimeStatusSubscriber).where(and(eq(uptimeStatusSubscriber.userId, job.userId), eq(uptimeStatusSubscriber.statusPageId, job.statusPageId), eq(uptimeStatusSubscriber.state, "confirmed"), lte(uptimeStatusSubscriber.confirmedAt, announcement.publishedAt), job.cursor ? gt(uptimeStatusSubscriber.id, job.cursor) : undefined)).orderBy(asc(uptimeStatusSubscriber.id)).limit(100);
    for (const subscriber of rows) {
      if (subscriber.componentIds.length && !subscriber.componentIds.some(id => announcement.componentIds.includes(id))) continue;
      await tx.insert(uptimeStatusMailJob).values({ userId: job.userId, statusPageId: job.statusPageId, providerId: job.providerId, configVersion: job.configVersion, subscriberId: subscriber.id, subscriberVersion: subscriber.confirmedVersion, announcementId: announcement.id, kind: "update", dedupKey: `update:${announcement.id}:${subscriber.id}`, dueAt: stamp() }).onConflictDoNothing();
    }
    await tx.update(uptimeStatusMailJob).set({ cursor: rows.at(-1)?.id ?? job.cursor, state: rows.length === 100 ? "pending" : "done", leaseUntil: null }).where(leasedJobScope(job));
  });
}
async function reserveProvider(tx: DbExecutor, job: MailJob) {
  const now = stamp();
  await tx.insert(uptimeStatusMailGate).values({ userId: job.userId, providerId: job.providerId!, nextSendAt: now }).onConflictDoNothing();
  const [gate] = await tx.select().from(uptimeStatusMailGate).where(and(eq(uptimeStatusMailGate.userId, job.userId), eq(uptimeStatusMailGate.providerId, job.providerId!))).for("update"); if (!gate) throw new Error("Provider unavailable");
  if (gate.nextSendAt > now) return gate.nextSendAt;
  const configs = await tx.select({ limit: uptimeStatusSubscriptionConfig.messagesPerMinute }).from(uptimeStatusSubscriptionConfig).where(and(eq(uptimeStatusSubscriptionConfig.userId, job.userId), eq(uptimeStatusSubscriptionConfig.providerId, job.providerId!), eq(uptimeStatusSubscriptionConfig.enabled, true)));
  const limit = configs.reduce((lowest, config) => Math.min(lowest, config.limit), 60);
  await tx.update(uptimeStatusMailGate).set({ nextSendAt: new Date(Date.now() + Math.ceil(60_000 / limit)).toISOString() }).where(and(eq(uptimeStatusMailGate.userId, job.userId), eq(uptimeStatusMailGate.providerId, job.providerId!)));
  return null;
}
/** Page first matches configuration/redemption lock order; a lease never confers authority. */
async function currentDelivery(tx: DbExecutor, job: MailJob) {
  const context = await jobContext(tx, job, true); if (!context) return { cancelled: true } as const;
  const [subscriber] = await tx.select().from(uptimeStatusSubscriber).where(and(eq(uptimeStatusSubscriber.userId, job.userId), eq(uptimeStatusSubscriber.statusPageId, job.statusPageId), eq(uptimeStatusSubscriber.id, job.subscriberId!))).for("share");
  if (!subscriber) return { cancelled: true } as const;
  const [lease] = await tx.select({ id: uptimeStatusMailJob.id }).from(uptimeStatusMailJob).where(leasedJobScope(job)).for("share");
  if (!lease) return { cancelled: true } as const;
  if (job.kind === "confirmation") {
    if (!subscriber.confirmHash || subscriber.pendingVersion !== job.subscriberVersion || !subscriber.confirmExpiresAt || Date.parse(subscriber.confirmExpiresAt) <= Date.now() || !job.payloadCipher) return { cancelled: true } as const;
  } else if (subscriber.state !== "confirmed" || subscriber.confirmedVersion !== job.subscriberVersion || !subscriber.unsubscribeCipher) return { cancelled: true } as const;
  const [announcement] = job.announcementId ? await tx.select().from(uptimeStatusAnnouncement).where(and(eq(uptimeStatusAnnouncement.userId, job.userId), eq(uptimeStatusAnnouncement.statusPageId, job.statusPageId), eq(uptimeStatusAnnouncement.id, job.announcementId))) : [];
  if (job.kind === "update" && (!announcement?.publishedAt || subscriber.componentIds.length && !subscriber.componentIds.some(id => announcement.componentIds.includes(id)))) return { cancelled: true } as const;
  return { ...context, subscriber, announcement };
}
async function deliveryContext(job: MailJob) {
  return db.transaction(async tx => {
    const context = await currentDelivery(tx, job); if ("cancelled" in context) return context;
    const until = await reserveProvider(tx, job); if (until) return { until } as const;
    await tx.update(uptimeStatusMailJob).set({ attempts: job.attempts + 1 }).where(leasedJobScope(job));
    return context;
  });
}
async function recordDelivery(job: MailJob) {
  await db.transaction(async tx => {
    const scope = and(jobScope(job.id, job.userId), eq(uptimeStatusMailJob.leaseUntil, job.leaseUntil!), inArray(uptimeStatusMailJob.state, ["processing", "cancelled"]));
    const [current] = await tx.select({ state: uptimeStatusMailJob.state }).from(uptimeStatusMailJob).where(scope).for("update");
    if (!current) return;
    // An accepted in-flight send is recorded without reviving cancelled work.
    await tx.update(uptimeStatusMailJob).set({ state: current.state === "cancelled" ? "cancelled" : "done", deliveredAt: stamp(), leaseUntil: null, payloadCipher: null, failure: null }).where(scope);
  });
}
async function runJob(candidate: { id: string; userId: string }) {
  const scope = jobScope(candidate.id, candidate.userId);
  const job = await db.transaction(async tx => {
    const [row] = await tx.select().from(uptimeStatusMailJob).where(and(scope, eligibleJobs(stamp()))).for("update", { skipLocked: true }); if (!row) return null;
    const leaseUntil = new Date(Date.now() + 300_000).toISOString();
    await tx.update(uptimeStatusMailJob).set({ state: "processing", leaseUntil }).where(scope); return { ...row, leaseUntil };
  }); if (!job) return;
  const leased = leasedJobScope(job);
  try {
    if (job.kind === "fanout") { await runFanout(job); return; }
    if (job.attempts >= 4) { await db.update(uptimeStatusMailJob).set({ state: "failed", failure: "delivery_failed", leaseUntil: null, payloadCipher: null }).where(leased); return; }
    const context = await deliveryContext(job);
    if ("cancelled" in context) { await db.update(uptimeStatusMailJob).set({ state: "cancelled", payloadCipher: null, leaseUntil: null }).where(leased); return; }
    if ("until" in context) { await db.update(uptimeStatusMailJob).set({ state: "pending", dueAt: context.until, leaseUntil: null }).where(leased); return; }
    const { page, subscriber, announcement } = context;
    const t = getTranslator(job.kind === "confirmation" ? subscriber.pendingLanguage ?? "en" : subscriber.language);
    const token = decrypt(job.kind === "confirmation" ? job.payloadCipher! : subscriber.unsubscribeCipher!);
    const url = `${subscriptionPageUrl(page)}#subscription=${job.kind === "confirmation" ? "confirm" : "unsubscribe"}%3A${token}%3A${encodeURIComponent(page.statusPageId)}`;
    const language = job.kind === "confirmation" ? subscriber.pendingLanguage ?? "en" : subscriber.language;
    const title = job.kind === "confirmation" ? t("subscriptionMail.confirmSubject", { page: page.title }) : t("subscriptionMail.updateSubject", { page: page.title });
    const explanation = job.kind === "confirmation" ? t("subscriptionMail.confirmBody") : announcement!.text;
    const action = job.kind === "confirmation" ? t("subscriptionMail.confirmAction") : t("subscriptionMail.unsubscribeAction");
    const html = `<!DOCTYPE html><html lang="${language}" dir="${language === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"></head><body><h1>${escapeHtml(page.title)}</h1>${announcement ? `<h2>${escapeHtml(announcement.title)}</h2><p>${escapeHtml(t(`subscriptionStage.${announcement.stage}`))}</p>` : ""}<p style="white-space:pre-wrap">${escapeHtml(explanation)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(action)}</a></p></body></html>`;
    const provider = await findEmailProviderById(job.providerId!, job.userId, true);
    if (!provider.verified) throw new Error("Provider unavailable");
    const latest = await db.transaction(tx => currentDelivery(tx, job));
    if ("cancelled" in latest) {
      await db.update(uptimeStatusMailJob).set({ state: "cancelled", payloadCipher: null, leaseUntil: null }).where(leased);
      return;
    }
    await sendViaProvider(provider, decrypt(subscriber.emailCipher), title, html);
    // No recipient, token, provider response body or user-authored text is stored in receipts/errors.
    await recordDelivery(job);
  } catch (error) {
    const uncertain = isAmbiguousDeliveryError(error);
    const transient = !uncertain && isTransientSendError(error), attempt = job.attempts + 1;
    const failure = uncertain ? "delivery_uncertain" as const : error instanceof NotificationSendError ? transient ? "provider_temporary" as const : "provider_rejected" as const : "delivery_failed" as const;
    await db.update(uptimeStatusMailJob).set({ state: transient && attempt < 4 ? "pending" : "failed", failure, leaseUntil: null, dueAt: transient && attempt < 4 ? new Date(Date.now() + [30_000, 120_000, 600_000][Math.min(attempt - 1, 2)]!).toISOString() : job.dueAt, ...(!transient || attempt >= 4 ? { payloadCipher: null } : {}) }).where(leased);
  }
}
/** Bounded global enumeration; each claim and related query reuses the persisted owner. */
export async function runStatusSubscriptions() {
  // Technical bound: 25 jobs/scan, 100 subscribers/fan-out transaction and 4 concurrent sends; increase only after provider/capacity measurements.
  const jobs = await db.select({ id: uptimeStatusMailJob.id, userId: uptimeStatusMailJob.userId }).from(uptimeStatusMailJob).where(eligibleJobs(stamp())).orderBy(asc(uptimeStatusMailJob.dueAt), asc(uptimeStatusMailJob.id)).limit(25);
  for (let offset = 0; offset < jobs.length; offset += 4) await Promise.all(jobs.slice(offset, offset + 4).map(runJob));
}
let scanning: Promise<void> | null = null;
let retaining: Promise<void> | null = null;
export async function stopStatusSubscriptionWorker() {
  scheduledJobs["uptime-status-subscriptions"]?.cancel();
  scheduledJobs["uptime-status-subscription-retention"]?.cancel();
  await Promise.all([scanning, retaining]);
}
export function startStatusSubscriptionWorker() {
  scheduledJobs["uptime-status-subscriptions"]?.cancel();
  scheduledJobs["uptime-status-subscription-retention"]?.cancel();
  scheduleJob("uptime-status-subscriptions", "*/5 * * * * *", () => {
    if (scanning) return;
    scanning = runStatusSubscriptions().catch(() => { console.error("[uptime] Status subscription scan could not finish"); }).finally(() => { scanning = null; });
  });
  scheduleJob("uptime-status-subscription-retention", "0 25 3 * * *", () => {
    if (retaining) return;
    retaining = (async () => {
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    try {
      await db.delete(uptimeStatusMailJob).where(and(inArray(uptimeStatusMailJob.state, ["done", "failed", "cancelled"]), lt(uptimeStatusMailJob.createdAt, cutoff)));
      await db.delete(uptimeStatusSubscriber).where(and(inArray(uptimeStatusSubscriber.state, ["pending", "unsubscribed"]), lt(uptimeStatusSubscriber.requestedAt, cutoff)));
    } catch { console.error("[uptime] Status subscription retention could not finish"); }
    })().finally(() => { retaining = null; });
  });
}
