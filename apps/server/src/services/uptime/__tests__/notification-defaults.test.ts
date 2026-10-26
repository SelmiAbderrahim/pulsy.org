import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uptimeNotificationChannel } from "@pulsy/db";
import {
	createTestChannel,
	createTestDefaultChannel,
	createTestEmailProvider,
	createTestMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";
import { mockFetch } from "../../../../test/fetch-mock";
import { encrypt } from "../../../lib/crypto";
import type { UptimeMonitor } from "../monitor-service";
import {
	dispatchNotifications,
	dispatchTlsExpiryNotifications,
	mergeChannelsForDispatch,
} from "../notification-service";

type NotificationChannel = typeof uptimeNotificationChannel.$inferSelect;

useCleanDatabase();

let userId: string;
let monitor: UptimeMonitor;

beforeEach(async () => {
	const u = await createTestUser();
	userId = u.id;
	monitor = await createTestMonitor(userId, {
		name: "Defaults Monitor",
		url: "https://my.app/path",
		status: "up",
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

function downChange() {
	return {
		statusChangeId: "sc1",
		uptimeMonitorId: monitor.uptimeMonitorId,
		statusBefore: "up",
		statusAfter: "down",
		httpStatus: 503,
		responseTime: 1234,
		reason: "boom",
		createdAt: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------
// mergeChannelsForDispatch — pure merge/dedup semantics
// ---------------------------------------------------------------------------

let seq = 0;

function chan(
	overrides: Partial<NotificationChannel> = {},
): NotificationChannel {
	seq += 1;
	return {
		channelId: `ch_${seq}`,
		uptimeMonitorId: "mon_1",
		userId: "user_1",
		channelType: "webhook",
		signingSecretCipher: null,
		notifyOnDegraded: false,
		emailProviderId: null,
		recipientAddresses: null,
		webhookUrl: "https://hooks.test/in",
		webhookHeaders: null,
		secretVersion: 0,
		notifyOnDown: true,
		notifyOnRecovery: true,
		notifyOnTlsExpiry: false,
		tlsExpiryThresholdDays: 14,
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

describe("mergeChannelsForDispatch", () => {
	it("keeps monitor channels and appends non-overlapping defaults", () => {
		const monitorChannel = chan({ webhookUrl: "https://hooks.test/a" });
		const defaultChannel = chan({
			uptimeMonitorId: null,
			webhookUrl: "https://hooks.test/b",
		});
		const merged = mergeChannelsForDispatch([monitorChannel, defaultChannel]);
		expect(merged).toHaveLength(2);
		expect(merged[0]?.channelId).toBe(monitorChannel.channelId);
		expect(merged[1]?.channelId).toBe(defaultChannel.channelId);
	});

	it("skips a default webhook whose type+url matches a monitor channel", () => {
		const merged = mergeChannelsForDispatch([
			chan({ webhookUrl: "https://hooks.test/same" }),
			chan({ uptimeMonitorId: null, webhookUrl: "https://hooks.test/same" }),
		]);
		expect(merged).toHaveLength(1);
	});

	it("keeps a default with the same url but a different channel type", () => {
		const merged = mergeChannelsForDispatch([
			chan({ channelType: "webhook", webhookUrl: "https://hooks.test/same" }),
			chan({
				uptimeMonitorId: null,
				channelType: "slack",
				webhookUrl: "https://hooks.test/same",
			}),
		]);
		expect(merged).toHaveLength(2);
	});

	it("narrows a default email channel to unclaimed recipients (case-insensitive, trimmed)", () => {
		const merged = mergeChannelsForDispatch([
			chan({
				channelType: "email",
				webhookUrl: null,
				recipientAddresses: ["Ops@pulsy.test"],
			}),
			chan({
				uptimeMonitorId: null,
				channelType: "email",
				webhookUrl: null,
				recipientAddresses: [" ops@pulsy.test ", "oncall@pulsy.test"],
			}),
		]);
		expect(merged).toHaveLength(2);
		expect(merged[1]?.recipientAddresses).toEqual(["oncall@pulsy.test"]);
	});

	it("skips a default email channel when every recipient is already claimed", () => {
		const merged = mergeChannelsForDispatch([
			chan({
				channelType: "email",
				webhookUrl: null,
				recipientAddresses: ["ops@pulsy.test"],
			}),
			chan({
				uptimeMonitorId: null,
				channelType: "email",
				webhookUrl: null,
				recipientAddresses: ["ops@pulsy.test"],
			}),
		]);
		expect(merged).toHaveLength(1);
	});

	it("lets an earlier default claim recipients away from a later default", () => {
		const merged = mergeChannelsForDispatch([
			chan({
				uptimeMonitorId: null,
				channelType: "email",
				webhookUrl: null,
				recipientAddresses: ["ops@pulsy.test"],
			}),
			chan({
				uptimeMonitorId: null,
				channelType: "email",
				webhookUrl: null,
				recipientAddresses: ["ops@pulsy.test"],
			}),
		]);
		expect(merged).toHaveLength(1);
	});

	it("skips a default email channel with no recipients at all", () => {
		const merged = mergeChannelsForDispatch([
			chan({
				uptimeMonitorId: null,
				channelType: "email",
				webhookUrl: null,
				recipientAddresses: null,
			}),
		]);
		expect(merged).toHaveLength(0);
	});

	it("returns only defaults when the monitor has no channels of its own", () => {
		const merged = mergeChannelsForDispatch([
			chan({ uptimeMonitorId: null, webhookUrl: "https://hooks.test/only" }),
		]);
		expect(merged).toHaveLength(1);
	});

	it("keeps a default whose webhookUrl is unset (sender guards handle it)", () => {
		const merged = mergeChannelsForDispatch([
			chan({ webhookUrl: "https://hooks.test/a" }),
			chan({ uptimeMonitorId: null, webhookUrl: null }),
		]);
		expect(merged).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// dispatchNotifications — default channels apply to every monitor
// ---------------------------------------------------------------------------

describe("dispatchNotifications with default channels", () => {
	it("fires a down alert through a default-only webhook channel", async () => {
		const fx = mockFetch();
		try {
			await createTestDefaultChannel(userId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/default",
			});
			await dispatchNotifications(monitor, downChange());
			expect(fx.calls).toHaveLength(1);
			expect(fx.calls[0]?.url).toBe("https://hooks.test/default");
		} finally {
			fx.restore();
		}
	});

	it("does not fire another user's default channel", async () => {
		const fx = mockFetch();
		try {
			const other = await createTestUser();
			await createTestDefaultChannel(other.id, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/other",
			});
			await dispatchNotifications(monitor, downChange());
			expect(fx.calls).toHaveLength(0);
		} finally {
			fx.restore();
		}
	});

	it("sends exactly one request when a monitor and default webhook share a target", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/same",
			});
			await createTestDefaultChannel(userId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/same",
			});
			await dispatchNotifications(monitor, downChange());
			expect(fx.calls).toHaveLength(1);
		} finally {
			fx.restore();
		}
	});

	it("emails each recipient at most once when monitor and default channels overlap", async () => {
		const fx = mockFetch();
		try {
			const provider = await createTestEmailProvider(userId, {
				providerType: "resend",
				apiKey: encrypt("re_real_key"),
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "email",
				emailProviderId: provider.emailProviderId,
				recipientAddresses: ["ops@pulsy.test"],
			});
			await createTestDefaultChannel(userId, {
				channelType: "email",
				webhookUrl: null,
				emailProviderId: provider.emailProviderId,
				recipientAddresses: ["ops@pulsy.test", "oncall@pulsy.test"],
			});
			await dispatchNotifications(monitor, downChange());
			// ops@ via the monitor channel, oncall@ via the narrowed default.
			expect(fx.calls).toHaveLength(2);
			const recipients = fx.calls
				.map((c) => JSON.parse(c.body ?? "{}").to)
				.flat()
				.sort();
			expect(recipients).toEqual(["oncall@pulsy.test", "ops@pulsy.test"]);
		} finally {
			fx.restore();
		}
	});

	it("respects notifyOnDown=false on a default channel", async () => {
		const fx = mockFetch();
		try {
			await createTestDefaultChannel(userId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/default",
				notifyOnDown: false,
			});
			await dispatchNotifications(monitor, downChange());
			expect(fx.calls).toHaveLength(0);
		} finally {
			fx.restore();
		}
	});
});

// ---------------------------------------------------------------------------
// dispatchTlsExpiryNotifications — eligibility runs before the merge
// ---------------------------------------------------------------------------

describe("dispatchTlsExpiryNotifications with default channels", () => {
	const tlsInfo = {
		expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(),
		expiresInDays: 5,
		issuer: "Lets Encrypt",
		valid: true,
	};

	it("fires a TLS alert through a default-only channel", async () => {
		const fx = mockFetch();
		try {
			await createTestDefaultChannel(userId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/tls",
				notifyOnTlsExpiry: true,
				tlsExpiryThresholdDays: 14,
			});
			await dispatchTlsExpiryNotifications(monitor, tlsInfo);
			expect(fx.calls).toHaveLength(1);
		} finally {
			fx.restore();
		}
	});

	it("lets a TLS-opted-in default fire even when a monitor channel with the same target opted out", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/tls",
				notifyOnTlsExpiry: false,
			});
			await createTestDefaultChannel(userId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/tls",
				notifyOnTlsExpiry: true,
				tlsExpiryThresholdDays: 14,
			});
			await dispatchTlsExpiryNotifications(monitor, tlsInfo);
			expect(fx.calls).toHaveLength(1);
		} finally {
			fx.restore();
		}
	});

	it("dedupes when both a monitor and a default channel opt into TLS alerts for the same target", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/tls",
				notifyOnTlsExpiry: true,
				tlsExpiryThresholdDays: 14,
			});
			await createTestDefaultChannel(userId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.test/tls",
				notifyOnTlsExpiry: true,
				tlsExpiryThresholdDays: 14,
			});
			await dispatchTlsExpiryNotifications(monitor, tlsInfo);
			expect(fx.calls).toHaveLength(1);
		} finally {
			fx.restore();
		}
	});
});
