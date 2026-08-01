import {
	db,
	uptimeNotificationChannel,
	uptimeNotificationLog,
} from "@pulsy/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { escapeHtml } from "../../lib/html";
import {
	NotificationSendError,
	withRetry,
	type RetryResult,
} from "../../lib/retry";
import { safeFetch } from "../../lib/ssrf";
import { safeErrorSummary } from "../../lib/safe-error";
import { findEmailProviderById, sendViaProvider } from "./email-provider-service";
import { decryptNotificationChannelSecrets } from "./notification-channel-secrets";
import type { TlsCertificateInfo } from "./tls-checker-service";
import type { UptimeMonitor } from "./monitor-service";

const COMPANY_NAME = "Pulsy";
const ERROR_MAX_LENGTH = 500;

type NotificationEvent = "down" | "recovery" | "tls_expiry";

/**
 * Test seam for retry timing. Production callers pass nothing (real 30s/2m/10m
 * backoff); tests inject an instant `sleep` or `delaysMs: []` to avoid waiting.
 */
export interface DispatchOptions {
	delaysMs?: readonly number[];
	sleep?: (ms: number) => Promise<void>;
}

interface StatusChangeRecord {
	statusChangeId: string;
	uptimeMonitorId: string;
	statusBefore: string;
	statusAfter: string;
	httpStatus: number | null;
	responseTime: number | null;
	reason: string | null;
	createdAt: string;
}

interface NotificationPayload {
	monitorName: string;
	url: string;
	statusBefore: string;
	statusAfter: string;
	httpStatus: number | null;
	responseTime: number | null;
	timestamp: string;
}

function buildPayload(
	monitor: UptimeMonitor,
	statusChange: StatusChangeRecord,
): NotificationPayload {
	return {
		monitorName: monitor.name,
		url: monitor.url,
		statusBefore: statusChange.statusBefore,
		statusAfter: statusChange.statusAfter,
		httpStatus: statusChange.httpStatus,
		responseTime: statusChange.responseTime,
		timestamp: statusChange.createdAt,
	};
}

function getStatusEmoji(status: string): string {
	switch (status) {
		case "up":
			return "✅";
		case "down":
			return "🔴";
		case "degraded":
			return "⚠️";
		default:
			return "ℹ️";
	}
}

type NotificationChannel = typeof uptimeNotificationChannel.$inferSelect;

function webhookTargetKey(channel: NotificationChannel): string | null {
	if (!channel.webhookUrl) {
		return null;
	}
	return `${channel.channelType} ${channel.webhookUrl}`;
}

/**
 * Merge monitor-specific channels with the user's account-level default
 * channels (`uptimeMonitorId IS NULL`). Monitor channels always win; defaults
 * fill the gaps so no target is alerted twice for the same event:
 * - email: each recipient (trimmed, case-insensitive) gets at most one email —
 *   default email channels are narrowed to unclaimed recipients and skipped
 *   when none remain;
 * - webhook/slack/discord/telegram: deduped by channelType + webhookUrl.
 */
export function mergeChannelsForDispatch(
	channels: NotificationChannel[],
): NotificationChannel[] {
	const monitorChannels = channels.filter((c) => c.uptimeMonitorId !== null);
	const defaultChannels = channels.filter((c) => c.uptimeMonitorId === null);

	const claimedRecipients = new Set<string>();
	const claimedWebhookTargets = new Set<string>();

	const claim = (channel: NotificationChannel): void => {
		for (const recipient of channel.recipientAddresses ?? []) {
			claimedRecipients.add(recipient.trim().toLowerCase());
		}
		const key = webhookTargetKey(channel);
		if (key) {
			claimedWebhookTargets.add(key);
		}
	};

	for (const channel of monitorChannels) {
		claim(channel);
	}

	const effective: NotificationChannel[] = [...monitorChannels];

	for (const channel of defaultChannels) {
		if (channel.channelType === "email") {
			const unclaimed = (channel.recipientAddresses ?? []).filter(
				(recipient) => !claimedRecipients.has(recipient.trim().toLowerCase()),
			);
			if (unclaimed.length === 0) {
				continue;
			}
			claim(channel);
			effective.push({ ...channel, recipientAddresses: unclaimed });
			continue;
		}

		const key = webhookTargetKey(channel);
		if (key && claimedWebhookTargets.has(key)) {
			continue;
		}
		claim(channel);
		effective.push(channel);
	}

	return effective;
}

