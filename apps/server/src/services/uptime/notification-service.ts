import { appendIncidentAlert } from "./incident-timeline";
import { channelTargetError } from "./channel-target";
import { buildWebhookBody, webhookHeaders } from "./webhook-contract";
import { getTranslator } from "../../lib/i18n";
import { checkErrorCodeOf, type CheckErrorCode } from "@pulsy/db/check-error";
import { describeCheckReason } from "./check-error";
import { ensureWebhookSecret } from "./notification-channel-secrets";
import { uptimeDeferredAlert, uptimeIncidentEscalation, uptimeMonitor, type DbExecutor } from "@pulsy/db";
import { createHash } from "node:crypto";
import { deferSuppressedAlert, recoveryDeliveryTargets } from "./maintenance-service";
import { incidentRecoveryDelivery } from "./incident-delivery";
import { safeChannelError } from "./notification-channel-secrets";
import {
	db,
	uptimeNotificationChannel,
  uptimeMonitorChannelBinding,
	uptimeNotificationLog,
} from "@pulsy/db";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { escapeHtml } from "../../lib/html";
import {
	NotificationSendError,
	isTransientSendError,
	withRetry,
	type RetryResult,
} from "../../lib/retry";
import { safeFetch } from "../../lib/ssrf";
import { findEmailProviderById, sendViaProvider } from "./email-provider-service";
import { decryptNotificationChannelSecrets } from "./notification-channel-secrets";
import type { TlsCertificateInfo } from "./tls-checker-service";
import type { UptimeMonitor } from "./monitor-service";
import { serverHealthNotice } from "./server-health-notice";

const COMPANY_NAME = "Pulsy";
const ERROR_MAX_LENGTH = 500;

type NotificationEvent = "down" | "degraded" | "recovery" | "tls_expiry";

/**
 * Test seam for retry timing. Production callers pass nothing (real 30s/2m/10m
 * backoff); tests inject an instant `sleep` or `delaysMs: []` to avoid waiting.
 */
export interface DispatchOptions {
	delaysMs?: readonly number[];
	sleep?: (ms: number) => Promise<void>;
	resumeSuppressed?: boolean;
	deduplicate?: boolean;
	strictAudit?: boolean;
	finishedTargets?: string[];
	deferredAlertId?: string;
	sourceOutageId?: string;
	escalationJobId?: string;
	escalationLeaseToken?: string;
	isIncidentCurrent?: () => Promise<boolean>;
	allowedRecoveryTargets?: string[];
	onSuppressed?: () => void;
	onResult?: (result: { key: string; ok: boolean; retryable: boolean }) => void | Promise<void>;
}

interface StatusChangeRecord {
  test?: boolean;
  webhookEvent?: "monitor.tls_expiring";
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
	reason?: string;
  reasonCode?: CheckErrorCode;
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
    ...(monitor.monitorType === "server" ? { reason: serverHealthNotice(monitor, statusChange).reason } : statusChange.reason ? {
      // Same code → label mapping as the dashboard; alert text is English until notification i18n lands.
      reason: describeCheckReason(statusChange.reason, getTranslator("en"), { httpStatus: statusChange.httpStatus, timeoutMs: monitor.timeout })!,
      ...(checkErrorCodeOf(statusChange.reason) ? { reasonCode: checkErrorCodeOf(statusChange.reason)! } : {}),
    } : {}),
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

	const referenced = await db.select({ channel: uptimeNotificationChannel }).from(uptimeMonitorChannelBinding)
    .innerJoin(uptimeNotificationChannel, eq(uptimeMonitorChannelBinding.channelId, uptimeNotificationChannel.channelId))
    .where(and(eq(uptimeMonitorChannelBinding.userId, monitor.userId), eq(uptimeMonitorChannelBinding.monitorId, monitor.uptimeMonitorId), eq(uptimeNotificationChannel.userId, monitor.userId))).limit(20);
  const byId = new Map(channels.map(channel => [channel.channelId, channel]));
  for (const { channel } of referenced) if (!byId.has(channel.channelId)) byId.set(channel.channelId, { ...channel, uptimeMonitorId: monitor.uptimeMonitorId });
  return [...byId.values()].map(decryptNotificationChannelSecrets);
}

type NotificationChannelRow = typeof uptimeNotificationChannel.$inferSelect;

