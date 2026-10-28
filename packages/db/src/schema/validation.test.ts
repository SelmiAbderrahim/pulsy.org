import { describe, expect, it } from "vitest";
import {
	apiCreateApiKey,
	apiCloneUptimeShareLink,
	apiCreateUptimeEmailProvider,
	apiCreateUptimeMonitor,
	apiCreateUptimeMonitorsBulk,
	apiCreateUptimeNotificationChannel,
	apiCreateUptimeShareLink,
	apiResolveUptimeShareLink,
	apiRevokeUptimeShareLink,
	apiSearchUptimeIncidents,
	apiUpdateUptimeEmailProvider,
	apiUpdateUptimeMonitor,
	apiUpdateUptimeNotificationChannel,
} from "./validation";
import {
	uptimeCheckStatusEnum,
	uptimeEmailProviderTypeEnum,
	uptimeIncidentStatusEnum,
	uptimeMonitorMethodEnum,
	uptimeMonitorStatusEnum,
	uptimeNotificationChannelTypeEnum,
} from "./uptime-monitor";

// ---------------------------------------------------------------------------
// Enum value sets (declarative, but asserted for regression safety)
// ---------------------------------------------------------------------------

describe("enums", () => {
	it("expose the expected value sets", () => {
		expect(uptimeMonitorMethodEnum.enumValues).toEqual(["GET", "HEAD", "POST"]);
		expect(uptimeMonitorStatusEnum.enumValues).toEqual([
			"up",
			"down",
			"degraded",
			"pending",
		]);
		expect(uptimeCheckStatusEnum.enumValues).toEqual(["up", "down", "degraded"]);
		expect(uptimeIncidentStatusEnum.enumValues).toEqual([
			"ongoing",
			"resolved",
		]);
		expect(uptimeEmailProviderTypeEnum.enumValues).toEqual([
			"resend",
			"sendgrid",
			"smtp",
		]);
		expect(uptimeNotificationChannelTypeEnum.enumValues).toEqual([
			"email",
			"webhook",
			"slack",
			"discord",
			"telegram",
		]);
	});
});

// ---------------------------------------------------------------------------
// apiCreateUptimeMonitor
// ---------------------------------------------------------------------------

describe("apiCreateUptimeMonitor", () => {
	const valid = { name: "API", url: "https://example.com" };

	it("accepts a minimal valid input and applies defaults", () => {
		const parsed = apiCreateUptimeMonitor.parse(valid);
		expect(parsed.method).toBe("GET");
		expect(parsed.expectedStatus).toBe(200);
		expect(parsed.timeout).toBe(10_000);
		expect(parsed.interval).toBe(300);
		expect(parsed.failureThreshold).toBe(3);
		expect(parsed.active).toBe(true);
		expect(parsed.tags).toEqual([]);
	});

	it("permits a derived name and rejects an over-long name", () => {
		expect(apiCreateUptimeMonitor.parse({ ...valid, name: "" }).name).toBe("");
		expect(() =>
			apiCreateUptimeMonitor.parse({ ...valid, name: "x".repeat(256) }),
		).toThrow();
	});

	it("rejects a non-URL url", () => {
		expect(() =>
			apiCreateUptimeMonitor.parse({ ...valid, url: "not a url" }),
		).toThrow();
	});

	it("rejects an unsupported method", () => {
		expect(() =>
			apiCreateUptimeMonitor.parse({ ...valid, method: "PUT" }),
		).toThrow();
	});

	it("enforces the expectedStatus range", () => {
		expect(() =>
			apiCreateUptimeMonitor.parse({ ...valid, expectedStatus: 99 }),
		).toThrow();
		expect(() =>
			apiCreateUptimeMonitor.parse({ ...valid, expectedStatus: 600 }),
		).toThrow();
	});

	it("enforces the timeout range", () => {
		expect(() =>
			apiCreateUptimeMonitor.parse({ ...valid, timeout: 999 }),
		).toThrow();
		expect(() =>
			apiCreateUptimeMonitor.parse({ ...valid, timeout: 60_001 }),
		).toThrow();
	});

	it("accepts only whitelisted intervals", () => {
		for (const interval of [30, 60, 300, 600, 1800, 3600]) {
			expect(
				apiCreateUptimeMonitor.parse({ ...valid, interval }).interval,
			).toBe(interval);
		}
		expect(() =>
			apiCreateUptimeMonitor.parse({ ...valid, interval: 250 }),
		).toThrow(/Interval must be/);
	});

	it("enforces the failureThreshold range", () => {
		expect(() =>
			apiCreateUptimeMonitor.parse({ ...valid, failureThreshold: 0 }),
		).toThrow();
		expect(() =>
			apiCreateUptimeMonitor.parse({ ...valid, failureThreshold: 11 }),
		).toThrow();
	});

	it("limits tags to 10 entries of 1-50 chars", () => {
		expect(
			apiCreateUptimeMonitor.parse({ ...valid, tags: ["a", "b"] }).tags,
		).toEqual(["a", "b"]);
		expect(() =>
			apiCreateUptimeMonitor.parse({ ...valid, tags: [""] }),
		).toThrow();
		expect(() =>
			apiCreateUptimeMonitor.parse({ ...valid, tags: ["x".repeat(51)] }),
		).toThrow();
		expect(() =>
			apiCreateUptimeMonitor.parse({
				...valid,
				tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
			}),
		).toThrow();
	});
});