/**
 * Load the channels that apply to a monitor: its own channels plus the
 * owner's account-level defaults (unmerged).
 */
async function loadApplicableChannels(
	monitor: UptimeMonitor,
): Promise<NotificationChannel[]> {
	const channels = await db.query.uptimeNotificationChannel.findMany({
		where: or(
			and(
				eq(
					uptimeNotificationChannel.uptimeMonitorId,
					monitor.uptimeMonitorId,
				),
				eq(uptimeNotificationChannel.userId, monitor.userId),
			),
			and(
				isNull(uptimeNotificationChannel.uptimeMonitorId),
				eq(uptimeNotificationChannel.userId, monitor.userId),
			),
		),
	});

	return channels.map(decryptNotificationChannelSecrets);
}

type NotificationChannelRow = typeof uptimeNotificationChannel.$inferSelect;

/** Build the subject + HTML body for a status-change / TLS email alert. */
export function buildEmailContent(
	monitor: UptimeMonitor,
	statusChange: StatusChangeRecord,
): { subject: string; html: string } {
	const payload = buildPayload(monitor, statusChange);
	const emoji = getStatusEmoji(statusChange.statusAfter);
	const subject = `${emoji} ${monitor.name} is ${statusChange.statusAfter.toUpperCase()}`;

	const html = `
		<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
			<h2 style="margin: 0 0 16px 0;">${emoji} Monitor Alert: ${escapeHtml(monitor.name)}</h2>
			<table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
				<tr>
					<td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;">Status</td>
					<td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${escapeHtml(statusChange.statusBefore)} → ${escapeHtml(statusChange.statusAfter)}</td>
				</tr>
				<tr>
					<td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;">URL</td>
					<td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${escapeHtml(monitor.url)}</td>
				</tr>
				<tr>
					<td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;">HTTP Status</td>
					<td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${payload.httpStatus ?? "N/A"}</td>
				</tr>
				<tr>
					<td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;">Response Time</td>
					<td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${payload.responseTime ? `${payload.responseTime}ms` : "N/A"}</td>
				</tr>
				<tr>
					<td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;">Time</td>
					<td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${new Date(payload.timestamp).toUTCString()}</td>
				</tr>
			</table>
			<p style="color: #64748b; font-size: 12px;">Sent by ${COMPANY_NAME} Uptime Monitor</p>
		</div>
	`;

	return { subject, html };
}

function toErrorMessage(err: unknown): string {
	// Only retain messages created by our sender wrappers. Arbitrary thrown
	// values, transport errors, and provider SDK objects can contain request
	// URLs, credentials, headers, or response bodies.
	let message = "Delivery failed";
	if (err instanceof NotificationSendError) {
		message = err.message;
	} else if (err instanceof Error) {
		if (err.name === "TimeoutError" || err.name === "AbortError") {
			message = `Delivery failed (${err.name})`;
		} else {
			const code = (err as NodeJS.ErrnoException).code;
			if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) {
				message = `Delivery failed (${code})`;
			}
		}
	}
	return message.length > ERROR_MAX_LENGTH
		? message.slice(0, ERROR_MAX_LENGTH)
		: message;
}

/**
 * The audit target recorded for a channel — never a secret:
 * email → the recipient address; webhook/slack/discord → the URL host only
 * (the secret lives in the path); telegram → a generic label (neither bot
 * token nor chat ID is copied into the audit table).
 */
function deriveWebhookTarget(
	channel: NotificationChannelRow,
	webhookUrl: string,
): string {
	if (channel.channelType === "telegram") {
		return "telegram";
	}
	try {
		return new URL(webhookUrl).hostname;
	} catch {
		return channel.channelType;
	}
}

