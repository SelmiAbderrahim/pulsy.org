import { db, uptimeCheckLog, uptimeIncident, uptimeSlaReportSubscription } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createTestEmailProvider,
	createTestMonitor,
	createTestSlaReportSubscription,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";
import { mockFetch } from "../../../../test/fetch-mock";
import { getTranslator } from "../../../lib/i18n";
import type { SlaReportModel } from "../sla-report-service";
import {
	buildSlaReportModel,
	processSubscription,
	renderSlaReportEmailHtml,
	renderSlaReportPdf,
	runMonthlySlaReports,
	slaReportPdfUrl,
} from "../sla-report-service";

useCleanDatabase();

const t = getTranslator("en");
const NOW = new Date("2026-06-15T12:00:00.000Z");

beforeEach(() => {
});

afterEach(() => {
});

async function seedLog(
	monitorId: string,
	status: "up" | "down",
	responseTime: number | null,
	createdAt?: string,
): Promise<void> {
	await db.insert(uptimeCheckLog).values({
		uptimeMonitorId: monitorId,
		status,
		responseTime,
		httpStatus: status === "up" ? 200 : 503,
		...(createdAt ? { createdAt } : {}),
	});
}

function baseModel(overrides: Partial<SlaReportModel> = {}): SlaReportModel {
	return {
		uptimeMonitorId: "mon_1",
		monitorName: "Example",
		url: "https://example.com",
		windowFrom: "2026-05-01T00:00:00.000Z",
		windowTo: "2026-05-31T23:59:59.999Z",
		windowDays: 31,
		periodLabel: "2026-05",
		generatedAt: "2026-06-01T06:00:00.000Z",
		stats: {
			totalChecks: 100,
			successfulChecks: 99,
			failedChecks: 1, degradedChecks: 0, availabilityPercentage: 99, slowPercentage: 0,
			avgResponseTime: 120,
			minResponseTime: 80,
			maxResponseTime: 400,
			p95ResponseTime: 350,
			uptimePercentage: 99,
		},
		incidents: {
			count: 1,
			totalDowntimeSeconds: 300,
			longestIncidentSeconds: 300,
		},
		dailyUptime: [
			{ date: "2026-05-01", uptimePercentage: 100, totalChecks: 10 },
		],
		...overrides,
	};
}

describe("buildSlaReportModel", () => {
	it("assembles a days-window model for the owner", async () => {
		const u = await createTestUser();
		const m = await createTestMonitor(u.id, { name: "Acme" });
		const withinWindow = new Date(NOW.getTime() - 86_400_000).toISOString();
		await seedLog(m.uptimeMonitorId, "up", 100, withinWindow);
		await seedLog(m.uptimeMonitorId, "down", null, withinWindow);

		const model = await buildSlaReportModel({
			monitorId: m.uptimeMonitorId,
			userId: u.id,
			window: { kind: "days", days: 30 },
			t,
			now: NOW,
		});

		expect(model.monitorName).toBe("Acme");
		expect(model.periodLabel).toBe("30d");
		expect(model.windowDays).toBe(30);
		expect(model.stats.totalChecks).toBe(2);
		expect(model.stats.uptimePercentage).toBe(50);
	});

	it("assembles a calendar-month range model", async () => {
		const u = await createTestUser();
		const m = await createTestMonitor(u.id);
		const model = await buildSlaReportModel({
			monitorId: m.uptimeMonitorId,
			userId: u.id,
			window: {
				kind: "range",
				from: "2026-05-01T00:00:00.000Z",
				to: "2026-05-31T23:59:59.999Z",
			},
			t,
			now: NOW,
		});
		expect(model.periodLabel).toBe("2026-05");
		expect(model.windowDays).toBe(31);
	});

	it("defaults `now` to the current time when omitted", async () => {
		const u = await createTestUser();
		const m = await createTestMonitor(u.id);
		const model = await buildSlaReportModel({
			monitorId: m.uptimeMonitorId,
			userId: u.id,
			window: { kind: "days", days: 7 },
			t,
		});
		expect(model.generatedAt).toBeTruthy();
	});

	it("throws NOT_FOUND for another user's monitor", async () => {
		const owner = await createTestUser();
		const other = await createTestUser();
		const m = await createTestMonitor(owner.id);
		await expect(
			buildSlaReportModel({
				monitorId: m.uptimeMonitorId,
				userId: other.id,
				window: { kind: "days", days: 30 },
				t,
			}),
		).rejects.toThrowError(/not found/i);
	});
});