/** Build the subject + HTML body for a status-change / TLS email alert. */
export function buildEmailContent(
	monitor: UptimeMonitor,
	statusChange: StatusChangeRecord,
): { subject: string; html: string } {
	if (monitor.monitorType === "server") return serverHealthNotice(monitor, statusChange);
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
                ${payload.reason ? `<tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;">Reason</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${escapeHtml(payload.reason)}</td></tr>` : ""}
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
}, strict = false, dbc: DbExecutor = db, incidentId?: string): Promise<void> {
	try {
    const write = async (tx: DbExecutor) => {
      const [log] = await tx.insert(uptimeNotificationLog).values(entry).returning({ id: uptimeNotificationLog.notificationLogId });
      if (log) await appendIncidentAlert(entry, log.id, tx, incidentId);
    };
    if (dbc === db) await db.transaction(write); else await write(dbc);
	} catch (err) {
		console.error(`[uptime] Failed to write notification log for monitor ${entry.uptimeMonitorId}`);
		if (strict) throw err;
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
	opts: DispatchOptions = {},
	key = `${channel.channelId}:${target}`,
): Promise<void> {
	const outcome = result.ok ? "sent" : "failed";
	const providerMessageId = result.ok ? (result.value ?? null) : null;
	const error = result.ok ? null : safeChannelError(new Error(toErrorMessage(result.error)), channel, { decrypted: true });

	const retryable = !result.ok && isTransientSendError(result.error);
	const entry = {
		userId: monitor.userId, uptimeMonitorId: monitor.uptimeMonitorId, channelId: channel.channelId,
		channelType: channel.channelType, target, event, statusChangeId, outcome,
		attempts: result.attempts, providerMessageId, error,
	} as const;
  if (opts.escalationJobId) {
    await db.transaction(async tx => {
      // Cancellation/configuration lock parent before child. Match that order:
      // inserting the audit takes a parent FK lock, so child-first can deadlock.
      const [parent] = await tx.select({ id: uptimeMonitor.uptimeMonitorId }).from(uptimeMonitor)
        .where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, monitor.userId))).for("update");
      if (!parent) return; // Owner deletion deliberately removes its delivery history.
      if (!opts.escalationLeaseToken) throw new Error("Escalation lease missing");
      const where = and(eq(uptimeIncidentEscalation.id, opts.escalationJobId!), eq(uptimeIncidentEscalation.userId, monitor.userId),
        eq(uptimeIncidentEscalation.monitorId, monitor.uptimeMonitorId), eq(uptimeIncidentEscalation.leaseToken, opts.escalationLeaseToken));
      const [job] = await tx.select().from(uptimeIncidentEscalation).where(where).for("update");
      if (!job || statusChangeId !== `incident-escalation-${job.id}`) throw new Error("Escalation delivery no longer exists");
      await recordNotificationLog(entry, true, tx, job.incidentId);
      await tx.update(uptimeIncidentEscalation).set({ finishedTargets: retryable ? job.finishedTargets : [...new Set([...job.finishedTargets, key])],
        deliveredTargets: result.ok ? [...new Set([...job.deliveredTargets, key])] : job.deliveredTargets,
        leaseUntil: job.state === "processing" ? new Date(Date.now() + 300_000).toISOString() : job.leaseUntil }).where(where);
    });
  } else if (opts.deferredAlertId) {
		await db.transaction(async tx => {
      // Monitor deletion cascades to this job, so acquire the parent first.
      const [parent] = await tx.select({ id: uptimeMonitor.uptimeMonitorId }).from(uptimeMonitor)
        .where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, monitor.userId))).for("update");
      if (!parent) return;
			const where = and(eq(uptimeDeferredAlert.id, opts.deferredAlertId!), eq(uptimeDeferredAlert.userId, monitor.userId), eq(uptimeDeferredAlert.statusChangeId, statusChangeId!));
			const [job] = await tx.select().from(uptimeDeferredAlert).where(where).for("update");
			if (!job) throw new Error("Deferred delivery no longer exists");
			await recordNotificationLog(entry, true, tx);
      if (result.ok && job.deliveredTargets.length === 0 && (event === "down" || event === "degraded")) {
        await tx.update(uptimeMonitor).set({ lastOperationalAlertAt: new Date().toISOString(), lastOperationalAlertId: statusChangeId })
          .where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, monitor.userId)));
      }
			await tx.update(uptimeDeferredAlert).set({
				finishedTargets: retryable ? job.finishedTargets : [...new Set([...job.finishedTargets, key])],
				deliveredTargets: result.ok ? [...new Set([...job.deliveredTargets, key])] : job.deliveredTargets,
			}).where(where);
		});
	} else await recordNotificationLog(entry, opts.strictAudit);
	await opts.onResult?.({ key, ok: result.ok, retryable });

	const consoleTarget = channel.channelType === "email" ? "email recipient" : target;
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

