import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { db, uptimeStatusPage, uptimeStatusPageMonitor, uptimeStatusAnnouncement, uptimeStatusSubscriber, uptimeStatusMailJob, uptimeStatusMailGate, uptimeEmailProvider } from "@pulsy/db";
import { createTestUser, createTestMonitor, createTestEmailProvider, useCleanDatabase } from "../../../../test/db";
import { and, eq } from "drizzle-orm";
import { NotificationSendError } from "../../../lib/retry";
import { getTranslator } from "../../../lib/i18n";
import { encrypt } from "../../../lib/crypto";
import { configureSubscriptions, readSubscriptionReadiness, requestSubscription, redeemSubscriptionToken, runStatusSubscriptions } from "../status-subscription";
import { saveAnnouncementDraft, previewAnnouncement, publishAnnouncement } from "../status-communication";
const transport = vi.hoisted(() => vi.fn());
const beforeProviderLookup = vi.hoisted(() => vi.fn());
vi.mock("../email-provider-service", async importOriginal => {
  const actual = await importOriginal<typeof import("../email-provider-service")>();
  return { ...actual, sendViaProvider: transport, findEmailProviderById: async (...args: Parameters<typeof actual.findEmailProviderById>) => { await beforeProviderLookup(); return actual.findEmailProviderById(...args); } };
});
useCleanDatabase(); const t = getTranslator("en");
afterEach(() => vi.useRealTimers());
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); transport.mockReset().mockResolvedValue("local-fixture-receipt"); beforeProviderLookup.mockReset().mockResolvedValue(undefined); });
async function fixture() {
  const owner = await createTestUser(), other = await createTestUser();
  const monitor = await createTestMonitor(owner.id);
  const [page] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "subscribers", title: "Customer status", isPublished: true }).returning();
  const [member] = await db.insert(uptimeStatusPageMonitor).values({ statusPageId: page!.statusPageId, uptimeMonitorId: monitor.uptimeMonitorId }).returning();
  const provider = await createTestEmailProvider(owner.id, { verified: true, apiKey: encrypt("fixture-provider-secret") });
  await configureSubscriptions(owner.id, { statusPageId: page!.statusPageId, enabled: true, providerId: provider.emailProviderId, messagesPerMinute: 60, confirmChange: true }, t);
  return { owner, other, monitor, page: page!, member: member!, provider };
}
function token(kind: "confirm" | "unsubscribe") {
  const bodies = transport.mock.calls.map(call => String(call[3]));
  const match = bodies.join("\n").match(new RegExp(`#subscription=${kind}%3A([A-Za-z0-9_-]+)`));
  expect(match, `missing ${kind} capability in local mail`).not.toBeNull(); return match![1]!;
}
describe("private provider-backed status subscriptions", () => {
  it("reports an unusable encrypted provider as unready without accepting mail work", async () => {
    const fx = await fixture(); await db.update(uptimeEmailProvider).set({ apiKey: "corrupt-ciphertext" }).where(and(eq(uptimeEmailProvider.userId, fx.owner.id), eq(uptimeEmailProvider.emailProviderId, fx.provider.emailProviderId)));
    expect(await readSubscriptionReadiness(fx.owner.id, fx.page.statusPageId, t)).toMatchObject({ ready: false, providerReady: false });
    expect(await requestSubscription(fx.page.statusPageId, { email: "person@fixtures.invalid", componentIds: [], language: "en" })).toEqual({ outcome: "accepted" });
    await runStatusSubscriptions(); expect(transport).not.toHaveBeenCalled();
  });

  it("does not automatically resend an ambiguous email delivery after a timeout", async () => {
    const fx = await fixture(); await requestSubscription(fx.page.statusPageId, { email: "person@fixtures.invalid", componentIds: [], language: "en" });
    const error = new Error("provider echoed fixture-provider-secret"); error.name = "TimeoutError"; transport.mockRejectedValueOnce(error);
    await runStatusSubscriptions(); vi.setSystemTime(Date.now() + 600_000); await runStatusSubscriptions();
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await db.select().from(uptimeStatusMailJob).where(eq(uptimeStatusMailJob.userId, fx.owner.id)))[0]).toMatchObject({ state: "failed", failure: "delivery_uncertain" });
  });

  it("uses neutral responses, confirmation, per-page email deduplication and private safe readiness", async () => {
    const fx = await fixture();
    expect(await requestSubscription(fx.page.statusPageId, { email: "PERSON@fixtures.invalid", componentIds: [fx.member.id], language: "en" })).toEqual({ outcome: "accepted" });
    expect(await requestSubscription(fx.page.statusPageId, { email: "person@fixtures.invalid", componentIds: [fx.member.id], language: "en" })).toEqual({ outcome: "accepted" });
    await runStatusSubscriptions(); expect(transport).toHaveBeenCalledTimes(1);
    expect((await readSubscriptionReadiness(fx.owner.id, fx.page.statusPageId, t)).confirmed).toBe(0);
    const confirm = token("confirm"); await redeemSubscriptionToken(fx.page.statusPageId, { action: "confirm", token: confirm });
    await redeemSubscriptionToken(fx.page.statusPageId, { action: "confirm", token: confirm });
    const ready = await readSubscriptionReadiness(fx.owner.id, fx.page.statusPageId, t); expect(ready.confirmed).toBe(1);
    expect(JSON.stringify(ready)).not.toContain("person@"); expect(JSON.stringify(ready)).not.toContain("fixture-provider-secret");
    await expect(readSubscriptionReadiness(fx.other.id, fx.page.statusPageId, t)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("queues one matching published update, keeps drafts private, and honours unsubscribe", async () => {
    const fx = await fixture(); await requestSubscription(fx.page.statusPageId, { email: "person@fixtures.invalid", componentIds: [fx.member.id], language: "en" });
    await runStatusSubscriptions(); await redeemSubscriptionToken(fx.page.statusPageId, { action: "confirm", token: token("confirm") }); transport.mockClear(); vi.setSystemTime(Date.now() + 1100);
    const draft = await saveAnnouncementDraft(fx.owner.id, { statusPageId: fx.page.statusPageId, title: "Incident update", text: "Investigating safely", stage: "investigating", componentIds: [fx.member.id] }, t);
    await runStatusSubscriptions(); expect(transport).not.toHaveBeenCalled();
    const preview = await previewAnnouncement(fx.owner.id, draft.id, t);
    await Promise.all([publishAnnouncement(fx.owner.id, draft.id, preview.revision, t), publishAnnouncement(fx.owner.id, draft.id, preview.revision, t)]);
    await runStatusSubscriptions(); await runStatusSubscriptions(); expect(transport).toHaveBeenCalledTimes(1);
    const unsubscribe = token("unsubscribe"); await redeemSubscriptionToken(fx.page.statusPageId, { action: "unsubscribe", token: unsubscribe });
    const next = await saveAnnouncementDraft(fx.owner.id, { statusPageId: fx.page.statusPageId, title: "Follow-up", text: "Monitoring", stage: "monitoring", componentIds: [fx.member.id] }, t);
    await publishAnnouncement(fx.owner.id, next.id, (await previewAnnouncement(fx.owner.id, next.id, t)).revision, t);
    await runStatusSubscriptions(); await runStatusSubscriptions(); expect(transport).toHaveBeenCalledTimes(1);
    expect((await readSubscriptionReadiness(fx.owner.id, fx.page.statusPageId, t)).confirmed).toBe(0);
  });
  it("requires explicit owned verified provider changes and never exposes pending subscriber records publicly", async () => {
    const fx = await fixture(); const foreign = await createTestEmailProvider(fx.other.id, { verified: true });
    await expect(configureSubscriptions(fx.owner.id, { statusPageId: fx.page.statusPageId, enabled: true, providerId: foreign.emailProviderId, messagesPerMinute: 30, confirmChange: true }, t)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(configureSubscriptions(fx.owner.id, { statusPageId: fx.page.statusPageId, enabled: false, providerId: fx.provider.emailProviderId, messagesPerMinute: 30, confirmChange: false }, t)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const unrelated = await createTestUser(); const [foreignPage] = await db.insert(uptimeStatusPage).values({ userId: unrelated.id, slug: "foreign", title: "Foreign", isPublished: true }).returning();
    expect(await redeemSubscriptionToken(foreignPage!.statusPageId, { action: "confirm", token: "a".repeat(43) })).toEqual({ outcome: "accepted" });
    expect(await requestSubscription(fx.page.statusPageId, { email: "person@fixtures.invalid", componentIds: ["foreign-component"], language: "en" })).toEqual({ outcome: "accepted" });
    await runStatusSubscriptions(); expect(transport).not.toHaveBeenCalled();
    expect(await db.select().from(uptimeStatusAnnouncement)).toHaveLength(0);
  });
  it("keeps old tokens harmless across scope reconfirmation and expiry, with no retrospective updates", async () => {
    const fx = await fixture();
    await requestSubscription(fx.page.statusPageId, { email: "person@fixtures.invalid", componentIds: [fx.member.id], language: "en" }); await runStatusSubscriptions();
    const firstConfirm = token("confirm"); await redeemSubscriptionToken(fx.page.statusPageId, { action: "confirm", token: firstConfirm });
    const [first] = await db.select().from(uptimeStatusSubscriber).where(eq(uptimeStatusSubscriber.userId, fx.owner.id));
    const { decrypt } = await import("../../../lib/crypto"); const oldUnsubscribe = decrypt(first!.unsubscribeCipher!);
    vi.setSystemTime(Date.now() + 900_001); transport.mockClear();
    await requestSubscription(fx.page.statusPageId, { email: "person@fixtures.invalid", componentIds: [], language: "de" }); await runStatusSubscriptions();
    const secondConfirm = token("confirm"); expect(secondConfirm).not.toBe(firstConfirm);
    await redeemSubscriptionToken(fx.page.statusPageId, { action: "confirm", token: secondConfirm });
    await redeemSubscriptionToken(fx.page.statusPageId, { action: "unsubscribe", token: oldUnsubscribe });
    await redeemSubscriptionToken(fx.page.statusPageId, { action: "confirm", token: firstConfirm });
    const [current] = await db.select().from(uptimeStatusSubscriber).where(eq(uptimeStatusSubscriber.userId, fx.owner.id));
    expect(current).toMatchObject({ state: "confirmed", componentIds: [], language: "de", confirmedVersion: 2 });
    vi.setSystemTime(Date.now() + 900_001); transport.mockClear();
    await requestSubscription(fx.page.statusPageId, { email: "person@fixtures.invalid", componentIds: [fx.member.id], language: "en" }); await runStatusSubscriptions();
    const expired = token("confirm"); vi.setSystemTime(Date.now() + 86_400_000);
    await redeemSubscriptionToken(fx.page.statusPageId, { action: "confirm", token: expired });
    expect((await db.select().from(uptimeStatusSubscriber).where(eq(uptimeStatusSubscriber.userId, fx.owner.id)))[0]).toMatchObject({ confirmedVersion: 2, componentIds: [] });
  });
  it("retries transient provider failures after durable backoff without exposing echoed recipients or secrets", async () => {
    const fx = await fixture(); await requestSubscription(fx.page.statusPageId, { email: "person@fixtures.invalid", componentIds: [], language: "en" });
    transport.mockRejectedValueOnce(new NotificationSendError("echo person@fixtures.invalid fixture-provider-secret", 429));
    await runStatusSubscriptions(); expect(transport).toHaveBeenCalledTimes(1);
    const [retry] = await db.select().from(uptimeStatusMailJob).where(eq(uptimeStatusMailJob.userId, fx.owner.id));
    expect(retry).toMatchObject({ state: "pending", attempts: 1, failure: "provider_temporary" });
    expect(Date.parse(retry!.dueAt) - Date.now()).toBe(30_000);
    await runStatusSubscriptions(); expect(transport).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 30_000); await runStatusSubscriptions(); expect(transport).toHaveBeenCalledTimes(2);
    const rows = await db.select().from(uptimeStatusMailJob).where(eq(uptimeStatusMailJob.userId, fx.owner.id)); expect(rows[0]).toMatchObject({ state: "done", attempts: 2, payloadCipher: null });
    expect(JSON.stringify(rows)).not.toContain("person@"); expect(JSON.stringify(rows)).not.toContain("fixture-provider-secret");
  });
  it("cancels previous-provider jobs and enforces a provider-wide pace across pages", async () => {
    const fx = await fixture(); const [secondPage] = await db.insert(uptimeStatusPage).values({ userId: fx.owner.id, slug: "second", title: "Second", isPublished: true }).returning();
    await configureSubscriptions(fx.owner.id, { statusPageId: secondPage!.statusPageId, enabled: true, providerId: fx.provider.emailProviderId, messagesPerMinute: 30, confirmChange: true }, t);
    await requestSubscription(fx.page.statusPageId, { email: "one@fixtures.invalid", componentIds: [], language: "en" });
    await requestSubscription(secondPage!.statusPageId, { email: "two@fixtures.invalid", componentIds: [], language: "en" });
    await Promise.all([runStatusSubscriptions(), runStatusSubscriptions()]); expect(transport).toHaveBeenCalledTimes(1);
    const [gate] = await db.select().from(uptimeStatusMailGate).where(eq(uptimeStatusMailGate.userId, fx.owner.id)); expect(Date.parse(gate!.nextSendAt) - Date.now()).toBe(2000);
    await configureSubscriptions(fx.owner.id, { statusPageId: fx.page.statusPageId, enabled: false, providerId: fx.provider.emailProviderId, messagesPerMinute: 30, confirmChange: true }, t);
    const pending = await db.select().from(uptimeStatusMailJob).where(and(eq(uptimeStatusMailJob.userId, fx.owner.id), eq(uptimeStatusMailJob.statusPageId, fx.page.statusPageId)));
    expect(pending.every(job => ["cancelled", "done"].includes(job.state))).toBe(true);
  });

  it("bounds unconfirmed requests by evicting the oldest instead of locking real subscribers out, and never touches confirmed ones", async () => {
    const fx = await fixture();
    const base = { userId: fx.owner.id, statusPageId: fx.page.statusPageId };
    await db.insert(uptimeStatusSubscriber).values([
      { ...base, emailHash: "confirmed-real", emailCipher: encrypt("real@fixtures.invalid"), state: "confirmed", requestedAt: "2026-01-01T00:00:00.000Z" },
      ...Array.from({ length: 2000 }, (_, index) => ({ ...base, emailHash: `fake-${index}`, emailCipher: encrypt(`fake${index}@fixtures.invalid`), state: "pending" as const, requestedAt: new Date(Date.UTC(2026, 5, 1) + index * 1000).toISOString() })),
    ]);
    await requestSubscription(fx.page.statusPageId, { email: "newcomer@fixtures.invalid", componentIds: [], language: "en" });
    const rows = await db.select().from(uptimeStatusSubscriber).where(eq(uptimeStatusSubscriber.statusPageId, fx.page.statusPageId));
    expect(rows.filter(row => row.state === "confirmed")).toHaveLength(1);
    const unconfirmed = rows.filter(row => row.state !== "confirmed");
    expect(unconfirmed.length).toBeLessThanOrEqual(2000);
    expect(unconfirmed.some(row => row.emailHash === "fake-0")).toBe(false); // oldest evicted
    expect(unconfirmed.some(row => row.emailHash === "fake-1999")).toBe(true);
    expect(await db.select().from(uptimeStatusMailJob).where(eq(uptimeStatusMailJob.kind, "confirmation"))).toHaveLength(1); // the newcomer's confirmation was queued
  });
});

it("builds mail capabilities from PUBLIC_WEB_URL even for a verified custom domain", async () => {
  const fx = await fixture();
  await db.update(uptimeStatusPage).set({ customDomain: "status.customer.invalid", domainVerified: true }).where(and(eq(uptimeStatusPage.userId, fx.owner.id), eq(uptimeStatusPage.statusPageId, fx.page.statusPageId)));
  await requestSubscription(fx.page.statusPageId, { email: "person@fixtures.invalid", componentIds: [], language: "en" });
  await runStatusSubscriptions();
  const { PUBLIC_WEB_URL } = await import("../../../lib/auth-config");
  const html = String(transport.mock.calls[0]![3]);
  expect(html).toContain(new URL(PUBLIC_WEB_URL).origin);
  expect(html).not.toContain("status.customer.invalid");
  expect(html).toContain("#subscription=confirm%3A");
});

it("accepts a 101-component subscription subset under the bounded JSON contract", async () => {
  const { apiStatusSubscriptionRequest } = await import("@pulsy/db");
  expect(apiStatusSubscriptionRequest.safeParse({ email: "person@fixtures.invalid", componentIds: Array.from({ length: 101 }, (_, index) => `component-${index}`), language: "en" }).success).toBe(true);
});
it.each(["disable", "unsubscribe", "unpublish"] as const)("does not send when %s commits during provider lookup", async action => {
  const fx = await fixture();
  await requestSubscription(fx.page.statusPageId, { email: "person@fixtures.invalid", componentIds: [], language: "en" });
  await runStatusSubscriptions();
  await redeemSubscriptionToken(fx.page.statusPageId, { action: "confirm", token: token("confirm") });
  transport.mockClear(); vi.setSystemTime(Date.now() + 1100);
  const draft = await saveAnnouncementDraft(fx.owner.id, { statusPageId: fx.page.statusPageId, title: "Update", text: "Reviewed public update", stage: "monitoring", componentIds: [fx.member.id] }, t);
  await publishAnnouncement(fx.owner.id, draft.id, (await previewAnnouncement(fx.owner.id, draft.id, t)).revision, t);
  await runStatusSubscriptions();
  let release!: () => void, announce!: () => void;
  const ready = new Promise<void>(resolve => { announce = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  beforeProviderLookup.mockImplementationOnce(async () => { announce(); await gate; });
  const delivery = runStatusSubscriptions(); await ready;
  try {
    if (action === "disable") await configureSubscriptions(fx.owner.id, { statusPageId: fx.page.statusPageId, enabled: false, providerId: fx.provider.emailProviderId, messagesPerMinute: 60, confirmChange: true }, t);
    else if (action === "unpublish") await db.update(uptimeStatusPage).set({ isPublished: false }).where(and(eq(uptimeStatusPage.userId, fx.owner.id), eq(uptimeStatusPage.statusPageId, fx.page.statusPageId)));
    else {
      const { decrypt } = await import("../../../lib/crypto");
      const [subscriber] = await db.select().from(uptimeStatusSubscriber).where(and(eq(uptimeStatusSubscriber.userId, fx.owner.id), eq(uptimeStatusSubscriber.statusPageId, fx.page.statusPageId)));
      await redeemSubscriptionToken(fx.page.statusPageId, { action: "unsubscribe", token: decrypt(subscriber!.unsubscribeCipher!) });
    }
  } finally { release(); }
  await delivery;
  expect(transport).not.toHaveBeenCalled();
  const jobs = await db.select().from(uptimeStatusMailJob).where(and(eq(uptimeStatusMailJob.userId, fx.owner.id), eq(uptimeStatusMailJob.kind, "update")));
  expect(jobs[0]).toMatchObject({ state: "cancelled", deliveredAt: null });
});

it("records an accepted in-flight send without reviving work cancelled during transport", async () => {
  const fx = await fixture();
  await requestSubscription(fx.page.statusPageId, { email: "person@fixtures.invalid", componentIds: [], language: "en" });
  let release!: () => void, announce!: () => void;
  const ready = new Promise<void>(resolve => { announce = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  transport.mockImplementationOnce(async () => { announce(); await gate; return "local-receipt"; });
  const delivery = runStatusSubscriptions(); await ready;
  try { await configureSubscriptions(fx.owner.id, { statusPageId: fx.page.statusPageId, enabled: false, providerId: fx.provider.emailProviderId, messagesPerMinute: 60, confirmChange: true }, t); }
  finally { release(); }
  await delivery;
  const [job] = await db.select().from(uptimeStatusMailJob).where(and(eq(uptimeStatusMailJob.userId, fx.owner.id), eq(uptimeStatusMailJob.kind, "confirmation")));
  expect(job).toMatchObject({ state: "cancelled", payloadCipher: null, failure: null });
  expect(job!.deliveredAt).not.toBeNull();
  vi.setSystemTime(Date.now() + 600000); await runStatusSubscriptions(); expect(transport).toHaveBeenCalledTimes(1);
});

it("waits for a subscriber being removed without locking its cascading mail job first", async () => {
  const fx = await fixture();
  await requestSubscription(fx.page.statusPageId, { email: "person@fixtures.invalid", componentIds: [], language: "en" });
  const [subscriber] = await db.select().from(uptimeStatusSubscriber).where(eq(uptimeStatusSubscriber.userId, fx.owner.id));
  const [job] = await db.select().from(uptimeStatusMailJob).where(eq(uptimeStatusMailJob.userId, fx.owner.id));
  let release!: () => void, announce!: () => void;
  const ready = new Promise<void>(resolve => { announce = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const removal = db.transaction(async tx => {
    const scope = and(eq(uptimeStatusSubscriber.userId, fx.owner.id), eq(uptimeStatusSubscriber.id, subscriber!.id));
    await tx.select().from(uptimeStatusSubscriber).where(scope).for("update"); announce(); await gate;
    await tx.delete(uptimeStatusSubscriber).where(scope);
  });
  await ready;
  const delivery = runStatusSubscriptions(), settled = Promise.allSettled([removal, delivery]);
  let blockedProbes = 0;
  try {
    await vi.waitFor(async () => {
      const [current] = await db.select().from(uptimeStatusMailJob).where(eq(uptimeStatusMailJob.id, job!.id));
      expect(current!.state).toBe("processing");
    });
    for (let attempt = 0; attempt < 20; attempt++) {
      const free = await db.transaction(tx => tx.select({ id: uptimeStatusMailJob.id }).from(uptimeStatusMailJob)
        .where(and(eq(uptimeStatusMailJob.userId, fx.owner.id), eq(uptimeStatusMailJob.id, job!.id))).for("update", { skipLocked: true }));
      if (!free.length) blockedProbes++;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally { release(); }
  expect((await settled).every(result => result.status === "fulfilled")).toBe(true);
  expect(blockedProbes).toBe(0);
  expect(transport).not.toHaveBeenCalled();
  expect(await db.select().from(uptimeStatusMailJob).where(eq(uptimeStatusMailJob.userId, fx.owner.id))).toEqual([]);
});