describe("renderSlaReportPdf", () => {
	it("returns a non-empty PDF buffer (incidents + daily present)", async () => {
		const pdf = await renderSlaReportPdf(baseModel(), t);
		expect(pdf.length).toBeGreaterThan(0);
		expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
	});

	it("renders the empty branches (no incidents, no daily, null metrics)", async () => {
		const pdf = await renderSlaReportPdf(
			baseModel({
				stats: {
					totalChecks: 0,
					successfulChecks: 0,
					failedChecks: 0, degradedChecks: 0, availabilityPercentage: null, slowPercentage: null,
					avgResponseTime: null,
					minResponseTime: null,
					maxResponseTime: null,
					p95ResponseTime: null,
					uptimePercentage: 100,
				},
				incidents: {
					count: 0,
					totalDowntimeSeconds: 0,
					longestIncidentSeconds: 0,
				},
				dailyUptime: [],
			}),
			t,
		);
		expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
	});
});

describe("renderSlaReportEmailHtml", () => {
	it("escapes the monitor name and links to the PDF route", () => {
		const html = renderSlaReportEmailHtml(
			baseModel({
				monitorName: '<img src=x onerror="alert(1)">',
				uptimeMonitorId: "mon_xyz",
				windowDays: 30,
			}),
			t,
		);
		expect(html).toContain("&lt;img");
		expect(html).not.toContain("<img src=x");
		expect(html).toContain("/api/reports/sla/mon_xyz.pdf?days=30");
	});
});

describe("slaReportPdfUrl", () => {
	it("builds an encoded download URL", () => {
		expect(slaReportPdfUrl("abc", 30)).toContain(
			"/api/reports/sla/abc.pdf?days=30",
		);
	});
});

describe("processSubscription", () => {
	it("sends to every recipient across all monitors and stamps lastSentAt", async () => {
		const fetch = mockFetch();
		try {
			const u = await createTestUser();
			const provider = await createTestEmailProvider(u.id);
			await createTestMonitor(u.id);
			await createTestMonitor(u.id);
			const sub = await createTestSlaReportSubscription(u.id, {
				uptimeMonitorId: null,
				recipientAddresses: ["a@x.test", "b@x.test"],
				emailProviderId: provider.emailProviderId,
			});

			const result = await processSubscription(sub, NOW);

			expect(result.skipped).toBe(false);
			expect(result.monitorsReported).toBe(2);
			// 2 monitors × 2 recipients.
			expect(result.emailsSent).toBe(4);
			expect(fetch.calls).toHaveLength(4);

			const stored = await db.query.uptimeSlaReportSubscription.findFirst({
				where: eq(
					uptimeSlaReportSubscription.slaReportSubscriptionId,
					sub.slaReportSubscriptionId,
				),
			});
			expect(stored?.lastSentAt).toBeTruthy();
		} finally {
			fetch.restore();
		}
	});

	it("reports only the bound monitor when uptimeMonitorId is set", async () => {
		const fetch = mockFetch();
		try {
			const u = await createTestUser();
			const provider = await createTestEmailProvider(u.id);
			const m = await createTestMonitor(u.id);
			await createTestMonitor(u.id); // a second, unbound monitor
			const sub = await createTestSlaReportSubscription(u.id, {
				uptimeMonitorId: m.uptimeMonitorId,
				recipientAddresses: ["a@x.test"],
				emailProviderId: provider.emailProviderId,
			});
			const result = await processSubscription(sub, NOW);
			expect(result.monitorsReported).toBe(1);
			expect(result.emailsSent).toBe(1);
		} finally {
			fetch.restore();
		}
	});

	it("continues past a failing send so later recipients still receive", async () => {
		let call = 0;
		const fetch = mockFetch(() => {
			call += 1;
			return new Response("", { status: call === 1 ? 500 : 200 });
		});
		try {
			const u = await createTestUser();
			const provider = await createTestEmailProvider(u.id);
			const m = await createTestMonitor(u.id);
			const sub = await createTestSlaReportSubscription(u.id, {
				uptimeMonitorId: m.uptimeMonitorId,
				recipientAddresses: ["fail@x.test", "ok@x.test"],
				emailProviderId: provider.emailProviderId,
			});
			const result = await processSubscription(sub, NOW);
			expect(fetch.calls).toHaveLength(2);
			expect(result.emailsSent).toBe(1);
		} finally {
			fetch.restore();
		}
	});

	it("skips when the subscription has no provider", async () => {
		const fetch = mockFetch();
		try {
			const u = await createTestUser();
			await createTestMonitor(u.id);
			const sub = await createTestSlaReportSubscription(u.id, {
				emailProviderId: null,
			});
			const result = await processSubscription(sub, NOW);
			expect(result.skipped).toBe(true);
			expect(fetch.calls).toHaveLength(0);
		} finally {
			fetch.restore();
		}
	});

	it("skips when the provider belongs to another user", async () => {
		const fetch = mockFetch();
		try {
			const owner = await createTestUser();
			const stranger = await createTestUser();
			// Provider exists (FK satisfied) but is owned by `stranger`.
			const provider = await createTestEmailProvider(stranger.id);
			await createTestMonitor(owner.id);
			const sub = await createTestSlaReportSubscription(owner.id, {
				emailProviderId: provider.emailProviderId,
			});
			const result = await processSubscription(sub, NOW);
			expect(result.skipped).toBe(true);
			expect(fetch.calls).toHaveLength(0);
		} finally {
			fetch.restore();
		}
	});

	it("does not stamp a subscription when the supplied owner does not match its row", async () => {
		const fetch = mockFetch();
		try {
			const owner = await createTestUser();
			const other = await createTestUser();
			const target = await createTestSlaReportSubscription(owner.id);
			const provider = await createTestEmailProvider(other.id);
			const monitor = await createTestMonitor(other.id);

			await processSubscription(
				{
					...target,
					userId: other.id,
					uptimeMonitorId: monitor.uptimeMonitorId,
					emailProviderId: provider.emailProviderId,
				},
				NOW,
			);

			const stored = await db.query.uptimeSlaReportSubscription.findFirst({
				where: eq(
					uptimeSlaReportSubscription.slaReportSubscriptionId,
					target.slaReportSubscriptionId,
				),
			});
			expect(stored?.lastSentAt).toBeNull();
		} finally {
			fetch.restore();
		}
	});
});