/** Insert one delivery-log row. A logging failure must never break dispatch. */
async function recordNotificationLog(entry: {
	userId: string;
	uptimeMonitorId: string;
	channelId: string;
	channelType: NotificationChannelRow["channelType"];
	target: string;
	event: NotificationEvent;
	statusChangeId: string | null;
	outcome: "sent" | "failed";
	attempts: number;
	providerMessageId: string | null;
	error: string | null;
}): Promise<void> {
	try {
		await db.insert(uptimeNotificationLog).values(entry);
	} catch (err) {
		console.error(
			`[uptime] Failed to write notification log: ${safeErrorSummary(err)}`,
		);
	}
}

/** Record the final send outcome and emit the matching console line. */
async function recordAndLog(
	monitor: UptimeMonitor,
	channel: NotificationChannelRow,
	target: string,
	event: NotificationEvent,
	statusChangeId: string | null,
	result: RetryResult<string | null>,
): Promise<void> {
	const outcome = result.ok ? "sent" : "failed";
	const providerMessageId = result.ok ? (result.value ?? null) : null;
	const error = result.ok ? null : toErrorMessage(result.error);
	const consoleTarget =
		channel.channelType === "email" ? "email recipient" : target;

	await recordNotificationLog({
		userId: monitor.userId,
		uptimeMonitorId: monitor.uptimeMonitorId,
		channelId: channel.channelId,
		channelType: channel.channelType,
		target,
		event,
		statusChangeId,
		outcome,
		attempts: result.attempts,
		providerMessageId,
		error,
	});

	if (result.ok) {
		console.info(
			`[uptime] Sent ${channel.channelType} notification to ${consoleTarget} for monitor ${monitor.uptimeMonitorId} (event=${event}, attempts=${result.attempts})`,
		);
	} else {
		console.error(
			`[uptime] Failed to send ${channel.channelType} notification to ${consoleTarget} for monitor ${monitor.uptimeMonitorId} (event=${event}, attempts=${result.attempts}): ${error}`,
		);
	}
}

function makeOnRetry(
	monitor: UptimeMonitor,
	channel: NotificationChannelRow,
	target: string,
): (err: unknown, attempt: number, delayMs: number) => void {
	const consoleTarget =
		channel.channelType === "email" ? "email recipient" : target;
	return (err, attempt, delayMs) => {
		console.warn(
			`[uptime] Retry ${attempt} for ${channel.channelType} notification to ${consoleTarget} (monitor ${monitor.uptimeMonitorId}) in ${delayMs}ms:`,
			toErrorMessage(err),
		);
	};
}

/** Send one webhook-family channel with retry, then record the outcome. */
async function dispatchWebhookFamilyChannel(
	monitor: UptimeMonitor,
	channel: NotificationChannelRow,
	statusChange: StatusChangeRecord,
	event: NotificationEvent,
	statusChangeId: string | null,
	opts: DispatchOptions,
): Promise<void> {
	// A misconfigured channel with no target produces no send and no log row
	// (matches the senders' own early-return guard).
	if (!channel.webhookUrl) {
		return;
	}

	const target = deriveWebhookTarget(channel, channel.webhookUrl);
	const send = async (): Promise<string | null> => {
		switch (channel.channelType) {
			case "webhook":
				await sendWebhookNotification(channel, monitor, statusChange);
				break;
			case "slack":
				await sendSlackNotification(channel, monitor, statusChange);
				break;
			case "discord":
				await sendDiscordNotification(channel, monitor, statusChange);
				break;
			/* v8 ignore next 3 -- exhaustive: email is handled separately; only webhook-family reaches here */
			case "telegram":
				await sendTelegramNotification(channel, monitor, statusChange);
				break;
		}
		return null;
	};

	const result = await withRetry(send, {
		delaysMs: opts.delaysMs,
		sleep: opts.sleep,
		onRetry: makeOnRetry(monitor, channel, target),
	});
	await recordAndLog(monitor, channel, target, event, statusChangeId, result);
}

