import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestChannel,
	createTestEmailProvider,
	createTestMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";
import { mockFetch } from "../../../../test/fetch-mock";
import { encrypt } from "../../../lib/crypto";
import type { UptimeMonitor } from "../monitor-service";
import { db, uptimeNotificationLog } from "@pulsy/db";
import { eq } from "drizzle-orm";
import {
	buildEmailContent,
	dispatchNotifications,
	dispatchTlsExpiryNotifications,
	sendDiscordNotification,
	sendSlackNotification,
	sendTelegramNotification,
	sendWebhookNotification,
} from "../notification-service";

// No-retry dispatch options for tests that assert immediate outcome counts
// (a transient failure would otherwise back off 30s/2m/10m).
const NO_RETRY = { delaysMs: [] as number[] };

async function logRowsFor(uptimeMonitorId: string) {
	return db
		.select()
		.from(uptimeNotificationLog)
		.where(eq(uptimeNotificationLog.uptimeMonitorId, uptimeMonitorId));
}

// nodemailer is mocked so any SMTP email path never opens a real connection.
const sendMail = vi.fn(async () => ({ messageId: "test" }));
vi.mock("nodemailer", () => ({
	default: {
		createTransport: () => ({ sendMail, close: vi.fn() }),
	},
}));

useCleanDatabase();

let userId: string;
let monitor: UptimeMonitor;

beforeEach(async () => {
	const u = await createTestUser();
	userId = u.id;
	monitor = await createTestMonitor(userId, {
		name: "My <App>",
		url: "https://my.app/path",
		status: "up",
	});
	sendMail.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

function downChange(
	overrides: Partial<{
		statusBefore: string;
		statusAfter: string;
		httpStatus: number | null;
		responseTime: number | null;
	}> = {},
) {
	return {
		statusChangeId: "sc1",
		uptimeMonitorId: monitor.uptimeMonitorId,
		statusBefore: overrides.statusBefore ?? "up",
		statusAfter: overrides.statusAfter ?? "down",
		httpStatus: overrides.httpStatus === undefined ? 503 : overrides.httpStatus,
		responseTime:
			overrides.responseTime === undefined ? 1234 : overrides.responseTime,
		reason: "boom",
		createdAt: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------
// Individual senders
// ---------------------------------------------------------------------------

describe("sendWebhookNotification", () => {
	it("returns early when no webhookUrl is set", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: null,
			});
			await sendWebhookNotification(channel, monitor, downChange());
			expect(fx.calls).toHaveLength(0);
		} finally {
			fx.restore();
		}
	});

	it("posts the payload and merges custom headers", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/in",
				webhookHeaders: { "X-Secret": "abc" },
			});
			await sendWebhookNotification(channel, monitor, downChange());
			expect(fx.calls).toHaveLength(1);
			expect(fx.calls[0]?.headers["X-Secret"]).toBe("abc");
			expect(fx.calls[0]?.headers["Content-Type"]).toBe(
				"application/json",
			);
			const body = JSON.parse(fx.calls[0]?.body as string);
			expect(body.monitorName).toBe("My <App>");
			expect(body.statusAfter).toBe("down");
		} finally {
			fx.restore();
		}
	});

	it("throws when the webhook responds non-ok", async () => {
		const fx = mockFetch(() => new Response("err", { status: 500 }));
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/in",
			});
			await expect(
				sendWebhookNotification(channel, monitor, downChange()),
			).rejects.toThrow(/Webhook returned 500/);
		} finally {
			fx.restore();
		}
	});
});

describe("sendSlackNotification", () => {
	it("returns early when no webhookUrl is set", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "slack",
				webhookUrl: null,
			});
			await sendSlackNotification(channel, monitor, downChange());
			expect(fx.calls).toHaveLength(0);
		} finally {
			fx.restore();
		}
	});

	it("uses the up color for a recovery", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "slack",
				webhookUrl: "https://hooks.slack/in",
			});
			await sendSlackNotification(
				channel,
				monitor,
				downChange({ statusBefore: "down", statusAfter: "up" }),
			);
			const body = JSON.parse(fx.calls[0]?.body as string);
			expect(body.attachments[0].color).toBe("#22c55e");
		} finally {
			fx.restore();
		}
	});

	it("uses the degraded color and N/A fields when http/response are null", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "slack",
				webhookUrl: "https://hooks.slack/in",
			});
			await sendSlackNotification(
				channel,
				monitor,
				downChange({
					statusAfter: "degraded",
					httpStatus: null,
					responseTime: null,
				}),
			);
			const body = JSON.parse(fx.calls[0]?.body as string);
			expect(body.attachments[0].color).toBe("#f59e0b");
			const fieldText = JSON.stringify(body.attachments[0].blocks);
			expect(fieldText).toContain("N/A");
		} finally {
			fx.restore();
		}
	});

	it("throws on a non-ok response", async () => {
		const fx = mockFetch(() => new Response("x", { status: 404 }));
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "slack",
				webhookUrl: "https://hooks.slack/in",
			});
			await expect(
				sendSlackNotification(channel, monitor, downChange()),
			).rejects.toThrow(/Slack webhook returned 404/);
		} finally {
			fx.restore();
		}
	});
});

