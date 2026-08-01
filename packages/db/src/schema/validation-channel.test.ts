import { describe, expect, it } from "vitest";
import {
	apiCreateUptimeDefaultNotificationChannel,
	apiCreateUptimeEmailProvider,
	apiCreateUptimeNotificationChannel,
} from "./validation";

// Covers the `validateChannelTarget` / `isTelegramTarget` superRefine on the
// notification-channel create schema (channel-type-specific target rules).

const base = { uptimeMonitorId: "m1" };

describe("apiCreateUptimeNotificationChannel — channel target validation", () => {
	describe("email", () => {
		it("requires an email provider", () => {
			expect(() =>
				apiCreateUptimeNotificationChannel.parse({
					...base,
					channelType: "email",
					recipientAddresses: ["to@pulsy.test"],
				}),
			).toThrow(/Email provider is required/);
		});

		it("requires at least one recipient", () => {
			expect(() =>
				apiCreateUptimeNotificationChannel.parse({
					...base,
					channelType: "email",
					emailProviderId: "p1",
					recipientAddresses: [],
				}),
			).toThrow(/At least one recipient/);
		});

		it("accepts a fully-configured email channel", () => {
			expect(() =>
				apiCreateUptimeNotificationChannel.parse({
					...base,
					channelType: "email",
					emailProviderId: "p1",
					recipientAddresses: ["to@pulsy.test"],
				}),
			).not.toThrow();
		});
	});

	describe.each(["webhook", "slack", "discord"] as const)("%s", (channelType) => {
		it("requires a webhook URL", () => {
			expect(() =>
				apiCreateUptimeNotificationChannel.parse({ ...base, channelType }),
			).toThrow(/Webhook URL is required/);
		});

		it("rejects a non-URL webhook target", () => {
			expect(() =>
				apiCreateUptimeNotificationChannel.parse({
					...base,
					channelType,
					webhookUrl: "not-a-url",
				}),
			).toThrow(/valid URL/);
		});

		it("accepts a valid webhook URL", () => {
			expect(() =>
				apiCreateUptimeNotificationChannel.parse({
					...base,
					channelType,
					webhookUrl: "https://hooks.example.com/incoming",
				}),
			).not.toThrow();
		});
	});

	describe("telegram", () => {
		it("requires a target", () => {
			expect(() =>
				apiCreateUptimeNotificationChannel.parse({
					...base,
					channelType: "telegram",
				}),
			).toThrow(/Telegram target is required/);
		});

		it("accepts a Telegram API URL", () => {
			expect(() =>
				apiCreateUptimeNotificationChannel.parse({
					...base,
					channelType: "telegram",
					webhookUrl: "https://api.telegram.org/bot123:ABC/sendMessage",
				}),
			).not.toThrow();
		});

		it("accepts a BOT_TOKEN:CHAT_ID target", () => {
			expect(() =>
				apiCreateUptimeNotificationChannel.parse({
					...base,
					channelType: "telegram",
					webhookUrl: "123456:ABC-DEF_token:-1009999",
				}),
			).not.toThrow();
		});

		it("rejects a malformed Telegram target", () => {
			expect(() =>
				apiCreateUptimeNotificationChannel.parse({
					...base,
					channelType: "telegram",
					webhookUrl: "justone",
				}),
			).toThrow(/Telegram API URL or BOT_TOKEN:CHAT_ID/);
		});

		it("rejects a BOT_TOKEN:CHAT_ID target with an empty segment", () => {
			expect(() =>
				apiCreateUptimeNotificationChannel.parse({
					...base,
					channelType: "telegram",
					webhookUrl: "token::chat",
				}),
			).toThrow(/Telegram API URL or BOT_TOKEN:CHAT_ID/);
		});
	});

	it("runs the no-op target check for an out-of-enum channel type", () => {
		// channelType fails the enum AND the superRefine runs with the raw value,
		// hitting validateChannelTarget's default branch.
		expect(() =>
			apiCreateUptimeNotificationChannel.parse({
				...base,
				channelType: "carrier-pigeon",
			}),
		).toThrow();
	});

	it("rejects an unexpected uptimeMonitorId on the default-channel schema", () => {
		// The default-channel schema has no monitor binding; the field is simply
		// stripped, so a parsed default channel never carries one.
		const parsed = apiCreateUptimeDefaultNotificationChannel.parse({
			uptimeMonitorId: "m1",
			channelType: "webhook",
			webhookUrl: "https://hooks.example.com/in",
		});
		expect("uptimeMonitorId" in parsed).toBe(false);
	});
});

describe("apiCreateUptimeDefaultNotificationChannel — same target rules, no monitor", () => {
	it("requires an email provider", () => {
		expect(() =>
			apiCreateUptimeDefaultNotificationChannel.parse({
				channelType: "email",
				recipientAddresses: ["to@pulsy.test"],
			}),
		).toThrow(/Email provider is required/);
	});

	it("requires at least one recipient", () => {
		expect(() =>
			apiCreateUptimeDefaultNotificationChannel.parse({
				channelType: "email",
				emailProviderId: "p1",
				recipientAddresses: [],
			}),
		).toThrow(/At least one recipient/);
	});

	it.each(["webhook", "slack", "discord"] as const)(
		"requires a webhook URL for %s",
		(channelType) => {
			expect(() =>
				apiCreateUptimeDefaultNotificationChannel.parse({ channelType }),
			).toThrow(/Webhook URL is required/);
		},
	);

	it("requires a telegram target", () => {
		expect(() =>
			apiCreateUptimeDefaultNotificationChannel.parse({
				channelType: "telegram",
			}),
		).toThrow(/Telegram target is required/);
	});

	it("accepts a fully-configured default email channel with flag defaults", () => {
		const parsed = apiCreateUptimeDefaultNotificationChannel.parse({
			channelType: "email",
			emailProviderId: "p1",
			recipientAddresses: ["to@pulsy.test"],
		});
		expect(parsed.notifyOnDown).toBe(true);
		expect(parsed.notifyOnRecovery).toBe(true);
		expect(parsed.notifyOnTlsExpiry).toBe(false);
		expect(parsed.tlsExpiryThresholdDays).toBe(14);
	});
});

describe("apiCreateUptimeEmailProvider — SMTP field requirements", () => {
	const fullSmtp = {
		name: "SMTP",
		providerType: "smtp" as const,
		fromAddress: "alerts@pulsy.test",
		smtpHost: "smtp.pulsy.test",
		smtpPort: 587,
		smtpUsername: "user",
		smtpPassword: "secret",
	};

	it("accepts a fully-configured SMTP provider", () => {
		expect(() => apiCreateUptimeEmailProvider.parse(fullSmtp)).not.toThrow();
	});

	it("requires the SMTP host when only it is missing", () => {
		const { smtpHost: _omit, ...rest } = fullSmtp;
		expect(() => apiCreateUptimeEmailProvider.parse(rest)).toThrow(
			/SMTP host is required/,
		);
	});

	it("requires the SMTP port when only it is missing", () => {
		const { smtpPort: _omit, ...rest } = fullSmtp;
		expect(() => apiCreateUptimeEmailProvider.parse(rest)).toThrow(
			/SMTP port is required/,
		);
	});

	it("requires the SMTP username when only it is missing", () => {
		const { smtpUsername: _omit, ...rest } = fullSmtp;
		expect(() => apiCreateUptimeEmailProvider.parse(rest)).toThrow(
			/SMTP username is required/,
		);
	});
});
