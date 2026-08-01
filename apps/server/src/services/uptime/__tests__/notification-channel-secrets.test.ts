import { describe, expect, it } from "vitest";
import { uptimeNotificationChannel } from "@pulsy/db";
import { eq } from "drizzle-orm";
import {
	createTestChannel,
	createTestMonitor,
	createTestUser,
	db,
	useCleanDatabase,
} from "../../../../test/db";
import {
	decryptNotificationChannelSecrets,
	encryptNotificationChannelSecrets,
	maskNotificationChannel,
	migrateLegacyNotificationChannelSecrets,
} from "../notification-channel-secrets";

useCleanDatabase();

async function legacyChannel(
	overrides: Partial<typeof uptimeNotificationChannel.$inferInsert> = {},
) {
	const user = await createTestUser();
	const monitor = await createTestMonitor(user.id);
	return createTestChannel(monitor.uptimeMonitorId, {
		webhookUrl: "https://hooks.example.com/private/token",
		webhookHeaders: {
			Authorization: "Bearer header-secret",
			"X-Signature": "same-value",
			"X-Signature-Again": "same-value",
		},
		...overrides,
		secretVersion: 0,
	});
}

describe("notification-channel secret storage", () => {
	it("encrypts the target and every header value, then decrypts server-side", async () => {
		const legacy = await legacyChannel();
		const encrypted = encryptNotificationChannelSecrets(
			legacy.webhookUrl,
			legacy.webhookHeaders,
		);

		expect(encrypted.secretVersion).toBe(1);
		expect(encrypted.webhookUrl).not.toBe(legacy.webhookUrl);
		expect(encrypted.webhookHeaders?.Authorization).not.toBe(
			legacy.webhookHeaders?.Authorization,
		);
		// Independent random nonces prevent equal values from producing equal
		// ciphertext within the JSON object.
		expect(encrypted.webhookHeaders?.["X-Signature"]).not.toBe(
			encrypted.webhookHeaders?.["X-Signature-Again"],
		);

		expect(
			decryptNotificationChannelSecrets({ ...legacy, ...encrypted }),
		).toMatchObject({
			webhookUrl: legacy.webhookUrl,
			webhookHeaders: legacy.webhookHeaders,
		});
	});

	it("normalizes absent and empty secrets to null", async () => {
		const legacy = await legacyChannel({
			channelType: "email",
			webhookUrl: null,
			webhookHeaders: null,
		});
		const empty = encryptNotificationChannelSecrets(null, {});
		expect(empty).toEqual({
			webhookUrl: null,
			webhookHeaders: null,
			secretVersion: 1,
		});
		expect(
			decryptNotificationChannelSecrets({ ...legacy, ...empty }),
		).toMatchObject({ webhookUrl: null, webhookHeaders: null });
	});

	it("keeps version-0 plaintext rows readable during rollout", async () => {
		const legacy = await legacyChannel();
		expect(decryptNotificationChannelSecrets(legacy)).toBe(legacy);
	});

	it("fails closed for unknown, corrupt, or wrong-key ciphertext", async () => {
		const legacy = await legacyChannel();
		expect(() =>
			decryptNotificationChannelSecrets({ ...legacy, secretVersion: 99 }),
		).toThrow(/Unsupported notification-channel secret version/);

		const corrupt = {
			...legacy,
			secretVersion: 1,
			webhookUrl: "AAAA",
		};
		expect(() => decryptNotificationChannelSecrets(corrupt)).toThrow(
			/ENCRYPTION_KEY/,
		);
		const masked = maskNotificationChannel(corrupt);
		expect(masked.webhookUrlMasked).toBe("••••••••");
		expect(masked).not.toHaveProperty("webhookUrl");
	});

	it("returns only masked presence metadata to clients", async () => {
		const legacy = await legacyChannel();
		const encrypted = {
			...legacy,
			...encryptNotificationChannelSecrets(
				legacy.webhookUrl,
				legacy.webhookHeaders,
			),
		};
		const masked = maskNotificationChannel(encrypted);

		expect(masked).toMatchObject({
			hasWebhookUrl: true,
			webhookUrlMasked: "https://hooks.example.com/••••••••",
			hasWebhookHeaders: true,
			webhookHeaderNames: [
				"Authorization",
				"X-Signature",
				"X-Signature-Again",
			],
		});
		expect(masked).not.toHaveProperty("webhookUrl");
		expect(masked).not.toHaveProperty("webhookHeaders");
		expect(masked).not.toHaveProperty("secretVersion");

		const telegram = maskNotificationChannel({
			...encrypted,
			channelType: "telegram",
		});
		expect(telegram.webhookUrlMasked).toBe("Telegram ••••••••");

		const invalidLegacy = maskNotificationChannel({
			...legacy,
			webhookUrl: "not a URL or token",
			webhookHeaders: {},
		});
		expect(invalidLegacy).toMatchObject({
			webhookUrlMasked: "••••••••",
			hasWebhookHeaders: false,
			webhookHeaderNames: [],
		});

		const absent = maskNotificationChannel({
			...legacy,
			webhookUrl: null,
			webhookHeaders: null,
		});
		expect(absent).toMatchObject({
			hasWebhookUrl: false,
			webhookUrlMasked: null,
			hasWebhookHeaders: false,
		});
	});
});

describe("legacy notification-channel backfill", () => {
	it("encrypts plaintext rows atomically and is idempotent", async () => {
		const first = await legacyChannel();
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id);
		const second = await createTestChannel(monitor.uptimeMonitorId, {
			channelType: "email",
			webhookUrl: null,
			webhookHeaders: null,
			secretVersion: 0,
		});

		await expect(migrateLegacyNotificationChannelSecrets()).resolves.toBe(2);
		const rows = await db
			.select()
			.from(uptimeNotificationChannel)
			.orderBy(uptimeNotificationChannel.channelId);
		expect(rows.every((row) => row.secretVersion === 1)).toBe(true);
		const migratedFirst = rows.find(
			(row) => row.channelId === first.channelId,
		);
		expect(migratedFirst?.webhookUrl).not.toBe(first.webhookUrl);
		expect(
			migratedFirst && decryptNotificationChannelSecrets(migratedFirst),
		).toMatchObject({
			webhookUrl: first.webhookUrl,
			webhookHeaders: first.webhookHeaders,
		});
		expect(
			rows.find((row) => row.channelId === second.channelId),
		).toMatchObject({ webhookUrl: null, webhookHeaders: null });

		await expect(migrateLegacyNotificationChannelSecrets()).resolves.toBe(0);
	});

	it("rolls every row back if one legacy payload cannot be encrypted", async () => {
		const good = await legacyChannel();
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id);
		const bad = await createTestChannel(monitor.uptimeMonitorId, {
			webhookUrl: "https://hooks.example.com/bad",
			webhookHeaders: {
				Authorization: 42,
			} as unknown as Record<string, string>,
			secretVersion: 0,
		});

		await expect(migrateLegacyNotificationChannelSecrets()).rejects.toThrow();
		const rows = await db
			.select()
			.from(uptimeNotificationChannel)
			.where(eq(uptimeNotificationChannel.secretVersion, 0));
		expect(rows.map((row) => row.channelId).sort()).toEqual(
			[good.channelId, bad.channelId].sort(),
		);
		expect(rows.find((row) => row.channelId === good.channelId)).toMatchObject({
			webhookUrl: good.webhookUrl,
			webhookHeaders: good.webhookHeaders,
		});
	});
});
