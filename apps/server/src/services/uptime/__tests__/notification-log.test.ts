import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, uptimeNotificationLog } from "@pulsy/db";
import { eq } from "drizzle-orm";
import {
	createTestChannel,
	createTestEmailProvider,
	createTestMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";
import { mockFetch } from "../../../../test/fetch-mock";
import { encrypt } from "../../../lib/crypto";
import * as emailProviderService from "../email-provider-service";
import type { UptimeMonitor } from "../monitor-service";
import {
	dispatchNotifications,
	dispatchTlsExpiryNotifications,
} from "../notification-service";

const sendMail = vi.fn(async () => ({ messageId: "smtp-msg-1" }));
vi.mock("nodemailer", () => ({
	default: {
		createTransport: () => ({ sendMail, close: vi.fn() }),
	},
}));

useCleanDatabase();

// Instant, explicit retries so transient-failure assertions don't rely on the
// (test-env-disabled) default schedule and never wait real time.
const INSTANT = { sleep: async () => {}, delaysMs: [1, 1, 1] };
const NO_RETRY = { delaysMs: [] as number[] };

let userId: string;
let monitor: UptimeMonitor;

beforeEach(async () => {
	const u = await createTestUser();
	userId = u.id;
	monitor = await createTestMonitor(userId, {
		name: "Log App",
		url: "https://log.app/path",
		status: "up",
	});
	sendMail.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

function downChange() {
	return {
		statusChangeId: "sc-real",
		uptimeMonitorId: monitor.uptimeMonitorId,
		statusBefore: "up",
		statusAfter: "down",
		httpStatus: 503,
		responseTime: 1234,
		reason: "boom",
		createdAt: new Date().toISOString(),
	};
}

async function rows() {
	return db
		.select()
		.from(uptimeNotificationLog)
		.where(eq(uptimeNotificationLog.uptimeMonitorId, monitor.uptimeMonitorId));
}

describe("delivery log — targets are recorded without secrets", () => {
	it("records the URL host only for a webhook target", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.example.com/services/SECRET/TOKEN",
			});
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			const [row] = await rows();
			expect(row?.target).toBe("hooks.example.com");
			expect(row?.outcome).toBe("sent");
			expect(row?.channelType).toBe("webhook");
			expect(row?.statusChangeId).toBe("sc-real");
		} finally {
			fx.restore();
		}
	});

	it("records only a generic label for telegram targets", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "telegram",
				webhookUrl: "123456:ABC-SECRET-TOKEN:-100999",
			});
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			const [row] = await rows();
			expect(row?.target).toBe("telegram");
			expect(row?.target).not.toContain("ABC-SECRET-TOKEN");
			expect(row?.target).not.toContain("-100999");
		} finally {
			fx.restore();
		}
	});

	it("falls back to the channel type when a webhook URL cannot be parsed", async () => {
		const fx = mockFetch();
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "not a valid url",
			});
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			const [row] = await rows();
			expect(row?.target).toBe("webhook");
		} finally {
			fx.restore();
			errSpy.mockRestore();
		}
	});

	it("falls back to `telegram` when the telegram target cannot be parsed", async () => {
		const fx = mockFetch();
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "telegram",
				webhookUrl: "no-colon-token",
			});
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			const [row] = await rows();
			expect(row?.target).toBe("telegram");
			expect(row?.outcome).toBe("failed");
		} finally {
			fx.restore();
			errSpy.mockRestore();
		}
	});

	it("skips a webhook-family channel with no URL: no send, no log row", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "slack",
				webhookUrl: null,
				notifyOnDown: true,
			});
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			expect(fx.calls).toHaveLength(0);
			expect(await rows()).toHaveLength(0);
		} finally {
			fx.restore();
		}
	});
});

describe("delivery log — retry accounting", () => {
	it("records attempts=3 after two transient failures then success", async () => {
		let n = 0;
		const fx = mockFetch(() => {
			n += 1;
			return n < 3
				? new Response("upstream", { status: 503 })
				: new Response("ok", { status: 200 });
		});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.example.com/in",
			});
			await dispatchNotifications(monitor, downChange(), INSTANT);
			expect(fx.calls).toHaveLength(3);
			const [row] = await rows();
			expect(row?.outcome).toBe("sent");
			expect(row?.attempts).toBe(3);
			expect(warnSpy).toHaveBeenCalledTimes(2);
		} finally {
			fx.restore();
			warnSpy.mockRestore();
		}
	});

	it("records a failed row with attempts=4 after the schedule is exhausted", async () => {
		const fx = mockFetch(() => new Response("upstream", { status: 500 }));
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.example.com/in",
			});
			await dispatchNotifications(monitor, downChange(), INSTANT);
			// 1 initial + 3 retries.
			expect(fx.calls).toHaveLength(4);
			const [row] = await rows();
			expect(row?.outcome).toBe("failed");
			expect(row?.attempts).toBe(4);
			expect(row?.error).toContain("Webhook returned 500");
			expect(errSpy).toHaveBeenCalled();
		} finally {
			fx.restore();
			errSpy.mockRestore();
			warnSpy.mockRestore();
		}
	});
});