class SuppressedDelivery extends NotificationSendError {
	constructor() { super("Alert suppressed by maintenance or snooze", 409); }
}
function deliveryTargetKey(channel: NotificationChannelRow, destination: string): string {
	const value = channel.channelType === "email" ? destination.trim().toLowerCase() : destination;
	return createHash("sha256").update(`${channel.channelId}\0${channel.channelType}\0${value}`).digest("hex");
}
function skipTarget(opts: DispatchOptions, key: string): boolean {
	return Boolean(opts.finishedTargets?.includes(key) || (opts.allowedRecoveryTargets && !opts.allowedRecoveryTargets.includes(key)));
}

/** Every queued alert must still describe the current owned episode at send time. */
async function ensureCurrentOperationalDelivery(monitor: UptimeMonitor, change: StatusChangeRecord, opts: DispatchOptions) {
  if (opts.isIncidentCurrent && !await opts.isIncidentCurrent()) throw new SuppressedDelivery();
  if (!opts.deferredAlertId) return;
  const [current] = await db.select({ status: uptimeMonitor.status, active: uptimeMonitor.active,
    outageId: uptimeMonitor.notificationOutageId, policy: uptimeMonitor.latencyPolicy, monitorType: uptimeMonitor.monitorType }).from(uptimeMonitor)
    .where(and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, monitor.userId))).limit(1);
  const expected = opts.sourceOutageId ?? monitor.notificationOutageId ?? change.statusChangeId;
  if (!current || !current.active || current.status !== change.statusAfter || (current.outageId !== null && current.outageId !== expected) || current.policy?.importance === "informational" || change.statusAfter === "degraded" && !current.policy && current.monitorType !== "heartbeat" && current.monitorType !== "server") {
    throw new SuppressedDelivery();
  }
}
async function suppressedBeforeSend(monitor: UptimeMonitor, change: StatusChangeRecord, _opts: DispatchOptions) {
  return deferSuppressedAlert(monitor, change, db, true);
}

// Durable jobs send at most four transports at a time and serialize email recipients.
async function settleTargets<T>(targets: T[], send: (target: T) => Promise<void>, wave: number) {
  const results: PromiseSettledResult<void>[] = [];
  for (let offset = 0; offset < targets.length; offset += wave) {
    results.push(...await Promise.allSettled(targets.slice(offset, offset + wave).map(send)));
  }
  return results;
}