describe("sendDiscordNotification", () => {
	it("returns early when no webhookUrl is set", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "discord",
				webhookUrl: null,
			});
			await sendDiscordNotification(channel, monitor, downChange());
			expect(fx.calls).toHaveLength(0);
		} finally {
			fx.restore();
		}
	});

	it("uses the up color for recovery and includes response time", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "discord",
				webhookUrl: "https://discord/in",
			});
			await sendDiscordNotification(
				channel,
				monitor,
				downChange({ statusBefore: "down", statusAfter: "up" }),
			);
			const body = JSON.parse(fx.calls[0]?.body as string);
			expect(body.embeds[0].color).toBe(0x22c55e);
		} finally {
			fx.restore();
		}
	});

	it("uses the degraded color and N/A response time when null", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "discord",
				webhookUrl: "https://discord/in",
			});
			await sendDiscordNotification(
				channel,
				monitor,
				downChange({
					statusAfter: "degraded",
					httpStatus: null,
					responseTime: null,
				}),
			);
			const body = JSON.parse(fx.calls[0]?.body as string);
			expect(body.embeds[0].color).toBe(0xf59e0b);
			const responseField = body.embeds[0].fields.find(
				(f: { name: string }) => f.name === "Response Time",
			);
			expect(responseField.value).toBe("N/A");
		} finally {
			fx.restore();
		}
	});

	it("throws on a non-ok response", async () => {
		const fx = mockFetch(() => new Response("x", { status: 400 }));
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "discord",
				webhookUrl: "https://discord/in",
			});
			await expect(
				sendDiscordNotification(channel, monitor, downChange()),
			).rejects.toThrow(/Discord webhook returned 400/);
		} finally {
			fx.restore();
		}
	});
});

describe("sendTelegramNotification — target parsing", () => {
	it("throws when no webhookUrl is set", async () => {
		const channel = await createTestChannel(monitor.uptimeMonitorId, {
			channelType: "telegram",
			webhookUrl: null,
		});
		await expect(
			sendTelegramNotification(channel, monitor, downChange()),
		).rejects.toThrow(/bot token and chat ID are required/);
	});

	it("parses BOT_TOKEN:CHAT_ID form and escapes HTML in the body", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "telegram",
				webhookUrl: "123456:ABC-DEF_token:-100999",
			});
			await sendTelegramNotification(channel, monitor, downChange());
			expect(fx.calls[0]?.url).toBe(
				"https://api.telegram.org/bot123456:ABC-DEF_token/sendMessage",
			);
			const body = JSON.parse(fx.calls[0]?.body as string);
			expect(body.chat_id).toBe("-100999");
			// monitor.name "My <App>" -> escaped
			expect(body.text).toContain("My &lt;App&gt;");
			expect(body.parse_mode).toBe("HTML");
		} finally {
			fx.restore();
		}
	});

	it("parses a full https api.telegram.org URL", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "telegram",
				webhookUrl:
					"https://api.telegram.org/bottoken123/sendMessage?chat_id=555",
			});
			await sendTelegramNotification(channel, monitor, downChange());
			expect(fx.calls[0]?.url).toBe(
				"https://api.telegram.org/bottoken123/sendMessage",
			);
			const body = JSON.parse(fx.calls[0]?.body as string);
			expect(body.chat_id).toBe("555");
		} finally {
			fx.restore();
		}
	});

	it("reads chat_id from webhookHeaders for an https URL", async () => {
		const fx = mockFetch();
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "telegram",
				webhookUrl: "https://api.telegram.org/bottoken123",
				webhookHeaders: { chat_id: "777" },
			});
			await sendTelegramNotification(channel, monitor, downChange());
			const body = JSON.parse(fx.calls[0]?.body as string);
			expect(body.chat_id).toBe("777");
		} finally {
			fx.restore();
		}
	});

	it("throws when an https URL has no parseable chat id", async () => {
		const channel = await createTestChannel(monitor.uptimeMonitorId, {
			channelType: "telegram",
			webhookUrl: "https://api.telegram.org/bottoken123",
		});
		await expect(
			sendTelegramNotification(channel, monitor, downChange()),
		).rejects.toThrow(/bot token and chat ID are required/);
	});

	it("throws when an https URL is not api.telegram.org (no token)", async () => {
		const channel = await createTestChannel(monitor.uptimeMonitorId, {
			channelType: "telegram",
			webhookUrl: "https://example.com/path?chat_id=1",
		});
		await expect(
			sendTelegramNotification(channel, monitor, downChange()),
		).rejects.toThrow(/bot token and chat ID are required/);
	});

	it("throws when the plain form lacks a colon-separated chat id", async () => {
		const channel = await createTestChannel(monitor.uptimeMonitorId, {
			channelType: "telegram",
			webhookUrl: "just-a-token",
		});
		await expect(
			sendTelegramNotification(channel, monitor, downChange()),
		).rejects.toThrow(/BOT_TOKEN:CHAT_ID format/);
	});

	it("throws when the plain form has an empty chat id segment", async () => {
		const channel = await createTestChannel(monitor.uptimeMonitorId, {
			channelType: "telegram",
			webhookUrl: "token:part:",
		});
		await expect(
			sendTelegramNotification(channel, monitor, downChange()),
		).rejects.toThrow(/bot token and chat ID are required/);
	});

	it("throws when the Telegram API responds non-ok", async () => {
		const fx = mockFetch(() => new Response("bad token", { status: 401 }));
		try {
			const channel = await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "telegram",
				webhookUrl: "bot:tok:123",
			});
			await expect(
				sendTelegramNotification(channel, monitor, downChange()),
			).rejects.toThrow(/Telegram API returned 401/);
		} finally {
			fx.restore();
		}
	});
});