// ---------------------------------------------------------------------------
// apiCreateUptimeMonitorsBulk
// ---------------------------------------------------------------------------

describe("apiCreateUptimeMonitorsBulk", () => {
	const one = { name: "A", url: "https://a.com" };

	it("accepts 1-50 monitors", () => {
		expect(
			apiCreateUptimeMonitorsBulk.parse({ monitors: [one] }).monitors,
		).toHaveLength(1);
		expect(
			apiCreateUptimeMonitorsBulk.parse({
				monitors: Array.from({ length: 50 }, () => ({ ...one })),
			}).monitors,
		).toHaveLength(50);
	});

	it("rejects empty and over-50 batches", () => {
		expect(() => apiCreateUptimeMonitorsBulk.parse({ monitors: [] })).toThrow();
		expect(() =>
			apiCreateUptimeMonitorsBulk.parse({
				monitors: Array.from({ length: 51 }, () => ({ ...one })),
			}),
		).toThrow();
	});
});

// ---------------------------------------------------------------------------
// apiUpdateUptimeMonitor
// ---------------------------------------------------------------------------

describe("apiUpdateUptimeMonitor", () => {
	it("requires uptimeMonitorId and allows partial updates", () => {
		expect(() => apiUpdateUptimeMonitor.parse({})).toThrow();
		const parsed = apiUpdateUptimeMonitor.parse({
			uptimeMonitorId: "m1",
			name: "New",
		});
		expect(parsed.uptimeMonitorId).toBe("m1");
		expect(parsed.name).toBe("New");
	});

	it("validates optional fields when present", () => {
		expect(() =>
			apiUpdateUptimeMonitor.parse({ uptimeMonitorId: "m1", interval: 7 }),
		).toThrow();
		expect(() =>
			apiUpdateUptimeMonitor.parse({ uptimeMonitorId: "m1", url: "nope" }),
		).toThrow();
	});

	it("allows nullable status-page fields", () => {
		const parsed = apiUpdateUptimeMonitor.parse({
			uptimeMonitorId: "m1",
			statusPageTitle: null,
			statusPageDescription: null,
			isPublic: true,
		});
		expect(parsed.statusPageTitle).toBeNull();
		expect(parsed.isPublic).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Email provider schemas
// ---------------------------------------------------------------------------

describe("apiCreateUptimeEmailProvider", () => {
	const valid = {
		name: "Resend",
		providerType: "resend" as const,
		apiKey: "re_test_key",
		fromAddress: "alerts@pulsy.test",
	};

	it("accepts a valid provider and defaults smtpSecure", () => {
		expect(apiCreateUptimeEmailProvider.parse(valid).smtpSecure).toBe(true);
	});

	it("rejects an unsupported providerType", () => {
		expect(() =>
			apiCreateUptimeEmailProvider.parse({ ...valid, providerType: "mailgun" }),
		).toThrow();
	});

	it("requires a valid fromAddress email", () => {
		expect(() =>
			apiCreateUptimeEmailProvider.parse({ ...valid, fromAddress: "nope" }),
		).toThrow();
	});

	it("requires API keys for API providers", () => {
		expect(() =>
			apiCreateUptimeEmailProvider.parse({
				name: "Resend",
				providerType: "resend",
				fromAddress: "alerts@pulsy.test",
			}),
		).toThrow(/API key is required/);
		expect(() =>
			apiCreateUptimeEmailProvider.parse({
				name: "SendGrid",
				providerType: "sendgrid",
				fromAddress: "alerts@pulsy.test",
			}),
		).toThrow(/API key is required/);
	});

	it("requires SMTP host, port, username, and password for SMTP", () => {
		expect(() =>
			apiCreateUptimeEmailProvider.parse({
				name: "SMTP",
				providerType: "smtp",
				fromAddress: "alerts@pulsy.test",
				smtpHost: "smtp.pulsy.test",
				smtpPort: 587,
				smtpUsername: "user",
			}),
		).toThrow(/SMTP password is required/);
		expect(
			apiCreateUptimeEmailProvider.parse({
				name: "SMTP",
				providerType: "smtp",
				fromAddress: "alerts@pulsy.test",
				smtpHost: "smtp.pulsy.test",
				smtpPort: 587,
				smtpUsername: "user",
				smtpPassword: "pass",
			}).providerType,
		).toBe("smtp");
	});

	it("enforces the smtpPort range when provided", () => {
		expect(() =>
			apiCreateUptimeEmailProvider.parse({ ...valid, smtpPort: 0 }),
		).toThrow();
		expect(() =>
			apiCreateUptimeEmailProvider.parse({ ...valid, smtpPort: 70_000 }),
		).toThrow();
		expect(
			apiCreateUptimeEmailProvider.parse({ ...valid, smtpPort: 587 }).smtpPort,
		).toBe(587);
	});
});

describe("apiUpdateUptimeEmailProvider", () => {
	it("requires the id and allows partial updates", () => {
		expect(() => apiUpdateUptimeEmailProvider.parse({})).toThrow();
		expect(
			apiUpdateUptimeEmailProvider.parse({ emailProviderId: "p1", name: "x" })
				.name,
		).toBe("x");
	});

	it("validates fromAddress when present", () => {
		expect(() =>
			apiUpdateUptimeEmailProvider.parse({
				emailProviderId: "p1",
				fromAddress: "bad",
			}),
		).toThrow();
	});
});

// ---------------------------------------------------------------------------
// Notification channel schemas
// ---------------------------------------------------------------------------

describe("apiCreateUptimeNotificationChannel", () => {
	const valid = {
		uptimeMonitorId: "m1",
		channelType: "webhook" as const,
		webhookUrl: "https://hooks.pulsy.test/incoming",
	};

	it("accepts a valid channel with defaults", () => {
		const parsed = apiCreateUptimeNotificationChannel.parse(valid);
		expect(parsed.notifyOnDown).toBe(true);
		expect(parsed.notifyOnRecovery).toBe(true);
		expect(parsed.notifyOnTlsExpiry).toBe(false);
		expect(parsed.tlsExpiryThresholdDays).toBe(14);
	});

	it("rejects an unsupported channelType", () => {
		expect(() =>
			apiCreateUptimeNotificationChannel.parse({ ...valid, channelType: "sms" }),
		).toThrow();
	});

	it("validates recipient emails and webhook url", () => {
		expect(() =>
			apiCreateUptimeNotificationChannel.parse({
				uptimeMonitorId: "m1",
				channelType: "email",
				emailProviderId: "p1",
				recipientAddresses: ["nope"],
			}),
		).toThrow();
		expect(() =>
			apiCreateUptimeNotificationChannel.parse({
				...valid,
				webhookUrl: "not-a-url",
			}),
		).toThrow();
	});

	it("requires provider and recipients for email channels", () => {
		expect(() =>
			apiCreateUptimeNotificationChannel.parse({
				uptimeMonitorId: "m1",
				channelType: "email",
				recipientAddresses: ["ops@pulsy.test"],
			}),
		).toThrow(/Email provider is required/);
		expect(() =>
			apiCreateUptimeNotificationChannel.parse({
				uptimeMonitorId: "m1",
				channelType: "email",
				emailProviderId: "p1",
			}),
		).toThrow(/At least one recipient is required/);
	});

	it("accepts both Telegram shorthand and direct API URL targets", () => {
		expect(
			apiCreateUptimeNotificationChannel.parse({
				uptimeMonitorId: "m1",
				channelType: "telegram",
				webhookUrl: "123456:abcDEF:987654",
			}).webhookUrl,
		).toBe("123456:abcDEF:987654");
		expect(
			apiCreateUptimeNotificationChannel.parse({
				uptimeMonitorId: "m1",
				channelType: "telegram",
				webhookUrl:
					"https://api.telegram.org/bot123456:abcDEF/sendMessage?chat_id=987654",
			}).channelType,
		).toBe("telegram");
	});

	it("enforces the tlsExpiryThresholdDays range", () => {
		expect(() =>
			apiCreateUptimeNotificationChannel.parse({
				...valid,
				tlsExpiryThresholdDays: 0,
			}),
		).toThrow();
		expect(() =>
			apiCreateUptimeNotificationChannel.parse({
				...valid,
				tlsExpiryThresholdDays: 91,
			}),
		).toThrow();
	});
});

describe("apiUpdateUptimeNotificationChannel", () => {
	it("requires the channelId and allows a nullable emailProviderId", () => {
		expect(() => apiUpdateUptimeNotificationChannel.parse({})).toThrow();
		const parsed = apiUpdateUptimeNotificationChannel.parse({
			channelId: "c1",
			emailProviderId: null,
		});
		expect(parsed.channelId).toBe("c1");
		expect(parsed.emailProviderId).toBeNull();
	});

	it("rejects an empty webhook url when present", () => {
		expect(() =>
			apiUpdateUptimeNotificationChannel.parse({
				channelId: "c1",
				webhookUrl: "",
			}),
		).toThrow();
	});
});

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

describe("apiCreateUptimeShareLink", () => {
	it("applies the default expiry of 30 days", () => {
		const parsed = apiCreateUptimeShareLink.parse({
			uptimeMonitorIds: ["m1"],
		});
		expect(parsed.expiresInDays).toBe(30);
	});

	it("accepts 7 and 90 day expiries", () => {
		expect(
			apiCreateUptimeShareLink.parse({
				uptimeMonitorIds: ["m1"],
				expiresInDays: 7,
			}).expiresInDays,
		).toBe(7);
		expect(
			apiCreateUptimeShareLink.parse({
				uptimeMonitorIds: ["m1"],
				expiresInDays: 90,
			}).expiresInDays,
		).toBe(90);
	});

	it("rejects unsupported expiry windows", () => {
		expect(() =>
			apiCreateUptimeShareLink.parse({
				uptimeMonitorIds: ["m1"],
				expiresInDays: 14,
			}),
		).toThrow();
	});

	it("enforces the monitor id list bounds", () => {
		expect(() =>
			apiCreateUptimeShareLink.parse({ uptimeMonitorIds: [] }),
		).toThrow();
		expect(() =>
			apiCreateUptimeShareLink.parse({
				uptimeMonitorIds: Array.from({ length: 51 }, (_, i) => `m${i}`),
			}),
		).toThrow();
		expect(() =>
			apiCreateUptimeShareLink.parse({ uptimeMonitorIds: [""] }),
		).toThrow();
	});
});

describe("apiResolveUptimeShareLink", () => {
	it("accepts a token within bounds", () => {
		const parsed = apiResolveUptimeShareLink.parse({
			token: "a".repeat(32),
		});
		expect(parsed.token).toBe("a".repeat(32));
	});

	it("rejects too-short and too-long tokens", () => {
		expect(() =>
			apiResolveUptimeShareLink.parse({ token: "short" }),
		).toThrow();
		expect(() =>
			apiResolveUptimeShareLink.parse({ token: "a".repeat(129) }),
		).toThrow();
	});
});

describe("apiCloneUptimeShareLink", () => {
	const token = "t".repeat(32);

	it("accepts a token plus monitor ids", () => {
		const parsed = apiCloneUptimeShareLink.parse({
			token,
			uptimeMonitorIds: ["m1", "m2"],
		});
		expect(parsed.uptimeMonitorIds).toEqual(["m1", "m2"]);
	});

	it("enforces the monitor id list bounds", () => {
		expect(() =>
			apiCloneUptimeShareLink.parse({ token, uptimeMonitorIds: [] }),
		).toThrow();
		expect(() =>
			apiCloneUptimeShareLink.parse({
				token,
				uptimeMonitorIds: Array.from({ length: 51 }, (_, i) => `m${i}`),
			}),
		).toThrow();
	});
});

describe("apiRevokeUptimeShareLink", () => {
	it("requires a non-empty shareLinkId", () => {
		expect(
			apiRevokeUptimeShareLink.parse({ shareLinkId: "s1" }).shareLinkId,
		).toBe("s1");
		expect(() =>
			apiRevokeUptimeShareLink.parse({ shareLinkId: "" }),
		).toThrow();
	});
});

describe("apiSearchUptimeIncidents", () => {
	it("trims the query and defaults the limit to 20", () => {
		const parsed = apiSearchUptimeIncidents.parse({ query: "  api  " });
		expect(parsed.query).toBe("api");
		expect(parsed.limit).toBe(20);
	});

	it("accepts an explicit in-range limit", () => {
		expect(apiSearchUptimeIncidents.parse({ query: "x", limit: 5 }).limit).toBe(
			5,
		);
	});

	it("rejects an empty query and an out-of-range limit", () => {
		expect(() => apiSearchUptimeIncidents.parse({ query: "" })).toThrow();
		expect(() =>
			apiSearchUptimeIncidents.parse({ query: "x", limit: 0 }),
		).toThrow();
		expect(() =>
			apiSearchUptimeIncidents.parse({ query: "x", limit: 51 }),
		).toThrow();
	});
});

describe("apiCreateApiKey", () => {
	it("trims the name and rejects blank, whitespace-only and over-long names", () => {
		expect(apiCreateApiKey.parse({ name: "  CI pipeline  " }).name).toBe("CI pipeline");
		for (const name of ["", "   ", "\t\n", "x".repeat(101)]) expect(apiCreateApiKey.safeParse({ name }).success, JSON.stringify(name)).toBe(false);
		expect(apiCreateApiKey.safeParse({ name: "x".repeat(100) }).success).toBe(true);
	});
	it("accepts explicit scope and expiry while rejecting unknown privileges", () => {
    expect(apiCreateApiKey.safeParse({ name: "CI", scope: "admin", apiAccess: "full", expiresAt: "2099-01-01" }).success).toBe(false);
    expect(apiCreateApiKey.parse({ name: "CI", scope: "read", expiresAt: "2099-01-01T00:00:00.000Z" })).toMatchObject({ scope: "read", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(apiCreateApiKey.parse({ name: "CI" }).scope).toBe("read");
	});
	it("keeps markup characters as plain text for the UI to escape", () => {
		expect(apiCreateApiKey.parse({ name: "<img src=x onerror=alert(1)>" }).name).toBe("<img src=x onerror=alert(1)>");
	});
});