/** Freeze one logical delivery before I/O, including retries by a fresh worker. */
async function durableWebhookBody(channelId: string, monitor: UptimeMonitor, change: StatusChangeRecord, opts: DispatchOptions): Promise<string> {
  if (opts.escalationJobId) {
    return db.transaction(async tx => {
      if (!opts.escalationLeaseToken) throw new Error("Escalation lease missing");
      const where = and(eq(uptimeIncidentEscalation.id, opts.escalationJobId!), eq(uptimeIncidentEscalation.userId, monitor.userId),
        eq(uptimeIncidentEscalation.monitorId, monitor.uptimeMonitorId), eq(uptimeIncidentEscalation.leaseToken, opts.escalationLeaseToken));
      const [job] = await tx.select().from(uptimeIncidentEscalation).where(where).for("update");
      if (!job?.snapshot || change.statusChangeId !== `incident-escalation-${job.id}`) throw new Error("Escalation snapshot missing");
      if (job.snapshot.webhookBodies && Object.hasOwn(job.snapshot.webhookBodies, channelId)) return job.snapshot.webhookBodies[channelId]!;
      const body = await buildWebhookBody(channelId, monitor, change);
      await tx.update(uptimeIncidentEscalation).set({ snapshot: { ...job.snapshot, webhookBodies: { ...job.snapshot.webhookBodies, [channelId]: body } } }).where(where);
      return body;
    });
  }
  if (!opts.deferredAlertId) return buildWebhookBody(channelId, monitor, change);
  return db.transaction(async tx => {
    const where = and(eq(uptimeDeferredAlert.id, opts.deferredAlertId!), eq(uptimeDeferredAlert.userId, monitor.userId),
      eq(uptimeDeferredAlert.monitorId, monitor.uptimeMonitorId), eq(uptimeDeferredAlert.statusChangeId, change.statusChangeId));
    const [job] = await tx.select().from(uptimeDeferredAlert).where(where).for("update");
    if (!job) throw new Error("Deferred delivery no longer exists");
    if (job.snapshot.webhookBodies && Object.hasOwn(job.snapshot.webhookBodies, channelId)) return job.snapshot.webhookBodies[channelId]!;
    const body = await buildWebhookBody(channelId, monitor, change);
    await tx.update(uptimeDeferredAlert).set({ snapshot: { ...job.snapshot, webhookBodies: { ...job.snapshot.webhookBodies, [channelId]: body } } }).where(where);
    return body;
  });
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
	const key = deliveryTargetKey(channel, channel.webhookUrl);
	if (skipTarget(opts, key) || (opts.deduplicate && await alreadyDelivered(monitor, channel, target, statusChangeId))) return;
	let webhookBody: string | undefined;
	const send = async (): Promise<string | null> => {
    await ensureCurrentOperationalDelivery(monitor, statusChange, opts);
		if ((event === "down" || event === "degraded") && await suppressedBeforeSend(monitor, statusChange, opts)) throw new SuppressedDelivery();
		switch (channel.channelType) {
			case "webhook":
				webhookBody ??= await durableWebhookBody(channel.channelId, monitor, statusChange, opts);
				await sendWebhookNotification(channel, monitor, statusChange, webhookBody);
				break;
			case "slack":
				await sendSlackNotification(channel, monitor, statusChange);
				break;
			case "discord":
				await sendDiscordNotification(channel, monitor, statusChange);
				break;
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
	if (!result.ok && result.error instanceof SuppressedDelivery) { opts.onSuppressed?.(); return; }
	await recordAndLog(monitor, channel, target, event, statusChangeId, result, opts, key);
}

async function alreadyDelivered(monitor: UptimeMonitor, channel: NotificationChannelRow, target: string, statusChangeId: string | null): Promise<boolean> {
	if (!statusChangeId) return false;
	return Boolean(await db.query.uptimeNotificationLog.findFirst({ where: and(
		eq(uptimeNotificationLog.userId, monitor.userId), eq(uptimeNotificationLog.channelId, channel.channelId),
		eq(uptimeNotificationLog.target, target), eq(uptimeNotificationLog.statusChangeId, statusChangeId), eq(uptimeNotificationLog.outcome, "sent"),
	) }));
}

function assertDurableResults(results: PromiseSettledResult<unknown>[], opts: DispatchOptions): void {
	if (opts.strictAudit && results.some(result => result.status === "rejected")) throw new Error("Delivery audit could not be saved");
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
		const results = await settleTargets(channel.recipientAddresses, async (recipient) => {
				const key = deliveryTargetKey(channel, recipient);
				if (skipTarget(opts, key) || (opts.deduplicate && await alreadyDelivered(monitor, channel, recipient, statusChangeId))) return;
				await recordAndLog(monitor, channel, recipient, event, statusChangeId, {
					ok: false,
					error: err,
					attempts: 1,
				}, opts, key);
			}, (opts.deferredAlertId || opts.escalationJobId) ? 1 : Math.max(channel.recipientAddresses.length, 1));
		assertDurableResults(results, opts);
		return;
	}

	const { subject, html } = buildEmailContent(monitor, statusChange);

	const results = await settleTargets(channel.recipientAddresses, async (recipient) => {
			const key = deliveryTargetKey(channel, recipient);
			if (skipTarget(opts, key) || (opts.deduplicate && await alreadyDelivered(monitor, channel, recipient, statusChangeId))) return;
			const result = await withRetry(
				async () => {
          await ensureCurrentOperationalDelivery(monitor, statusChange, opts);
          if ((event === "down" || event === "degraded") && await suppressedBeforeSend(monitor, statusChange, opts)) throw new SuppressedDelivery();
					return sendViaProvider(provider, recipient, subject, html);
				},
				{
					delaysMs: opts.delaysMs,
					sleep: opts.sleep,
					onRetry: makeOnRetry(monitor, channel, recipient),
				},
			);
			if (!result.ok && result.error instanceof SuppressedDelivery) { opts.onSuppressed?.(); return; }
			await recordAndLog(
				monitor,
				channel,
				recipient,
				event,
				statusChangeId,
				result,
				opts,
				key,
			);
		}, (opts.deferredAlertId || opts.escalationJobId) ? 1 : Math.max(channel.recipientAddresses.length, 1));
	assertDurableResults(results, opts);
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

	const results = await settleTargets(channels, (channel) =>
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
					), (opts.deferredAlertId || opts.escalationJobId) ? 4 : Math.max(channels.length, 1));
	assertDurableResults(results, opts);
}