/** Send one email channel per recipient with retry, then record each outcome. */
async function dispatchEmailChannel(
	monitor: UptimeMonitor,
	channel: NotificationChannelRow,
	statusChange: StatusChangeRecord,
	event: NotificationEvent,
	statusChangeId: string | null,
	opts: DispatchOptions,
): Promise<void> {
	if (!channel.emailProviderId || !channel.recipientAddresses?.length) {
		return;
	}

	let provider: Awaited<ReturnType<typeof findEmailProviderById>>;
	try {
		provider = await findEmailProviderById(
			channel.emailProviderId,
			monitor.userId,
			true,
		);
	} catch (err) {
		// Provider missing OR its stored credential failed to decrypt: record a
		// failed row per recipient so the miss is visible, then stop.
		await Promise.allSettled(
			channel.recipientAddresses.map((recipient) =>
				recordAndLog(monitor, channel, recipient, event, statusChangeId, {
					ok: false,
					error: err,
					attempts: 1,
				}),
			),
		);
		return;
	}

	const { subject, html } = buildEmailContent(monitor, statusChange);

	await Promise.allSettled(
		channel.recipientAddresses.map(async (recipient) => {
			const result = await withRetry(
				() => sendViaProvider(provider, recipient, subject, html),
				{
					delaysMs: opts.delaysMs,
					sleep: opts.sleep,
					onRetry: makeOnRetry(monitor, channel, recipient),
				},
			);
			await recordAndLog(
				monitor,
				channel,
				recipient,
				event,
				statusChangeId,
				result,
			);
		}),
	);
}

/**
 * Dispatch to every eligible channel in parallel. Each channel-target send is
 * independently retried, guarded, and recorded, so one slow/failing target
 * never blocks or fails the others.
 */
async function dispatchToChannels(
	monitor: UptimeMonitor,
	statusChange: StatusChangeRecord,
	event: NotificationEvent,
	channels: NotificationChannelRow[],
	opts: DispatchOptions,
): Promise<void> {
	// tls_expiry uses a synthetic status change with no persisted row.
	const statusChangeId =
		event === "tls_expiry" ? null : statusChange.statusChangeId;

	await Promise.allSettled(
		channels.map((channel) =>
			channel.channelType === "email"
				? dispatchEmailChannel(
						monitor,
						channel,
						statusChange,
						event,
						statusChangeId,
						opts,
					)
				: dispatchWebhookFamilyChannel(
						monitor,
						channel,
						statusChange,
						event,
						statusChangeId,
						opts,
					),
		),
	);
}

export const dispatchNotifications = async (
	monitor: UptimeMonitor,
	statusChange: StatusChangeRecord,
	opts: DispatchOptions = {},
): Promise<void> => {
	const isDown = statusChange.statusAfter === "down";
	const isRecovery =
		statusChange.statusAfter === "up" &&
		(statusChange.statusBefore === "down" ||
			statusChange.statusBefore === "degraded");

	if (!isDown && !isRecovery) {
		return;
	}

	const event: NotificationEvent = isDown ? "down" : "recovery";

	const channels = mergeChannelsForDispatch(
		await loadApplicableChannels(monitor),
	).filter(
		(channel) =>
			(isDown && channel.notifyOnDown) ||
			(isRecovery && channel.notifyOnRecovery),
	);

	await dispatchToChannels(monitor, statusChange, event, channels, opts);
};

