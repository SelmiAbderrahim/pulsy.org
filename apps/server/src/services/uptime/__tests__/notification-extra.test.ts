import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestChannel,
	createTestMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";
import { mockFetch } from "../../../../test/fetch-mock";
import type { UptimeMonitor } from "../monitor-service";
import {
	dispatchTlsExpiryNotifications,
	sendSlackNotification,
} from "../notification-service";

useCleanDatabase();

let userId: string;
let monitor: UptimeMonitor;

beforeEach(async () => {
	const u = await createTestUser();
	userId = u.id;
	monitor = await createTestMonitor(userId, {
		name: "Extra App",
		url: "https://extra.app/path",
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getStatusEmoji default arm: an unknown/"pending" statusAfter falls through
// to the default "ℹ️" emoji (exercised via the Slack sender, which embeds it).
// ---------------------------------------------------------------------------

describe("sendSlackNotification — unknown status emoji", () => {
	it("uses the default emoji for a non up/down/degraded status", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "slack",
				webhookUrl: "https://hooks.slack.test/in",
			});

			await sendSlackNotification(channel, monitor, {
				statusChangeId: "sc-pending",
				uptimeMonitorId: monitor.uptimeMonitorId,
				statusBefore: "up",
				statusAfter: "pending",
				httpStatus: null,
				responseTime: null,
				reason: "transitional",
				createdAt: new Date().toISOString(),
			});

			expect(fx.calls).toHaveLength(1);
			const body = JSON.parse(fx.calls[0]?.body as string);
			const text = body.attachments[0].blocks[0].text.text as string;
			// "pending" is not up/down/degraded → getStatusEmoji default ℹ️.
			expect(text).toContain("ℹ️");
			expect(text).toContain("PENDING");
		} finally {
			fx.restore();
		}
	});
});

// ---------------------------------------------------------------------------
// dispatchTlsExpiryNotifications discord arm: a discord channel with TLS-expiry
// notifications enabled and an expiry under its threshold POSTs to the webhook.
// ---------------------------------------------------------------------------

describe("dispatchTlsExpiryNotifications — discord channel", () => {
	it("posts to the discord webhook when expiry is under the threshold", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "discord",
				webhookUrl: "https://discord.test/webhooks/abc",
				notifyOnTlsExpiry: true,
				tlsExpiryThresholdDays: 14,
			});

			await dispatchTlsExpiryNotifications(monitor, {
				expiresInDays: 3,
				expiresAt: new Date("2026-07-01T00:00:00.000Z").toISOString(),
				issuer: "Test CA",
				valid: true,
			});

			expect(fx.calls).toHaveLength(1);
			expect(fx.calls[0]?.url).toBe(channel.webhookUrl);
			const body = JSON.parse(fx.calls[0]?.body as string);
			// Discord sender embeds the monitor name in its payload.
			expect(JSON.stringify(body)).toContain(monitor.name);
		} finally {
			fx.restore();
		}
	});
});

// ---------------------------------------------------------------------------
// dispatchTlsExpiryNotifications slack arm: a SUCCEEDING slack send reaches the
// `break` after the slack case (the existing suite only exercises the slack arm
// when the send throws, which jumps straight to the catch).
// ---------------------------------------------------------------------------

describe("dispatchTlsExpiryNotifications — slack channel succeeds", () => {
	it("posts to the slack webhook when expiry is under the threshold", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "slack",
				webhookUrl: "https://hooks.slack.test/incoming",
				notifyOnTlsExpiry: true,
				tlsExpiryThresholdDays: 14,
			});

			await dispatchTlsExpiryNotifications(monitor, {
				expiresInDays: 2,
				expiresAt: new Date("2026-07-01T00:00:00.000Z").toISOString(),
				issuer: "Test CA",
				valid: true,
			});

			expect(fx.calls).toHaveLength(1);
			expect(fx.calls[0]?.url).toBe(channel.webhookUrl);
		} finally {
			fx.restore();
		}
	});
});