describe("delivery log — email provider message id + failures", () => {
	it("captures the Resend message id on a sent email row", async () => {
		const fx = mockFetch(
			() =>
				new Response(JSON.stringify({ id: "re_abc123" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		);
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
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			const [row] = await rows();
			expect(row?.outcome).toBe("sent");
			expect(row?.target).toBe("ops@pulsy.test");
			expect(row?.providerMessageId).toBe("re_abc123");
		} finally {
			fx.restore();
		}
	});

	it("records a failed row when the stored credential cannot be decrypted", async () => {
		const fx = mockFetch();
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			// A non-ciphertext apiKey makes decrypt throw at send time.
			const provider = await createTestEmailProvider(userId, {
				providerType: "resend",
				apiKey: "not-real-ciphertext",
			});
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "email",
				emailProviderId: provider.emailProviderId,
				recipientAddresses: ["ops@pulsy.test"],
			});
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			expect(fx.calls).toHaveLength(0);
			const [row] = await rows();
			expect(row?.outcome).toBe("failed");
			expect(row?.error).toContain("decrypt");
		} finally {
			fx.restore();
			errSpy.mockRestore();
		}
	});

	it("never persists or console-logs provider-controlled response bodies", async () => {
		const longBody = "provider-secret-response-".repeat(30);
		const fx = mockFetch(() => new Response(longBody, { status: 400 }));
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
			// 400 is non-transient, so a single attempt produces one safe error.
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			const [row] = await rows();
			expect(row?.outcome).toBe("failed");
			expect(row?.error).toBe("Resend API error (400)");
			expect(row?.error).not.toContain("provider-secret-response");
			expect(JSON.stringify(errSpy.mock.calls)).not.toContain(
				"provider-secret-response",
			);
		} finally {
			fx.restore();
			errSpy.mockRestore();
		}
	});

	it("redacts a non-Error rejection in storage and console output", async () => {
		const fx = mockFetch();
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		// Arbitrary rejection values must never be copied into logs.
		vi.spyOn(emailProviderService, "sendViaProvider").mockRejectedValue(
			"raw string failure",
		);
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
			await dispatchNotifications(monitor, downChange(), NO_RETRY);
			const [row] = await rows();
			expect(row?.outcome).toBe("failed");
			expect(row?.error).toBe("Delivery failed");
			expect(JSON.stringify(errSpy.mock.calls)).not.toContain(
				"raw string failure",
			);
		} finally {
			fx.restore();
			errSpy.mockRestore();
		}
	});
});

describe("delivery log — a logging failure never breaks dispatch", () => {
	it("swallows a log-write error and still completes the send", async () => {
		const fx = mockFetch();
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await createTestChannel(monitor.uptimeMonitorId, {
			channelType: "webhook",
			webhookUrl: "https://hooks.example.com/in",
		});
		// Force the log insert to throw AFTER the channel exists; the send must
		// still happen and dispatch must not reject.
		const transaction = db.transaction.bind(db);
		const failedLogInsert = vi.fn();
		const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(callback => transaction(async tx => {
			const insert = tx.insert.bind(tx);
			vi.spyOn(tx, "insert").mockImplementation(table => {
				if (table === uptimeNotificationLog) {
					failedLogInsert();
					throw new Error("log table unavailable");
				}
				return insert(table);
			});
			return callback(tx);
		}));
		try {
			await expect(
				dispatchNotifications(monitor, downChange(), NO_RETRY),
			).resolves.toBeUndefined();
			expect(fx.calls).toHaveLength(1);
			expect(failedLogInsert).toHaveBeenCalledExactlyOnceWith();
			expect(await rows()).toEqual([]);
			expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to write notification log"));
		} finally {
			transactionSpy.mockRestore();
			fx.restore();
			errSpy.mockRestore();
		}
	});
});

describe("delivery log — TLS expiry rows", () => {
	it("records a tls_expiry row with a null statusChangeId", async () => {
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, {
				channelType: "webhook",
				webhookUrl: "https://hooks.example.com/tls",
				notifyOnTlsExpiry: true,
				tlsExpiryThresholdDays: 30,
			});
			await dispatchTlsExpiryNotifications(
				monitor,
				{
					expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(),
					expiresInDays: 5,
					issuer: "Lets Encrypt",
					valid: true,
				},
				NO_RETRY,
			);
			const [row] = await rows();
			expect(row?.event).toBe("tls_expiry");
			expect(row?.statusChangeId).toBeNull();
			expect(row?.outcome).toBe("sent");
		} finally {
			fx.restore();
		}
	});
});