export const dispatchTlsExpiryNotifications = async (
	monitor: UptimeMonitor,
	tlsInfo: TlsCertificateInfo,
	opts: DispatchOptions = {},
): Promise<void> => {
	const channels = await loadApplicableChannels(monitor);

	// Eligibility runs BEFORE the merge so a monitor channel that opted out of
	// TLS alerts never claims a target away from a TLS-opted-in default.
	const eligibleChannels = mergeChannelsForDispatch(
		channels.filter(
			(channel) =>
				channel.notifyOnTlsExpiry &&
				tlsInfo.expiresInDays <= channel.tlsExpiryThresholdDays,
		),
	);

	if (eligibleChannels.length === 0) {
		return;
	}

	const statusChange: StatusChangeRecord = {
		statusChangeId: `tls-${monitor.uptimeMonitorId}-${Date.now()}`,
		uptimeMonitorId: monitor.uptimeMonitorId,
		statusBefore: monitor.status,
		statusAfter: "degraded",
		httpStatus: monitor.httpStatus,
		responseTime: monitor.responseTime,
		reason: `TLS certificate expires in ${tlsInfo.expiresInDays} day(s) on ${tlsInfo.expiresAt}`,
		createdAt: new Date().toISOString(),
	};

	await dispatchToChannels(
		monitor,
		statusChange,
		"tls_expiry",
		eligibleChannels,
		opts,
	);
};

export const sendWebhookNotification = async (
	channel: typeof uptimeNotificationChannel.$inferSelect,
	monitor: UptimeMonitor,
	statusChange: StatusChangeRecord,
): Promise<void> => {
	if (!channel.webhookUrl) {
		return;
	}

	const payload = buildPayload(monitor, statusChange);

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"User-Agent": "Pulsy-Uptime/1.0",
	};

	if (channel.webhookHeaders) {
		for (const [key, value] of Object.entries(channel.webhookHeaders)) {
			headers[key] = value;
		}
	}

	const response = await safeFetch(channel.webhookUrl, {
		method: "POST",
		headers,
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(10000),
	});

	if (!response.ok) {
		throw new NotificationSendError(
			`Webhook returned ${response.status}`,
			response.status,
		);
	}
};

export const sendSlackNotification = async (
	channel: typeof uptimeNotificationChannel.$inferSelect,
	monitor: UptimeMonitor,
	statusChange: StatusChangeRecord,
): Promise<void> => {
	if (!channel.webhookUrl) {
		return;
	}

	const payload = buildPayload(monitor, statusChange);
	const emoji = getStatusEmoji(statusChange.statusAfter);
	const color =
		statusChange.statusAfter === "up"
			? "#22c55e"
			: statusChange.statusAfter === "down"
				? "#ef4444"
				: "#f59e0b";

	const slackPayload = {
		attachments: [
			{
				color,
				blocks: [
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: `${emoji} *${monitor.name}* is *${statusChange.statusAfter.toUpperCase()}*`,
						},
					},
					{
						type: "section",
						fields: [
							{
								type: "mrkdwn",
								text: `*URL:*\n${monitor.url}`,
							},
							{
								type: "mrkdwn",
								text: `*Status Change:*\n${statusChange.statusBefore} → ${statusChange.statusAfter}`,
							},
							{
								type: "mrkdwn",
								text: `*HTTP Status:*\n${payload.httpStatus ?? "N/A"}`,
							},
							{
								type: "mrkdwn",
								text: `*Response Time:*\n${payload.responseTime ? `${payload.responseTime}ms` : "N/A"}`,
							},
						],
					},
					{
						type: "context",
						elements: [
							{
								type: "mrkdwn",
								text: `${COMPANY_NAME} Uptime Monitor | ${new Date(payload.timestamp).toUTCString()}`,
							},
						],
					},
				],
			},
		],
	};

	const response = await safeFetch(channel.webhookUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(slackPayload),
		signal: AbortSignal.timeout(10000),
	});

	if (!response.ok) {
		throw new NotificationSendError(
			`Slack webhook returned ${response.status}`,
			response.status,
		);
	}
};

