import { describe, expect, it } from "vitest";
import { apiKey, db, uptimeEmailProvider, uptimeNotificationChannel, uptimeShareLink, uptimeSlaReportSubscription } from "@pulsy/db";
import { createTestApiKey, createTestEmailProvider, createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { ACCOUNT_CAPS, assertBelowCap } from "../../../lib/account-caps";
import { getTranslator } from "../../../lib/i18n";

useCleanDatabase();
// Uniform safety bounds apply equally to every account.
const t = getTranslator("en");
const rejects = (promise: Promise<unknown>, max: number) => expect(promise).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining(String(max)) });
const rows = <T>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));

describe("assertBelowCap", () => {
	it("allows below the ceiling and rejects at it, with a localized message", () => {
		expect(() => assertBelowCap(ACCOUNT_CAPS.apiKeys.max - 1, "apiKeys", t)).not.toThrow();
		expect(() => assertBelowCap(ACCOUNT_CAPS.apiKeys.max, "apiKeys", t)).toThrow(/20 active API keys/);
		expect(() => assertBelowCap(ACCOUNT_CAPS.apiKeys.max, "apiKeys", getTranslator("fr"))).toThrow(/20 clés API/);
	});
});

describe("per-account ceilings on create paths", () => {
	it("share links: only live links count, and other accounts are unaffected", async () => {
		const owner = await createTestUser(); const other = await createTestUser();
		const monitor = await createTestMonitor(owner.id); const caller = authedCaller(owner);
		const future = new Date(Date.now() + 86_400_000).toISOString(); const past = new Date(Date.now() - 86_400_000).toISOString();
		await db.insert(uptimeShareLink).values([
			...rows(ACCOUNT_CAPS.shareLinks.max - 1, (i) => ({ token: `live-${i}`, monitorIds: [monitor.uptimeMonitorId], expiresAt: future, userId: owner.id })),
			...rows(50, (i) => ({ token: `old-${i}`, monitorIds: [monitor.uptimeMonitorId], expiresAt: past, userId: owner.id })),
		]);
		await expect(caller.uptimeMonitor.share.create({ uptimeMonitorIds: [monitor.uptimeMonitorId], expiresInDays: 7 })).resolves.toBeDefined(); // 199 live -> 200th allowed
		await rejects(caller.uptimeMonitor.share.create({ uptimeMonitorIds: [monitor.uptimeMonitorId], expiresInDays: 7 }), ACCOUNT_CAPS.shareLinks.max);
		const otherMonitor = await createTestMonitor(other.id);
		await expect(authedCaller(other).uptimeMonitor.share.create({ uptimeMonitorIds: [otherMonitor.uptimeMonitorId], expiresInDays: 7 })).resolves.toBeDefined();
	});

	it("notification channels", async () => {
		const owner = await createTestUser(); const caller = authedCaller(owner);
		await db.insert(uptimeNotificationChannel).values(rows(ACCOUNT_CAPS.notificationChannels.max, (i) => ({ userId: owner.id, uptimeMonitorId: null, channelType: "webhook" as const, webhookUrl: `https://hooks.example.com/${i}` })));
		await rejects(caller.uptimeMonitor.channel.createDefault({ channelType: "webhook", webhookUrl: "https://hooks.example.com/new" }), ACCOUNT_CAPS.notificationChannels.max);
		const monitor = await createTestMonitor(owner.id);
		await rejects(caller.uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: "https://hooks.example.com/new" }), ACCOUNT_CAPS.notificationChannels.max);
	});

	it("email providers and SLA subscriptions", async () => {
		const owner = await createTestUser(); const caller = authedCaller(owner);
		await db.insert(uptimeEmailProvider).values(rows(ACCOUNT_CAPS.emailProviders.max, (i) => ({ userId: owner.id, name: `p${i}`, providerType: "resend" as const, fromAddress: "a@pulsy.test" })));
		await rejects(caller.uptimeMonitor.emailProvider.create({ name: "extra", providerType: "resend", apiKey: "re_test_key", fromAddress: "a@pulsy.test" }), ACCOUNT_CAPS.emailProviders.max);
		const provider = await createTestEmailProvider(owner.id, { verified: true });
		await db.insert(uptimeSlaReportSubscription).values(rows(ACCOUNT_CAPS.slaSubscriptions.max, () => ({ userId: owner.id, recipientAddresses: ["ops@pulsy.test"], emailProviderId: provider.emailProviderId })));
		await rejects(caller.uptimeMonitor.slaReport.subscription.upsert({ recipientAddresses: ["ops@pulsy.test"], emailProviderId: provider.emailProviderId, active: true }), ACCOUNT_CAPS.slaSubscriptions.max);
	});

	it("API keys: revoked keys do not count; the cap bounds the multiplied rate limit", async () => {
		const owner = await createTestUser(); const caller = authedCaller(owner);
		for (let i = 0; i < ACCOUNT_CAPS.apiKeys.max; i++) await createTestApiKey(owner.id, { revokedAt: i === 0 ? new Date().toISOString() : null });
		await expect(caller.apiKey.create({ name: "uses the freed slot" })).resolves.toMatchObject({ plaintext: expect.stringMatching(/^pul_/) });
		await rejects(caller.apiKey.create({ name: "one too many" }), ACCOUNT_CAPS.apiKeys.max);
		expect((await db.select().from(apiKey)).filter((key) => key.userId === owner.id && !key.revokedAt)).toHaveLength(ACCOUNT_CAPS.apiKeys.max);
	});
});