// ---------------------------------------------------------------------------
// Email notification
// ---------------------------------------------------------------------------

describe("email dispatch (via dispatchNotifications)", () => {
	it("does nothing when emailProviderId is missing", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "email",
				emailProviderId: null,
				recipientAddresses: ["a@pulsy.test"],
			});
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			expect(fx.calls).toHaveLength(0);
			expect(await logRowsFor(monitor.uptimeMonitorId)).toHaveLength(0);
		} finally {
			fx.restore();
		}
	});

	it("does nothing when there are no recipients", async () => {
		const fx = mockFetch();
		try {
			const provider = await createTestEmailProvider(userId, {
				apiKey: encrypt("re_key"),
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "email",
				emailProviderId: provider.emailProviderId,
				recipientAddresses: [],
			});
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			expect(fx.calls).toHaveLength(0);
			expect(await logRowsFor(monitor.uptimeMonitorId)).toHaveLength(0);
		} finally {
			fx.restore();
		}
	});

	it("records a failed row per recipient when the provider is not found / wrong owner", async () => {
		const fx = mockFetch();
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			// Provider owned by a DIFFERENT user -> findEmailProviderById throws
			// (ownership scoping) -> no send, one failed audit row per recipient.
			const other = await createTestUser();
			const provider = await createTestEmailProvider(other.id, {
				apiKey: encrypt("re_key"),
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "email",
				emailProviderId: provider.emailProviderId,
				recipientAddresses: ["a@pulsy.test", "b@pulsy.test"],
			});
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			expect(fx.calls).toHaveLength(0);
			const rows = await logRowsFor(monitor.uptimeMonitorId);
			expect(rows).toHaveLength(2);
			expect(rows.every((r) => r.outcome === "failed")).toBe(true);
			expect(rows.map((r) => r.target).sort()).toEqual([
				"a@pulsy.test",
				"b@pulsy.test",
			]);
			expect(errSpy).toHaveBeenCalled();
		} finally {
			fx.restore();
			errSpy.mockRestore();
		}
	});

	it("sends to each recipient via the resolved provider and records sent rows", async () => {
		const fx = mockFetch(() => new Response(JSON.stringify({ id: "re_1" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}));
		try {
			const provider = await createTestEmailProvider(userId, {
				providerType: "resend",
				apiKey: encrypt("re_real_key"),
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "email",
				emailProviderId: provider.emailProviderId,
				recipientAddresses: ["a@pulsy.test", "b@pulsy.test"],
			});
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			expect(fx.calls).toHaveLength(2);
			expect(fx.calls[0]?.headers.Authorization).toBe("Bearer re_real_key");
			const rows = await logRowsFor(monitor.uptimeMonitorId);
			expect(rows).toHaveLength(2);
			expect(rows.every((r) => r.outcome === "sent")).toBe(true);
			expect(rows.every((r) => r.providerMessageId === "re_1")).toBe(true);
			expect(rows.every((r) => r.channelType === "email")).toBe(true);
			expect(rows.every((r) => r.event === "down")).toBe(true);
		} finally {
			fx.restore();
		}
	});

	it("records a failed row for the failing recipient and a sent row for the other", async () => {
		let n = 0;
		const fx = mockFetch(() => {
			n += 1;
			return n === 1
				? new Response("err", { status: 500 })
				: new Response(JSON.stringify({ id: "re_ok" }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
		});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const provider = await createTestEmailProvider(userId, {
				providerType: "resend",
				apiKey: encrypt("re_real_key"),
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "email",
				emailProviderId: provider.emailProviderId,
				recipientAddresses: ["a@pulsy.test", "b@pulsy.test"],
			});
			// NO_RETRY so the 500 is a single-attempt failure, not a 12-min backoff.
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			expect(fx.calls).toHaveLength(2);
			const rows = await logRowsFor(monitor.uptimeMonitorId);
			expect(rows).toHaveLength(2);
			expect(rows.filter((r) => r.outcome === "failed")).toHaveLength(1);
			expect(rows.filter((r) => r.outcome === "sent")).toHaveLength(1);
			expect(errSpy).toHaveBeenCalled();
		} finally {
			fx.restore();
			errSpy.mockRestore();
		}
	});
});