export const dispatchNotifications = async (
	monitor: UptimeMonitor,
	statusChange: StatusChangeRecord,
	opts: DispatchOptions = {},
): Promise<void> => {
  const isDown = statusChange.statusAfter === "down";
  const isDegraded = statusChange.statusAfter === "degraded" && Boolean(monitor.latencyPolicy || (monitor.monitorType === "heartbeat" || monitor.monitorType === "server"));
  const isRecovery = statusChange.statusAfter === "up" && (statusChange.statusBefore === "down" || statusChange.statusBefore === "degraded");
  if (!isDown && !isDegraded && !isRecovery) return;
  if (!opts.resumeSuppressed && (isDown || isDegraded || isRecovery) && await deferSuppressedAlert(monitor, statusChange)) return;
  if (monitor.latencyPolicy?.importance === "informational") return;
  const event: NotificationEvent = isDown ? "down" : isDegraded ? "degraded" : "recovery";
  let channels = mergeChannelsForDispatch(await loadApplicableChannels(monitor)).filter(channel =>
    isDown && channel.notifyOnDown || isDegraded && channel.notifyOnDegraded || isRecovery && channel.notifyOnRecovery);
  if (isRecovery) {
    const allowed = await recoveryDeliveryTargets(monitor, statusChange.createdAt);
    const extra = await incidentRecoveryDelivery(monitor, statusChange.createdAt);
    const restrict = (channel: NotificationChannel, targets: string[] | null): NotificationChannel | null => {
      if (!targets) return channel;
      if (channel.channelType === "email") {
        const recipients = (channel.recipientAddresses ?? []).filter(recipient => targets.includes(deliveryTargetKey(channel, recipient)));
        return recipients.length ? { ...channel, recipientAddresses: recipients } : null;
      }
      return channel.webhookUrl && targets.includes(deliveryTargetKey(channel, channel.webhookUrl)) ? channel : null;
    };
    const normal = channels.map(channel => restrict(channel, allowed)).filter((channel): channel is NotificationChannel => !!channel);
    const candidates = extra.channelIds.length ? await db.select().from(uptimeNotificationChannel).where(and(eq(uptimeNotificationChannel.userId, monitor.userId), inArray(uptimeNotificationChannel.channelId, extra.channelIds), eq(uptimeNotificationChannel.notifyOnRecovery, true))).limit(2) : [];
    const supplemental = candidates.map(decryptNotificationChannelSecrets).map(channel => restrict(channel, extra.targets)).filter((channel): channel is NotificationChannel => !!channel);
    // Normal eligible targets have precedence; extras fill only unclaimed destinations.
    channels = mergeChannelsForDispatch([...normal.map(channel => ({ ...channel, uptimeMonitorId: monitor.uptimeMonitorId })), ...supplemental.map(channel => ({ ...channel, uptimeMonitorId: null }))]);
    if (!channels.length) return;
    if (allowed) opts = { ...opts, allowedRecoveryTargets: [...new Set([...allowed, ...extra.targets])] };
  }

	await dispatchToChannels(monitor, statusChange, event, channels, opts);
};