describe("runMonthlySlaReports", () => {
	it("processes active subscriptions and skips inactive ones", async () => {
		const fetch = mockFetch();
		try {
			const u = await createTestUser();
			const provider = await createTestEmailProvider(u.id);
			await createTestMonitor(u.id);
			const active = await createTestSlaReportSubscription(u.id, {
				emailProviderId: provider.emailProviderId,
				active: true,
			});
			const inactive = await createTestSlaReportSubscription(u.id, {
				emailProviderId: provider.emailProviderId,
				active: false,
			});

			await runMonthlySlaReports(NOW);

			const activeRow = await db.query.uptimeSlaReportSubscription.findFirst({
				where: eq(
					uptimeSlaReportSubscription.slaReportSubscriptionId,
					active.slaReportSubscriptionId,
				),
			});
			const inactiveRow = await db.query.uptimeSlaReportSubscription.findFirst({
				where: eq(
					uptimeSlaReportSubscription.slaReportSubscriptionId,
					inactive.slaReportSubscriptionId,
				),
			});
			expect(activeRow?.lastSentAt).toBeTruthy();
			expect(inactiveRow?.lastSentAt).toBeNull();
			expect(fetch.calls.length).toBeGreaterThan(0);
		} finally {
			fetch.restore();
		}
	});

	it("defaults `now` to the current time", async () => {
		// No subscriptions → no-op, exercises the default-arg path.
		await expect(runMonthlySlaReports()).resolves.toBeUndefined();
	});

	it("logs and continues when a subscription fails to process", async () => {
		const u = await createTestUser();
		const provider = await createTestEmailProvider(u.id);
		await createTestMonitor(u.id);
		await createTestSlaReportSubscription(u.id, {
			emailProviderId: provider.emailProviderId,
		});
		// An invalid `now` makes the prior-month computation throw inside
		// processSubscription; the run must swallow it and resolve.
		await expect(
			runMonthlySlaReports(new Date("not-a-date")),
		).resolves.toBeUndefined();
	});
});

// Touch the incident path inside a built model so downtime aggregation is
// exercised end-to-end alongside the builder.
describe("buildSlaReportModel + incidents", () => {
	it("includes incident downtime in the model", async () => {
		const u = await createTestUser();
		const m = await createTestMonitor(u.id);
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: m.uptimeMonitorId,
			status: "resolved",
			startedAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
			resolvedAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
			durationSeconds: 600,
		});
		const model = await buildSlaReportModel({
			monitorId: m.uptimeMonitorId,
			userId: u.id,
			window: { kind: "days", days: 30 },
			t,
			now: NOW,
		});
		expect(model.incidents.count).toBe(1);
		expect(model.incidents.totalDowntimeSeconds).toBe(600);
	});
});