describe("buildEmailContent", () => {
	it("renders N/A for null http/response, the degraded emoji subject, and escapes the name", () => {
		const { subject, html } = buildEmailContent(
			monitor,
			downChange({
				statusAfter: "degraded",
				httpStatus: null,
				responseTime: null,
			}),
		);
		expect(subject).toContain("DEGRADED");
		expect(html).toContain("N/A");
		// monitor.name "My <App>" -> escaped
		expect(html).toContain("My &lt;App&gt;");
	});
});

// ---------------------------------------------------------------------------
// dispatchNotifications — gating + isolation
// ---------------------------------------------------------------------------

describe("dispatchNotifications", () => {
	it("dispatches a down alert to a webhook channel", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/in",
				notifyOnDown: true,
			});
			await dispatchNotifications(monitor, downChange());
			expect(fx.calls).toHaveLength(1);
		} finally {
			fx.restore();
		}
	});

	it("skips a down alert when notifyOnDown is false", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/in",
				notifyOnDown: false,
			});
			await dispatchNotifications(monitor, downChange());
			expect(fx.calls).toHaveLength(0);
		} finally {
			fx.restore();
		}
	});

	it("dispatches a recovery alert (up after down) when notifyOnRecovery", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "slack",
				webhookUrl: "https://hooks.slack/in",
				notifyOnRecovery: true,
			});
			await dispatchNotifications(
				monitor,
				downChange({ statusBefore: "down", statusAfter: "up" }),
			);
			expect(fx.calls).toHaveLength(1);
		} finally {
			fx.restore();
		}
	});

	it("treats up-after-degraded as a recovery", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/in",
				notifyOnRecovery: true,
			});
			await dispatchNotifications(
				monitor,
				downChange({ statusBefore: "degraded", statusAfter: "up" }),
			);
			expect(fx.calls).toHaveLength(1);
		} finally {
			fx.restore();
		}
	});

	it("does not notify for a non-down, non-recovery transition", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/in",
			});
			// up -> degraded is neither down nor recovery
			await dispatchNotifications(
				monitor,
				downChange({ statusBefore: "up", statusAfter: "degraded" }),
			);
			expect(fx.calls).toHaveLength(0);
		} finally {
			fx.restore();
		}
	});

	it("isolates a failing channel so others still fire", async () => {
		// slack endpoint fails (500 -> sender throws), webhook endpoint succeeds.
		const fx = mockFetch((url) =>
			url.includes("slack")
				? new Response("err", { status: 500 })
				: new Response("ok", { status: 200 }),
		);
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "slack",
				webhookUrl: "https://hooks.slack/in",
				notifyOnDown: true,
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.webhook/in",
				notifyOnDown: true,
			});
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			expect(fx.calls).toHaveLength(2);
			expect(errSpy).toHaveBeenCalled();
		} finally {
			fx.restore();
			errSpy.mockRestore();
		}
	});

	it("routes to discord, telegram and email channel types", async () => {
		const fx = mockFetch();
		try {
			const provider = await createTestEmailProvider(userId, {
				providerType: "resend",
				apiKey: encrypt("re_key"),
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "discord",
				webhookUrl: "https://discord/in",
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "telegram",
				webhookUrl: "bot:tok:123",
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "email",
				emailProviderId: provider.emailProviderId,
				recipientAddresses: ["a@pulsy.test"],
			});
			await dispatchNotifications(monitor, downChange());
			// discord + telegram + 1 email recipient = 3 outbound calls
			expect(fx.calls).toHaveLength(3);
		} finally {
			fx.restore();
		}
	});
});