/** Send a reminder only through the explicitly selected owned channel. */
export async function dispatchIncidentEscalation(monitor: UptimeMonitor, statusChange: StatusChangeRecord, channelId: string, opts: DispatchOptions) {
  const event = statusChange.statusAfter === "degraded" ? "degraded" : "down";
  const channels = await db.select().from(uptimeNotificationChannel).where(and(eq(uptimeNotificationChannel.userId, monitor.userId),
    eq(uptimeNotificationChannel.channelId, channelId), eq(event === "down" ? uptimeNotificationChannel.notifyOnDown : uptimeNotificationChannel.notifyOnDegraded, true))).limit(1);
  await dispatchToChannels(monitor, statusChange, event, channels.map(decryptNotificationChannelSecrets), opts);
}

export const dispatchTlsExpiryNotifications = async (
	monitor: UptimeMonitor,
	tlsInfo: TlsCertificateInfo,
	opts: DispatchOptions = {},
): Promise<void> => {
  if (monitor.tlsMonitoringEnabled === false) return;
  const enabled = await db.query.uptimeMonitor.findFirst({ where: and(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId), eq(uptimeMonitor.userId, monitor.userId), eq(uptimeMonitor.tlsMonitoringEnabled, true)), columns: { uptimeMonitorId: true } });
  if (!enabled) return;
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


	// Durable 24h dedup via the delivery log: the scheduler's in-memory probe
	// throttle is wiped by every restart and every monitor edit, which used to
	// re-send an identical TLS alert each time.
	const dedupCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const recentlySent = await db.query.uptimeNotificationLog.findFirst({
		where: and(
			eq(uptimeNotificationLog.uptimeMonitorId, monitor.uptimeMonitorId),
      eq(uptimeNotificationLog.userId, monitor.userId),
			eq(uptimeNotificationLog.event, "tls_expiry"),
			eq(uptimeNotificationLog.outcome, "sent"),
			gt(uptimeNotificationLog.createdAt, dedupCutoff),
		),
	});
	if (recentlySent) {
		return;
	}

	const statusChange: StatusChangeRecord = {
		webhookEvent: "monitor.tls_expiring",
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
  preparedBody?: string,
): Promise<void> => {
	if (!channel.webhookUrl) {
		return;
	}

	const signingSecret = await ensureWebhookSecret(channel);
	const body = preparedBody ?? await buildWebhookBody(channel.channelId, monitor, statusChange);
	const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(channel.webhookHeaders ?? {})) {
    if (!["content-type", "user-agent", "idempotency-key"].includes(key.toLowerCase()) && !key.toLowerCase().startsWith("x-pulsy-")) headers[key] = value;
  }
  Object.assign(headers, webhookHeaders(body, signingSecret));

	const response = await safeFetch(channel.webhookUrl, {
		method: "POST",
		headers,
		body,
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

  const targetError = channelTargetError(channel);
  if (targetError) throw new NotificationSendError(getTranslator("en")(targetError));

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
							...(payload.reason ? [{ type: "mrkdwn", text: `*Reason:*\n${payload.reason}` }] : []),
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
    redirect: "error",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(monitor.monitorType === "server" ? { blocks: [{ type: "section", text: { type: "plain_text", text: serverHealthNotice(monitor, statusChange).text } }] } : slackPayload),
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

  const targetError = channelTargetError(channel);
  if (targetError) throw new NotificationSendError(getTranslator("en")(targetError));

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
					...(payload.reason ? [{ name: "Reason", value: payload.reason, inline: false }] : []),
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
    redirect: "error",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(monitor.monitorType === "server" ? { content: serverHealthNotice(monitor, statusChange).text, allowed_mentions: { parse: [] } } : discordPayload),
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

	const text = monitor.monitorType === "server" ? escapeHtml(serverHealthNotice(monitor, statusChange).text) : [
		`${emoji} <b>${escapeHtml(monitor.name)}</b> is <b>${statusChange.statusAfter.toUpperCase()}</b>`,
		"",
		`<b>URL:</b> ${escapeHtml(monitor.url)}`,
		`<b>Status:</b> ${statusChange.statusBefore} → ${statusChange.statusAfter}`,
    ...(payload.reason ? [`<b>Reason:</b> ${escapeHtml(payload.reason)}`] : []),
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
	if (target.includes("://")) {
		const parsed = new URL(target);
		const urlMatch = parsed.protocol === "https:" && parsed.hostname === "api.telegram.org"
			&& !parsed.port && !parsed.username && !parsed.password
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
