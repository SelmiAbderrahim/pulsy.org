import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createTestEmailProvider,
	createTestMonitor,
	createTestSlaReportSubscription,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";
import { mockFetch } from "../../../../test/fetch-mock";
import { authedCaller } from "../../../../test/trpc-caller";

useCleanDatabase();

describe("uptimeMonitor.slaReport.data", () => {
	it("returns a report model", async () => {
		const u = await createTestUser();
		const m = await createTestMonitor(u.id);
		const caller = authedCaller({ id: u.id, email: u.email });
		const report = await caller.uptimeMonitor.slaReport.data({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		expect(report.uptimeMonitorId).toBe(m.uptimeMonitorId);
		expect(report.stats).toBeDefined();
		expect(report.periodLabel).toBe("30d");
	});

	it("rejects a cross-user monitor with NOT_FOUND", async () => {
		const owner = await createTestUser();
		const other = await createTestUser();
		const m = await createTestMonitor(owner.id);
		const caller = authedCaller({ id: other.id, email: other.email });
		await expect(
			caller.uptimeMonitor.slaReport.data({
				uptimeMonitorId: m.uptimeMonitorId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects days outside 1–366 via Zod", async () => {
		const u = await createTestUser();
		const m = await createTestMonitor(u.id);
		const caller = authedCaller({ id: u.id, email: u.email });
		await expect(
			caller.uptimeMonitor.slaReport.data({
				uptimeMonitorId: m.uptimeMonitorId,
				days: 999,
			}),
		).rejects.toBeTruthy();
	});
});

describe("uptimeMonitor.slaReport.subscription", () => {
	it("creates, lists, updates and removes a subscription", async () => {
		const u = await createTestUser();
		const m = await createTestMonitor(u.id, { name: "Bound" });
		const provider = await createTestEmailProvider(u.id);
		const caller = authedCaller({ id: u.id, email: u.email });

		const created = await caller.uptimeMonitor.slaReport.subscription.upsert({
			uptimeMonitorId: m.uptimeMonitorId,
			recipientAddresses: ["ops@x.test"],
			emailProviderId: provider.emailProviderId,
		});
		expect(created.userId).toBe(u.id);

		const list = await caller.uptimeMonitor.slaReport.subscription.list();
		expect(list).toHaveLength(1);
		expect(list[0]?.monitorName).toBe("Bound");

		const updated = await caller.uptimeMonitor.slaReport.subscription.upsert({
			slaReportSubscriptionId: created.slaReportSubscriptionId,
			recipientAddresses: ["new@x.test", "two@x.test"],
			emailProviderId: provider.emailProviderId,
			active: false,
		});
		expect(updated.recipientAddresses).toEqual(["new@x.test", "two@x.test"]);
		expect(updated.active).toBe(false);
		expect(updated.uptimeMonitorId).toBeNull();

		const removed = await caller.uptimeMonitor.slaReport.subscription.remove({
			slaReportSubscriptionId: created.slaReportSubscriptionId,
		});
		expect(removed.success).toBe(true);
	});

	it("lists an account-wide subscription with a null monitor name", async () => {
		const u = await createTestUser();
		const provider = await createTestEmailProvider(u.id);
		await createTestSlaReportSubscription(u.id, {
			emailProviderId: provider.emailProviderId,
		});
		const caller = authedCaller({ id: u.id, email: u.email });
		const list = await caller.uptimeMonitor.slaReport.subscription.list();
		expect(list[0]?.uptimeMonitorId).toBeNull();
		expect(list[0]?.monitorName).toBeNull();
	});

	it("rejects a provider owned by another user", async () => {
		const u = await createTestUser();
		const stranger = await createTestUser();
		const provider = await createTestEmailProvider(stranger.id);
		const caller = authedCaller({ id: u.id, email: u.email });
		await expect(
			caller.uptimeMonitor.slaReport.subscription.upsert({
				recipientAddresses: ["ops@x.test"],
				emailProviderId: provider.emailProviderId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects a monitor owned by another user", async () => {
		const u = await createTestUser();
		const stranger = await createTestUser();
		const provider = await createTestEmailProvider(u.id);
		const m = await createTestMonitor(stranger.id);
		const caller = authedCaller({ id: u.id, email: u.email });
		await expect(
			caller.uptimeMonitor.slaReport.subscription.upsert({
				uptimeMonitorId: m.uptimeMonitorId,
				recipientAddresses: ["ops@x.test"],
				emailProviderId: provider.emailProviderId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects updating a subscription that is not the caller's", async () => {
		const u = await createTestUser();
		const stranger = await createTestUser();
		const provider = await createTestEmailProvider(u.id);
		const strangerProvider = await createTestEmailProvider(stranger.id);
		const sub = await createTestSlaReportSubscription(stranger.id, {
			emailProviderId: strangerProvider.emailProviderId,
		});
		const caller = authedCaller({ id: u.id, email: u.email });
		await expect(
			caller.uptimeMonitor.slaReport.subscription.upsert({
				slaReportSubscriptionId: sub.slaReportSubscriptionId,
				recipientAddresses: ["ops@x.test"],
				emailProviderId: provider.emailProviderId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects removing a missing subscription", async () => {
		const u = await createTestUser();
		const caller = authedCaller({ id: u.id, email: u.email });
		await expect(
			caller.uptimeMonitor.slaReport.subscription.remove({
				slaReportSubscriptionId: "nope",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects an invalid recipient email via Zod", async () => {
		const u = await createTestUser();
		const provider = await createTestEmailProvider(u.id);
		const caller = authedCaller({ id: u.id, email: u.email });
		await expect(
			caller.uptimeMonitor.slaReport.subscription.upsert({
				recipientAddresses: ["not-an-email"],
				emailProviderId: provider.emailProviderId,
			}),
		).rejects.toBeTruthy();
	});

	it("sends immediately via sendNow", async () => {
		const fx = mockFetch();
		try {
			const u = await createTestUser();
			const provider = await createTestEmailProvider(u.id);
			await createTestMonitor(u.id);
			const sub = await createTestSlaReportSubscription(u.id, {
				emailProviderId: provider.emailProviderId,
			});
			const caller = authedCaller({ id: u.id, email: u.email });
			const result = await caller.uptimeMonitor.slaReport.subscription.sendNow(
				{ slaReportSubscriptionId: sub.slaReportSubscriptionId },
			);
			expect(result.skipped).toBe(false);
			expect(result.emailsSent).toBeGreaterThan(0);
		} finally {
			fx.restore();
		}
	});

	it("rejects sendNow for a subscription that is not the caller's", async () => {
		const u = await createTestUser();
		const stranger = await createTestUser();
		const strangerProvider = await createTestEmailProvider(stranger.id);
		const sub = await createTestSlaReportSubscription(stranger.id, {
			emailProviderId: strangerProvider.emailProviderId,
		});
		const caller = authedCaller({ id: u.id, email: u.email });
		await expect(
			caller.uptimeMonitor.slaReport.subscription.sendNow({
				slaReportSubscriptionId: sub.slaReportSubscriptionId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