// ---------------------------------------------------------------------------
// dispatchTlsExpiryNotifications
// ---------------------------------------------------------------------------

describe("dispatchTlsExpiryNotifications", () => {
	const tlsInfo = {
		expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(),
		expiresInDays: 5,
		issuer: "Lets Encrypt",
		valid: true,
	};

	it("returns without sending when no channel opts into TLS expiry", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/in",
				notifyOnTlsExpiry: false,
			});
			await dispatchTlsExpiryNotifications(monitor, tlsInfo);
			expect(fx.calls).toHaveLength(0);
		} finally {
			fx.restore();
		}
	});

	it("skips a channel whose threshold is below the remaining days", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/in",
				notifyOnTlsExpiry: true,
				tlsExpiryThresholdDays: 3, // expiresInDays(5) > 3 -> not eligible
			});
			await dispatchTlsExpiryNotifications(monitor, tlsInfo);
			expect(fx.calls).toHaveLength(0);
		} finally {
			fx.restore();
		}
	});

	it("notifies eligible channels (threshold >= remaining days)", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/in",
				notifyOnTlsExpiry: true,
				tlsExpiryThresholdDays: 14,
			});
			await dispatchTlsExpiryNotifications(monitor, tlsInfo);
			expect(fx.calls).toHaveLength(1);
		} finally {
			fx.restore();
		}
	});

	it("routes TLS expiry alerts across all channel types and isolates failures", async () => {
		const fx = mockFetch((url) =>
			url.includes("slack")
				? new Response("err", { status: 500 })
				: new Response("ok", { status: 200 }),
		);
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const provider = await createTestEmailProvider(userId, {
				providerType: "resend",
				apiKey: encrypt("re_key"),
			});
			const common = {
				notifyOnTlsExpiry: true,
				tlsExpiryThresholdDays: 30,
			};
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "slack",
				webhookUrl: "https://hooks.slack/in",
				...common,
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "discord",
				webhookUrl: "https://discord/in",
				...common,
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "telegram",
				webhookUrl: "bot:tok:123",
				...common,
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.webhook/in",
				...common,
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "email",
				emailProviderId: provider.emailProviderId,
				recipientAddresses: ["a@pulsy.test"],
				...common,
			});
			await dispatchTlsExpiryNotifications(monitor, tlsInfo, NO_RETRY);
			// slack + discord + telegram + webhook + 1 email = 5 outbound attempts
			expect(fx.calls).toHaveLength(5);
			expect(errSpy).toHaveBeenCalled(); // slack failure logged
		} finally {
			fx.restore();
			errSpy.mockRestore();
		}
	});
});

describe("configured latency notifications", () => {
  it("sends degraded only to opted-in channels and records the event", async () => {
    const fx = mockFetch();
    try {
      const configured = { ...monitor, latencyPolicy: { thresholdMs: 200, slowCount: 1, recoveryThresholdMs: 150, recoveryCount: 1, importance: "critical" as const, cooldownSeconds: 0 } };
      await createTestChannel(monitor.uptimeMonitorId, { channelType: "webhook", webhookUrl: "https://hooks.test/degraded", notifyOnDegraded: true });
      await createTestChannel(monitor.uptimeMonitorId, { channelType: "webhook", webhookUrl: "https://hooks.test/disabled", notifyOnDegraded: false });
      await dispatchNotifications(configured, downChange({ statusAfter: "degraded" }), NO_RETRY);
      expect(fx.calls).toHaveLength(1);
      expect(fx.calls[0]?.url).toBe("https://hooks.test/degraded");
      expect(await logRowsFor(monitor.uptimeMonitorId)).toEqual([expect.objectContaining({ event: "degraded", status: "sent" })]);
    } finally { fx.restore(); }
  });
  it("keeps informational latency policies quiet", async () => {
    const fx = mockFetch();
    try {
      await createTestChannel(monitor.uptimeMonitorId, { channelType: "webhook", webhookUrl: "https://hooks.test/quiet", notifyOnDegraded: true });
      await dispatchNotifications({ ...monitor, latencyPolicy: { thresholdMs: 200, slowCount: 1, recoveryThresholdMs: 150, recoveryCount: 1, importance: "informational", cooldownSeconds: 60 } }, downChange({ statusAfter: "degraded" }), NO_RETRY);
      expect(fx.calls).toHaveLength(0);
    } finally { fx.restore(); }
  });
});
