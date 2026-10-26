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
	"webhookUrl" | "webhookHeaders" | "secretVersion" | "signingSecretCipher"
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
	const { webhookUrl, webhookHeaders, secretVersion, signingSecretCipher, ...safe } = channel;
	void signingSecretCipher;
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

const PUBLIC_PATH_SEGMENTS = new Set(["api", "webhooks", "services"]);

/** Never persist or log provider-echoed configured credentials. */
export function safeChannelError(error: unknown, stored: UptimeNotificationChannelRow, options: { decrypted?: boolean } = {}): string {
  const channel = options.decrypted ? stored : decryptNotificationChannelSecrets(stored);
  const signingSecret = channel.signingSecretCipher ? decrypt(channel.signingSecretCipher) : null;
  let message = error instanceof Error ? error.message : String(error);
  const values = [signingSecret, channel.webhookUrl, ...Object.values(channel.webhookHeaders ?? {})].filter((value): value is string => Boolean(value));
  const sensitive = new Set(values.flatMap(value => [value, ...value.split(/[\s/:?&#=]+/).filter(part => part.length >= 6)]));
  // Providers can echo just a path token or a decoded query value. These are
  // credentials even when shorter than the generic message-fragment threshold.
  if (channel.webhookUrl) {
    try {
      const url = new URL(channel.webhookUrl);
      const privatePath = url.pathname.split("/").filter(value => !PUBLIC_PATH_SEGMENTS.has(value));
      for (const value of [...privatePath, ...url.searchParams.values(), url.username, url.password]) {
        if (!value) continue;
        sensitive.add(value);
        try { sensitive.add(decodeURIComponent(value)); } catch { /* Keep the encoded value for malformed escapes. */ }
      }
    } catch { /* Non-URL destinations are covered by the full-value redaction. */ }
  }
  for (const value of [...sensitive].sort((a, b) => b.length - a.length)) {
    for (const form of new Set([value, encodeURIComponent(value)])) {
      // Short tokens only match whole tokens, so "in" never redacts inside "string".
      message = form.length >= 6
        ? message.split(form).join("[redacted]")
        : message.replace(new RegExp(`(?<![A-Za-z0-9])${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "g"), "[redacted]");
    }
  }
  return message.replace(/https?:\/\/[^\s<>"']+/g, "[destination]").slice(0, 500);
}
