import {
	db,
	uptimeNotificationChannel,
	type Database,
	type UptimeNotificationChannelRow,
} from "@pulsy/db";
import { and, eq } from "drizzle-orm";
import { decrypt, encrypt } from "../../lib/crypto";

/**
 * Stored secret format for notification channels.
 *
 * Version 0 is the legacy plaintext representation. Version 1 stores the
 * target and every custom-header value as independent AES-256-GCM payloads.
 * Header names stay readable so the UI can show which headers are configured
 * without ever receiving their values.
 */
export const NOTIFICATION_CHANNEL_SECRET_VERSION = 1;

type SecretFields = Pick<
	UptimeNotificationChannelRow,
	"webhookUrl" | "webhookHeaders" | "secretVersion"
>;

export type MaskedNotificationChannel = Omit<
	UptimeNotificationChannelRow,
	"webhookUrl" | "webhookHeaders" | "secretVersion"
> & {
	hasWebhookUrl: boolean;
	webhookUrlMasked: string | null;
	hasWebhookHeaders: boolean;
	webhookHeaderNames: string[];
};

function encryptHeaderValues(
	headers: Record<string, string> | null | undefined,
): Record<string, string> | null {
	if (!headers || Object.keys(headers).length === 0) {
		return null;
	}

	return Object.fromEntries(
		Object.entries(headers).map(([name, value]) => [name, encrypt(value)]),
	);
}

function decryptHeaderValues(
	headers: Record<string, string> | null,
): Record<string, string> | null {
	if (!headers || Object.keys(headers).length === 0) {
		return null;
	}

	return Object.fromEntries(
		Object.entries(headers).map(([name, value]) => [name, decrypt(value)]),
	);
}

/** Convert plaintext channel secrets into the current persisted format. */
export function encryptNotificationChannelSecrets(
	webhookUrl: string | null | undefined,
	webhookHeaders: Record<string, string> | null | undefined,
): SecretFields {
	return {
		webhookUrl: webhookUrl ? encrypt(webhookUrl) : null,
		webhookHeaders: encryptHeaderValues(webhookHeaders),
		secretVersion: NOTIFICATION_CHANNEL_SECRET_VERSION,
	};
}

/**
 * Resolve one stored row for server-only delivery. Legacy version-0 rows are
 * intentionally readable until the startup backfill has migrated them.
 */
export function decryptNotificationChannelSecrets(
	channel: UptimeNotificationChannelRow,
): UptimeNotificationChannelRow {
	if (channel.secretVersion === 0) {
		return channel;
	}

	if (channel.secretVersion !== NOTIFICATION_CHANNEL_SECRET_VERSION) {
		throw new Error(
			`Unsupported notification-channel secret version ${channel.secretVersion}`,
		);
	}

	try {
		return {
			...channel,
			webhookUrl: channel.webhookUrl ? decrypt(channel.webhookUrl) : null,
			webhookHeaders: decryptHeaderValues(channel.webhookHeaders),
		};
	} catch (cause) {
		throw new Error(
			`Stored notification-channel secrets could not be decrypted for channel ${channel.channelId}; check ENCRYPTION_KEY`,
			{ cause },
		);
	}
}

function maskTarget(
	channelType: UptimeNotificationChannelRow["channelType"],
	target: string | null,
): string {
	if (channelType === "telegram") {
		return "Telegram ••••••••";
	}

	if (target) {
		try {
			const parsed = new URL(target);
			return `${parsed.protocol}//${parsed.host}/••••••••`;
		} catch {
			// A corrupt legacy target must still never be echoed to the client.
		}
	}

	return "••••••••";
}

/**
 * Public API representation for a channel. It intentionally omits ciphertext,
 * plaintext, and the storage-format marker; only presence and safe labels are
 * exposed for edit forms.
 */
export function maskNotificationChannel(
	channel: UptimeNotificationChannelRow,
): MaskedNotificationChannel {
	const hasWebhookUrl = Boolean(channel.webhookUrl);
	let target: string | null = null;

	if (hasWebhookUrl) {
		try {
			target = decryptNotificationChannelSecrets(channel).webhookUrl;
		} catch {
			// Keep list endpoints available if one row is corrupt or the key was
			// rotated. Delivery/test still fail closed with an actionable error.
		}
	}

	const headerNames = Object.keys(channel.webhookHeaders ?? {}).sort();
	const { webhookUrl, webhookHeaders, secretVersion, ...safe } = channel;
	void webhookUrl;
	void webhookHeaders;
	void secretVersion;

	return {
		...safe,
		hasWebhookUrl,
		webhookUrlMasked: hasWebhookUrl
			? maskTarget(channel.channelType, target)
			: null,
		hasWebhookHeaders: headerNames.length > 0,
		webhookHeaderNames: headerNames,
	};
}

/**
 * Upgrade all legacy plaintext rows inside one transaction. The version guard
 * makes repeat and concurrent runs idempotent. A failure rolls the transaction
 * back, allowing startup to fail before any plaintext-backed API is served.
 */
export async function migrateLegacyNotificationChannelSecrets(
	database: Database = db,
): Promise<number> {
	return database.transaction(async (tx) => {
		const legacyRows = await tx
			.select()
			.from(uptimeNotificationChannel)
			.where(eq(uptimeNotificationChannel.secretVersion, 0));

		let migrated = 0;
		for (const channel of legacyRows) {
			const [updated] = await tx
				.update(uptimeNotificationChannel)
				.set(
					encryptNotificationChannelSecrets(
						channel.webhookUrl,
						channel.webhookHeaders,
					),
				)
				.where(
					and(
						eq(uptimeNotificationChannel.channelId, channel.channelId),
						eq(uptimeNotificationChannel.secretVersion, 0),
					),
				)
				.returning({ channelId: uptimeNotificationChannel.channelId });

			/* v8 ignore next -- only a concurrent migrator can win the version guard between SELECT and UPDATE */
			if (updated) {
				migrated += 1;
			}
		}

		return migrated;
	});
}