export const sendDiscordNotification = async (
	channel: typeof uptimeNotificationChannel.$inferSelect,
	monitor: UptimeMonitor,
	statusChange: StatusChangeRecord,
): Promise<void> => {
	if (!channel.webhookUrl) {
		return;
	}

	const payload = buildPayload(monitor, statusChange);
	const emoji = getStatusEmoji(statusChange.statusAfter);
	const color =
		statusChange.statusAfter === "up"
			? 0x22c55e
			: statusChange.statusAfter === "down"
				? 0xef4444
				: 0xf59e0b;

	const discordPayload = {
		embeds: [
			{
				title: `${emoji} ${monitor.name} is ${statusChange.statusAfter.toUpperCase()}`,
				color,
				fields: [
					{
						name: "URL",
						value: monitor.url,
						inline: false,
					},
					{
						name: "Status Change",
						value: `${statusChange.statusBefore} → ${statusChange.statusAfter}`,
						inline: true,
					},
					{
						name: "HTTP Status",
						value: `${payload.httpStatus ?? "N/A"}`,
						inline: true,
					},
					{
						name: "Response Time",
						value: payload.responseTime
							? `${payload.responseTime}ms`
							: "N/A",
						inline: true,
					},
				],
				footer: {
					text: `${COMPANY_NAME} Uptime Monitor`,
				},
				timestamp: payload.timestamp,
			},
		],
	};

	const response = await safeFetch(channel.webhookUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(discordPayload),
		signal: AbortSignal.timeout(10000),
	});

	if (!response.ok) {
		throw new NotificationSendError(
			`Discord webhook returned ${response.status}`,
			response.status,
		);
	}
};

export const sendTelegramNotification = async (
	channel: typeof uptimeNotificationChannel.$inferSelect,
	monitor: UptimeMonitor,
	statusChange: StatusChangeRecord,
): Promise<void> => {
	if (!channel.webhookUrl) {
		throw new Error("Telegram bot token and chat ID are required");
	}

	const { botToken, chatId } = parseTelegramTarget(
		channel.webhookUrl,
		channel.webhookHeaders,
	);

	const payload = buildPayload(monitor, statusChange);
	const emoji = getStatusEmoji(statusChange.statusAfter);

	const text = [
		`${emoji} <b>${escapeHtml(monitor.name)}</b> is <b>${statusChange.statusAfter.toUpperCase()}</b>`,
		"",
		`<b>URL:</b> ${escapeHtml(monitor.url)}`,
		`<b>Status:</b> ${statusChange.statusBefore} → ${statusChange.statusAfter}`,
		`<b>HTTP Status:</b> ${payload.httpStatus ?? "N/A"}`,
		`<b>Response Time:</b> ${payload.responseTime ? `${payload.responseTime}ms` : "N/A"}`,
		`<b>Time:</b> ${new Date(payload.timestamp).toUTCString()}`,
	].join("\n");

	const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

	const response = await fetch(telegramUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: chatId,
			text,
			parse_mode: "HTML",
		}),
		signal: AbortSignal.timeout(10000),
	});

	if (!response.ok) {
		throw new NotificationSendError(
			`Telegram API returned ${response.status}`,
			response.status,
		);
	}
};

function parseTelegramTarget(
	target: string,
	headers: Record<string, string> | null,
): { botToken: string; chatId: string } {
	if (target.startsWith("https://")) {
		const parsed = new URL(target);
		const urlMatch = parsed.hostname === "api.telegram.org"
			? parsed.pathname.match(/^\/bot([^/]+)(?:\/sendMessage)?$/)
			: null;
		const botToken = urlMatch?.[1] ?? "";
		const chatId = headers?.chat_id ?? parsed.searchParams.get("chat_id") ?? "";

		if (!botToken || !chatId) {
			throw new Error("Telegram bot token and chat ID are required");
		}

		return { botToken, chatId };
	}

	const parts = target.split(":");
	if (parts.length < 3) {
		throw new Error("Telegram target must use BOT_TOKEN:CHAT_ID format");
	}

	/* v8 ignore next -- defensive: parts.length >= 3 is guaranteed above, so the [last] ?? "" fallback is unreachable */
	const chatId = parts[parts.length - 1] ?? "";
	const botToken = parts.slice(0, -1).join(":");
	if (!botToken || !chatId) {
		throw new Error("Telegram bot token and chat ID are required");
	}

	return { botToken, chatId };
}
