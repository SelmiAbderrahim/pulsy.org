import { assertCountersConsistent, countMonitorStates, meanUptimePercentage } from "@pulsy/db/monitor-counters";
import { monitorPortabilityRouter } from "./monitor-portability";
import { monitorViewsRouter } from "./monitor-views";
import { monitorTemplatesRouter } from "./monitor-templates";
import { statusCommunicationRouter } from "./status-communication";
import { publicSubscriptionReady } from "../../services/uptime/status-subscription";
import { publishedAnnouncements, publicMaintenanceComponents } from "../../services/uptime/status-communication";
import { previewPageSelection, applyPageSelection, previewPageReplacement, replacePageSelection, replacePageSelectionInTransaction } from "../../services/uptime/page-selection";
import { portableHttpUrl } from "@pulsy/db";
import { overallStatus as computeOverallStatus } from "@pulsy/db/status-math";
import { redactIncidentText } from "../../services/uptime/incident-text";
import { assertBelowCap } from "../../lib/account-caps";
import { FieldValidationError } from "../validation-errors";
import { isUniqueViolation } from "../../lib/db-errors";
import { reliabilityRouter } from "./reliability";
import { incidentWorkspaceRouter } from "./incident-workspace";
import { maintenanceRouter } from "./maintenance";
import { effectiveSuppression, effectiveSuppressions, loadMaintenance } from "../../services/uptime/maintenance-service";
import { assertNotificationChannelTarget } from "../../services/uptime/channel-target";
import { insertOwnedChannel } from "../../services/uptime/channel-service";
import { newWebhookSecret } from "../../services/uptime/notification-channel-secrets";
import { encrypt } from "../../lib/crypto";
import { withManualActionLimit } from "../../lib/manual-limit";
import { apiNetworkMonitor } from "@pulsy/db/validation-network";
import { heartbeatRouter } from "./heartbeat";
import { serverHealthRouter } from "./server-health";
import { rearmResumedServer } from "../../services/uptime/server-health-service";
import { rearmResumedHeartbeat } from "../../services/uptime/heartbeat-service";
import { randomUUID } from "node:crypto";
import { createNetworkMonitor, updateNetworkMonitor } from "../../services/uptime/network-monitor";
import { assertMonitorUrlAllowed, isMonitorUrlAllowed, isMonitorHostAllowed } from "../../services/uptime/egress-input";
import { httpConfigPatch, assertCredentialOrigin, toOwnerMonitor } from "../../services/uptime/http-config";
import { updateUptimeMonitor } from "../../services/uptime/monitor-service";
import { createMonitorsForUser } from "../../services/uptime/monitor-operations";
import { performHttpCheck } from "../../services/uptime/checker-service";
import { evaluateLatencyTransition } from "../../services/uptime/latency-policy";
import { updateMonitorsBulk, deleteMonitorsBulk } from "../../services/uptime/bulk-monitor-write";
import { firstCheckAt } from "../../services/uptime/first-check";
import { getOwnedUptimeAggregates, getUptimeBarData, getMonitorStatsForWindow, getMonitorIncidentSummary } from "../../services/uptime/stats-service";
import {
	apiCreateUptimeMonitor,
	apiCreateUptimeMonitorsBulk,
	apiUpdateUptimeMonitor,
	apiUpdateUptimeMonitorsBulk,
	apiCreateUptimeEmailProvider,
	apiUpdateUptimeEmailProvider,
	apiCreateUptimeNotificationChannel,
	apiCreateUptimeDefaultNotificationChannel,
	apiUpdateUptimeNotificationChannel,
	apiWebhookSigningSecret,
	apiCreateUptimeShareLink,
	apiResolveUptimeShareLink,
	apiCloneUptimeShareLink,
	apiRevokeUptimeShareLink,
	apiSearchUptimeIncidents,
	apiSlaReport,
	apiUpsertSlaReportSubscription,
	apiRemoveSlaReportSubscription,
	apiSendSlaReportNow,
	apiCreateUptimeStatusPage,
	apiUpdateUptimeStatusPage,
	apiGetUptimeStatusPage,
	apiDeleteUptimeStatusPage,
	apiSetStatusPageMonitors,
	apiAttachCustomDomain,
	apiStatusPageDomainAction,
	apiResolveStatusPageBySlug,
	apiResolveStatusPageByDomain,
	db,
	uptimeMonitor,
	uptimeMonitorChannelBinding,
	uptimeHeartbeat,
	uptimeStatusChange,
	uptimeCheckLog,
	uptimeIncident,
	uptimeEmailProvider,
	uptimeNotificationChannel,
	uptimeNotificationLog,
	uptimeShareLink,
	uptimeSlaReportSubscription,
	uptimeStatusPage,
	uptimeStatusPageMonitor,
	user,
	type UptimeMonitorRow,
	type UptimeShareLinkRow,
	type UptimeSlaReportSubscriptionRow,
	type UptimeStatusPageRow,
} from "@pulsy/db";
import { randomBytes } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { TRPCError } from "@trpc/server";
import {
	and,
	desc,
	gt,
	eq,
	gte,
	ilike,
	inArray,
	isNull,
	lte,
	count,
	sum,
	getTableColumns,
	ne,
	or,
} from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../trpc";
import {
	scheduleMonitorCheck,
	rescheduleMonitorCheck,
	cancelMonitorCheck,
	createMonitorForUser,
	runManualCheck,
	createEmailProvider,
	updateEmailProvider,
	deleteEmailProvider,
	findEmailProviderById,
	findEmailProvidersByUser,
	testEmailProvider,
	sendViaProvider,
	sendWebhookNotification,
	sendSlackNotification,
	sendDiscordNotification,
	sendTelegramNotification,
	decryptNotificationChannelSecrets,
	encryptNotificationChannelSecrets,
	maskNotificationChannel,
	buildSlaReportModel,
	renderSlaReportPdf,
	accountReportTimezone,
	processSubscription,
} from "../../services/uptime";
import { escapeHtml } from "../../lib/html";
import type { Translator } from "../../lib/i18n";

// ---------------------------------------------------------------------------
// Helpers — all ownership checks are scoped to the authenticated user.
// ---------------------------------------------------------------------------

function notFound(t: Translator, resource: string): TRPCError {
	return new TRPCError({
		code: "NOT_FOUND",
		message: t("errors.notFound", { resource }),
	});
}

function badRequest(t: Translator, key: string, vars?: Record<string, string>) {
	return new TRPCError({
		code: "BAD_REQUEST",
		message: t(key, vars),
	});
}

/**
 * Escape LIKE/ILIKE wildcards so user-typed `%`, `_`, and `\` are matched
 * literally rather than acting as pattern metacharacters (default Postgres
 * ESCAPE is backslash).
 */
function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Load a monitor and assert it belongs to the given user. */
async function findOwnedMonitorOrThrow(
	uptimeMonitorId: string,
	userId: string,
	t: Translator,
) {
	const monitor = await db.query.uptimeMonitor.findFirst({
		where: and(
			eq(uptimeMonitor.uptimeMonitorId, uptimeMonitorId),
			eq(uptimeMonitor.userId, userId),
		),
	});
	// Use NOT_FOUND when the row is missing OR owned by someone else to avoid
	// leaking resource existence.
	if (!monitor) {
		throw notFound(t, "monitor");
	}
	return monitor;
}

async function findOwnedEmailProviderOrThrow(
	emailProviderId: string,
	userId: string,
	t: Translator,
) {
	const provider = await db.query.uptimeEmailProvider.findFirst({
		where: and(
			eq(uptimeEmailProvider.emailProviderId, emailProviderId),
			eq(uptimeEmailProvider.userId, userId),
		),
	});
	if (!provider) {
		throw notFound(t, "email provider");
	}
	return provider;
}

async function findOwnedChannelOrThrow(
	channelId: string,
	userId: string,
	t: Translator,
) {
	const channel = await db.query.uptimeNotificationChannel.findFirst({
		where: and(
			eq(uptimeNotificationChannel.channelId, channelId),
			eq(uptimeNotificationChannel.userId, userId),
		),
	});
	// Use NOT_FOUND when the row is missing OR owned by someone else to avoid
	// leaking resource existence.
	if (!channel) {
		throw notFound(t, "notification channel");
	}
	return channel;
}

/**
 * Generate a URL-safe share token. 24 random bytes = 192 bits of entropy, so
 * the token is resolved by indexed equality on its unique column; a
 * timing-safe compare is unnecessary for high-entropy random lookups (same
 * model as better-auth session tokens).
 */
function generateShareToken(): string {
	return randomBytes(24).toString("base64url");
}

function isShareLinkExpired(link: { expiresAt: string }): boolean {
	// All timestamps are ISO-8601 UTC strings, so lexicographic order is
	// chronological order.
	return link.expiresAt <= new Date().toISOString();
}

/** Load a live (existing, non-expired) share link by token. */
async function findLiveShareLinkOrThrow(token: string, t: Translator) {
	const link = await db.query.uptimeShareLink.findFirst({
		where: eq(uptimeShareLink.token, token),
	});
	// Missing and revoked links are indistinguishable by design.
	if (!link) {
		throw notFound(t, "share link");
	}
	if (isShareLinkExpired(link)) {
		throw badRequest(t, "errors.shareLinkExpired");
	}
	return link;
}

/**
 * Monitors referenced by a share link that still exist AND still belong to
 * the sharer. Monitors deleted after sharing silently drop out.
 */
async function findSharedMonitors(
	link: Pick<UptimeShareLinkRow, "monitorIds" | "userId">,
 t: Translator,
): Promise<UptimeMonitorRow[]> {
	const rows = await db.query.uptimeMonitor.findMany({
		where: and(
			eq(uptimeMonitor.monitorType, "http"),
			inArray(uptimeMonitor.uptimeMonitorId, link.monitorIds),
			eq(uptimeMonitor.userId, link.userId),
		),
	});
 return rows.filter(row => isSafeToShare(row, t));
}

/**
 * The only monitor fields a share link ever exposes or clones. Never current
 * status, history, TLS data, status-page settings, or anything owner-scoped.
 */
function isSafeToShare(m: UptimeMonitorRow, t: Translator) {
  const url = portableHttpUrl(m.url);
  return url !== null && redactIncidentText(m, url, t) === url;
}
function toSharedMonitorConfig(m: UptimeMonitorRow, t: Translator) {
	return {
		uptimeMonitorId: m.uptimeMonitorId,
		name: redactIncidentText(m, m.name, t),
		url: m.url,
		method: m.method,
		expectedStatus: m.expectedStatus,
    expectedStatuses: m.expectedStatuses, tlsMonitoringEnabled: m.tlsMonitoringEnabled,
		timeout: m.timeout,
		interval: m.interval,
		failureThreshold: m.failureThreshold,
		tags: (m.tags ?? []).map(tag => redactIncidentText(m, tag, t)),
	};
}

function isValidHttpUrl(value: string): boolean {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

function isValidTelegramTarget(value: string): boolean {
	if (value.startsWith("https://api.telegram.org/bot")) {
		return isValidHttpUrl(value);
	}

	const parts = value.split(":");
	return parts.length >= 3 && parts.every((part) => part.length > 0);
}

function assertNotificationChannelConfig(
	channel: {
		channelType: string;
		emailProviderId?: string | null;
		recipientAddresses?: string[] | null;
		webhookUrl?: string | null;
	},
	t: Translator,
): void {
	switch (channel.channelType) {
		case "email":
			if (!channel.emailProviderId) {
				throw badRequest(t, "errors.invalidInput", {
					details: "Email provider is required",
				});
			}
			if (!channel.recipientAddresses?.length) {
				throw badRequest(t, "errors.invalidInput", {
					details: "At least one recipient is required",
				});
			}
			return;
		case "webhook":
		case "slack":
		case "discord":
			if (!channel.webhookUrl || !isValidHttpUrl(channel.webhookUrl)) {
				throw badRequest(t, "errors.invalidInput", {
					details: "Webhook URL is required",
				});
			}
			return;
		case "telegram":
			if (!channel.webhookUrl || !isValidTelegramTarget(channel.webhookUrl)) {
				throw badRequest(t, "errors.invalidInput", {
					details: "Telegram target is required",
				});
			}
			return;
		/* v8 ignore next 4 -- unreachable: channelType is a constrained enum (5 values), all handled above */
		default:
			throw badRequest(t, "errors.invalidInput", {
				details: "Unsupported channel type",
			});
	}
}

// ---------------------------------------------------------------------------
// monitor.*
// ---------------------------------------------------------------------------

const localizedHttpProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof z.ZodError) {
    const issue = result.error.cause.issues.find(value => value.message.startsWith("errors.http") || value.message.startsWith("errors.latency"));
    throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t(issue?.message ?? "errors.badRequest"), cause: result.error.cause });
  }
  return result;
});


const manualActionProcedure = protectedProcedure.use(({ ctx, next }) => withManualActionLimit(ctx.user.id, ctx.t, () => next()));

const activeHttpTests = new Set<string>();
const monitorRouter = router({
  testConfiguration: localizedHttpProcedure.input(z.object({
    uptimeMonitorId: z.string().max(64).optional(), configuration: apiCreateUptimeMonitor,
    allowPost: z.boolean().default(false),
  }).strict()).mutation(async ({ input, ctx }) => {
    const stored = input.uptimeMonitorId ? await findOwnedMonitorOrThrow(input.uptimeMonitorId, ctx.user.id, ctx.t) : null;
    if (stored && stored.monitorType !== "http") throw badRequest(ctx.t, "errors.monitorTypeAction");
    if (input.configuration.method === "POST" && !input.allowPost) throw badRequest(ctx.t, "errors.httpPostConfirm");
    if (activeHttpTests.has(ctx.user.id) || activeHttpTests.size >= 8) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: ctx.t("errors.httpTestBusy") });
    activeHttpTests.add(ctx.user.id);
    try {
    if (stored) assertCredentialOrigin(stored.requestCipher, stored.url, input.configuration.url, input.configuration.requestConfig, ctx.t);
    // Same policy as saving: a test run must not become a one-off SSRF probe.
    await assertMonitorUrlAllowed(input.configuration.url, ctx.t, "configuration.url");
    const { requestConfig: _requestConfig, ...ordinary } = input.configuration;
    const configuration = httpConfigPatch(input.configuration, ordinary.method, ctx.t, stored?.requestCipher);
    const candidate: UptimeMonitorRow = {
      monitorType: "http", externalKey: null, networkConfig: null, uptimeMonitorId: "test", userId: ctx.user.id, status: "pending", createdAt: new Date().toISOString(),
      consecutiveSlow: 0, consecutiveHealthy: 0, lastOperationalAlertAt: null, lastOperationalAlertId: null,
      notificationOutageId: null, requestCipher: stored?.requestCipher ?? null, redirectPolicy: "follow", httpAssertions: [],
      httpStatus: null, responseTime: null, lastCheckedAt: null, nextCheckAt: null, tlsExpiresAt: null, tlsExpiresInDays: null, expectedStatuses: null, tlsMonitoringEnabled: true,
      consecutiveFailures: 0, uptimePercentage: null, isPublic: false, statusPageTitle: null, statusPageDescription: null,
      ...ordinary, ...configuration,
      latencyPolicy: ordinary.latencyPolicy === undefined ? stored?.latencyPolicy ?? null : ordinary.latencyPolicy,
    };
      const result = await performHttpCheck(candidate);
      if (!candidate.latencyPolicy) return result;
      const sample = evaluateLatencyTransition({ previousStatus: "pending", checkStatus: result.status, responseTime: result.responseTime, consecutiveFailures: 0, failureThreshold: candidate.failureThreshold, consecutiveSlow: 0, consecutiveHealthy: 0, policy: candidate.latencyPolicy });
      return { ...result, status: sample.sampleStatus, latencySample: true };
    }
    finally { activeHttpTests.delete(ctx.user.id); }
  }),
	list: protectedProcedure.input(z.object({ cursor: z.string().min(1).max(64).optional() }).strict().optional()).query(async ({ ctx, input }) => {
		const monitors = await db.query.uptimeMonitor.findMany({
			where: and(eq(uptimeMonitor.userId, ctx.user.id), input?.cursor ? gt(uptimeMonitor.uptimeMonitorId, input.cursor) : undefined),
			orderBy: uptimeMonitor.uptimeMonitorId,
      limit: 200,
		});
    const monitorIds = monitors.map(m => m.uptimeMonitorId);
    const [directChannels, bindings, pageLinks] = monitorIds.length ? await Promise.all([
      db.select({ monitorId: uptimeNotificationChannel.uptimeMonitorId, channelId: uptimeNotificationChannel.channelId }).from(uptimeNotificationChannel)
        .where(and(eq(uptimeNotificationChannel.userId, ctx.user.id), inArray(uptimeNotificationChannel.uptimeMonitorId, monitorIds))),
      db.select({ monitorId: uptimeMonitorChannelBinding.monitorId, channelId: uptimeMonitorChannelBinding.channelId }).from(uptimeMonitorChannelBinding)
        .innerJoin(uptimeNotificationChannel, eq(uptimeNotificationChannel.channelId, uptimeMonitorChannelBinding.channelId))
        .where(and(eq(uptimeMonitorChannelBinding.userId, ctx.user.id), eq(uptimeNotificationChannel.userId, ctx.user.id), inArray(uptimeMonitorChannelBinding.monitorId, monitorIds))),
      db.select({ monitorId: uptimeStatusPageMonitor.uptimeMonitorId, statusPageId: uptimeStatusPageMonitor.statusPageId }).from(uptimeStatusPageMonitor)
        .innerJoin(uptimeStatusPage, eq(uptimeStatusPage.statusPageId, uptimeStatusPageMonitor.statusPageId))
        .where(and(eq(uptimeStatusPage.userId, ctx.user.id), inArray(uptimeStatusPageMonitor.uptimeMonitorId, monitorIds))),
    ]) : [[], [], []];
    const overrideChannels = new Map<string, Set<string>>(), statusPages = new Map<string, Set<string>>();
    for (const channel of [...directChannels, ...bindings]) if (channel.monitorId) {
      const ids = overrideChannels.get(channel.monitorId) ?? new Set<string>(); ids.add(channel.channelId); overrideChannels.set(channel.monitorId, ids);
    }
    for (const link of pageLinks) {
      const ids = statusPages.get(link.monitorId) ?? new Set<string>(); ids.add(link.statusPageId); statusPages.set(link.monitorId, ids);
    }
		const aggregates = await getOwnedUptimeAggregates(ctx.user.id, 30, monitors.map(m => m.uptimeMonitorId));
    const heartbeatIds = monitors.filter(m => m.monitorType === "heartbeat").map(m => m.uptimeMonitorId);
    const heartbeats = heartbeatIds.length ? await db.select({ monitorId: uptimeHeartbeat.monitorId, lastReceivedAt: uptimeHeartbeat.lastReceivedAt, expectedAt: uptimeHeartbeat.expectedAt, graceSeconds: uptimeHeartbeat.graceSeconds })
      .from(uptimeHeartbeat).where(and(eq(uptimeHeartbeat.userId, ctx.user.id), inArray(uptimeHeartbeat.monitorId, heartbeatIds))) : [];
    const heartbeatStates = new Map(heartbeats.map(h => [h.monitorId, { lastReceivedAt: h.lastReceivedAt, expectedAt: h.expectedAt, deadlineAt: new Date(Date.parse(h.expectedAt) + h.graceSeconds * 1000).toISOString() }]));
    const suppressions = effectiveSuppressions(await loadMaintenance(ctx.user.id));
    return monitors.map(m => ({ ...toOwnerMonitor(m), overrideChannelCount: overrideChannels.get(m.uptimeMonitorId)?.size ?? 0, statusPageCount: statusPages.get(m.uptimeMonitorId)?.size ?? 0, alertSuppression: suppressions.get(m.uptimeMonitorId) ?? null, heartbeat: heartbeatStates.get(m.uptimeMonitorId) ?? null, ...(aggregates.get(m.uptimeMonitorId) ?? { uptimePercentage: null, uptimeChecks: 0 }) }));
	}),

	one: protectedProcedure
		.input(z.object({ uptimeMonitorId: z.string() }))
		.query(async ({ input, ctx }) => {
			const owned = await findOwnedMonitorOrThrow(
				input.uptimeMonitorId,
				ctx.user.id,
				ctx.t,
			);
			const monitor = await db.query.uptimeMonitor.findFirst({
				where: and(
					eq(uptimeMonitor.uptimeMonitorId, owned.uptimeMonitorId),
					eq(uptimeMonitor.userId, ctx.user.id),
				),
				with: {
					notificationChannels: {
						where: eq(uptimeNotificationChannel.userId, ctx.user.id),
					},
					incidents: {
						orderBy: desc(uptimeIncident.startedAt),
						limit: 10,
					},
				},
			});
			/* v8 ignore next 3 -- unreachable: ownership already verified above, so the row exists */
			if (!monitor) {
				throw notFound(ctx.t, "monitor");
			}
      const referencedChannels = await db.select({ id: uptimeNotificationChannel.channelId, type: uptimeNotificationChannel.channelType }).from(uptimeMonitorChannelBinding)
        .innerJoin(uptimeNotificationChannel, eq(uptimeMonitorChannelBinding.channelId, uptimeNotificationChannel.channelId))
        .where(and(eq(uptimeMonitorChannelBinding.userId, ctx.user.id), eq(uptimeMonitorChannelBinding.monitorId, monitor.uptimeMonitorId), eq(uptimeNotificationChannel.userId, ctx.user.id)));

			return {
				...toOwnerMonitor(monitor),
        referencedChannels,
        alertSuppression: effectiveSuppression(await loadMaintenance(ctx.user.id), monitor.uptimeMonitorId),
        incidents: monitor.incidents,
				notificationChannels: monitor.notificationChannels.map(
					maskNotificationChannel,
				),
			};
		}),

  create: localizedHttpProcedure.input(apiCreateUptimeMonitor).mutation(async ({ input, ctx }) => {
    const monitor = await createMonitorForUser(input, ctx.user.id, ctx.t);
    if (monitor.active) scheduleMonitorCheck(monitor, { checkIfDue: true });
    return toOwnerMonitor(monitor);
  }),
  createBulk: localizedHttpProcedure.input(apiCreateUptimeMonitorsBulk).mutation(async ({ input, ctx }) => {
    const monitors = await createMonitorsForUser(input.monitors, ctx.user.id, ctx.t, "urls");
    for (const monitor of monitors) if (monitor.active) scheduleMonitorCheck(monitor, { checkIfDue: true });
    return monitors.map(toOwnerMonitor);
  }),
  update: localizedHttpProcedure.input(apiUpdateUptimeMonitor).mutation(async ({ input, ctx }) => {
    const updated = await updateUptimeMonitor(input, ctx.user.id, ctx.t);
    if (updated.active) rescheduleMonitorCheck(updated); else cancelMonitorCheck(updated.uptimeMonitorId);
    return toOwnerMonitor(updated);
  }),
  updateBulk: protectedProcedure.input(apiUpdateUptimeMonitorsBulk).mutation(async ({ input, ctx }) => {
    const requestId = randomUUID();
    const result = await updateMonitorsBulk(input, ctx.user.id, ctx.t, requestId);
    for (const monitor of result.updated) {
      try { if (monitor.active) rescheduleMonitorCheck(monitor); else cancelMonitorCheck(monitor.uptimeMonitorId); }
      catch { console.error(JSON.stringify({event:"monitor.updateBulk.scheduler.failed", requestId, monitorId:monitor.uptimeMonitorId})); }
    }
    return { updated: result.updated.map(toOwnerMonitor), results: result.results };
  }),
  deleteBulk: protectedProcedure.input(z.object({ ids: z.array(z.string()).min(1).max(200), count: z.number().int().min(1).max(200) }).strict().refine(input => new Set(input.ids).size === input.count && input.ids.length === input.count))
    .mutation(async ({ input, ctx }) => {
      const deleted = await deleteMonitorsBulk(input.ids, ctx.user.id, ctx.t);
      const ids = new Set(deleted.map(row => row.id));
      for (const id of ids) cancelMonitorCheck(id);
      return input.ids.map(id => ids.has(id) ? { id, status: "deleted" as const } : { id, status: "rejected" as const, reason: ctx.t("errors.notFound", { resource: "monitor" }) });
    }),

  delete: protectedProcedure.input(z.object({ uptimeMonitorId: z.string() })).mutation(async ({ input, ctx }) => {
    await findOwnedMonitorOrThrow(input.uptimeMonitorId, ctx.user.id, ctx.t);
    await deleteMonitorsBulk([input.uptimeMonitorId], ctx.user.id, ctx.t);
    cancelMonitorCheck(input.uptimeMonitorId);
    return { success: true };
  }),

  toggleActive: protectedProcedure.input(z.object({ uptimeMonitorId: z.string() })).mutation(async ({ input, ctx }) => {
    const updated = await db.transaction(async tx => {
      const scope = and(eq(uptimeMonitor.uptimeMonitorId, input.uptimeMonitorId), eq(uptimeMonitor.userId, ctx.user.id));
      const [monitor] = await tx.select().from(uptimeMonitor).where(scope).for("update");
      if (!monitor) throw notFound(ctx.t, "monitor");
      const [row] = await tx.update(uptimeMonitor).set({ active: !monitor.active, nextCheckAt: !monitor.active && !["heartbeat", "server"].includes(monitor.monitorType) ? firstCheckAt() : null }).where(scope).returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: ctx.t("errors.internal") });
      const heartbeatDeadline = await rearmResumedHeartbeat(tx, monitor, row);
      if (heartbeatDeadline !== undefined) row.nextCheckAt = heartbeatDeadline;
      const serverDeadline = await rearmResumedServer(tx, monitor, row);
      if (serverDeadline !== undefined) row.nextCheckAt = serverDeadline;
      return row;
    });
    if (updated.active) scheduleMonitorCheck(updated, { checkIfDue: true }); else cancelMonitorCheck(updated.uptimeMonitorId);
    return toOwnerMonitor(updated);
  }),

	checkNow: protectedProcedure
		.input(z.object({ uptimeMonitorId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const monitor = await findOwnedMonitorOrThrow(
				input.uptimeMonitorId,
				ctx.user.id,
				ctx.t,
			);

			if (!monitor.active) {
				throw badRequest(ctx.t, "errors.cannotCheckInactive");
			}

			// The full check pipeline (probe → log → state → incident → notify)
			// is shared with `POST /api/v1/monitors/:id/check-now`.
			return toOwnerMonitor(await runManualCheck(monitor, ctx.t));
		}),
});

const networkRouter = router({
  create: protectedProcedure.input(apiNetworkMonitor).mutation(async ({ input, ctx }) => {
    const monitor = await createNetworkMonitor(input, ctx.user.id, ctx.t);
    if (monitor.active) scheduleMonitorCheck(monitor, { checkIfDue: true });
    return toOwnerMonitor(monitor);
  }),
  update: protectedProcedure.input(apiNetworkMonitor.extend({ monitorId: z.string() })).mutation(async ({ input, ctx }) => {
    const monitor = await updateNetworkMonitor(input, ctx.user.id, ctx.t);
    if (monitor.active) rescheduleMonitorCheck(monitor); else cancelMonitorCheck(monitor.uptimeMonitorId);
    return toOwnerMonitor(monitor);
  }),
});
const egressRouter = router({
  url: protectedProcedure.input(z.object({ url: z.string().max(2048) }).strict()).query(async ({ input }) => ({ allowed: await isMonitorUrlAllowed(input.url) })),
  host: protectedProcedure.input(z.object({ hostname: z.string().max(253), type: z.enum(["dns", "tcp"]) }).strict()).query(async ({ input }) => ({ allowed: await isMonitorHostAllowed(input.hostname, input.type) })),
});

// ---------------------------------------------------------------------------
// statusChange.*
// ---------------------------------------------------------------------------

const statusChangeRouter = router({
	list: protectedProcedure
		.input(
			z.object({
				uptimeMonitorId: z.string(),
				limit: z.number().int().min(1).max(200).default(50),
			}),
		)
		.query(async ({ input, ctx }) => {
			await findOwnedMonitorOrThrow(input.uptimeMonitorId, ctx.user.id, ctx.t);

			const changes = await db
				.select({ ...getTableColumns(uptimeStatusChange) })
				.from(uptimeStatusChange)
				.innerJoin(
					uptimeMonitor,
					and(
						eq(
							uptimeStatusChange.uptimeMonitorId,
							uptimeMonitor.uptimeMonitorId,
						),
						eq(uptimeMonitor.userId, ctx.user.id),
					),
				)
				.where(eq(uptimeStatusChange.uptimeMonitorId, input.uptimeMonitorId))
				.orderBy(desc(uptimeStatusChange.createdAt))
				.limit(input.limit);

			return changes;
		}),
});

// ---------------------------------------------------------------------------
// notificationLog.* — delivery audit history (sent/failed per channel target)
// ---------------------------------------------------------------------------

const notificationLogRouter = router({
	list: protectedProcedure
		.input(
			z.object({
				// Omit to list every notification the user has received (global
				// history); set to scope to one monitor's delivery history.
				uptimeMonitorId: z.string().optional(),
				limit: z.number().int().min(1).max(200).default(50),
				offset: z.number().int().min(0).default(0),
			}),
		)
		.query(async ({ input, ctx }) => {
			if (input.uptimeMonitorId) {
				await findOwnedMonitorOrThrow(
					input.uptimeMonitorId,
					ctx.user.id,
					ctx.t,
				);
			}

			// Always scope by the owning user; optionally narrow to one monitor.
			const conditions = [eq(uptimeNotificationLog.userId, ctx.user.id)];
			if (input.uptimeMonitorId) {
				conditions.push(
					eq(uptimeNotificationLog.uptimeMonitorId, input.uptimeMonitorId),
				);
			}

			const logs = await db
				.select()
				.from(uptimeNotificationLog)
				.where(and(...conditions))
				.orderBy(desc(uptimeNotificationLog.createdAt))
				.limit(input.limit)
				.offset(input.offset);

			const [totalResult] = await db
				.select({ value: count() })
				.from(uptimeNotificationLog)
				.where(and(...conditions));

			return {
				data: logs,
				/* v8 ignore next -- defensive: COUNT(*) always returns exactly one row */
				total: totalResult?.value ?? 0,
			};
		}),
});

// ---------------------------------------------------------------------------
// checkLog.*
// ---------------------------------------------------------------------------

const checkLogRouter = router({
  daily: protectedProcedure.input(z.object({ uptimeMonitorId: z.string(), days: z.number().int().min(1).max(90).default(90) })).query(async ({ input, ctx }) => {
    await findOwnedMonitorOrThrow(input.uptimeMonitorId, ctx.user.id, ctx.t);
    return getUptimeBarData(input.uptimeMonitorId, ctx.user.id, input.days);
  }),
	list: protectedProcedure
		.input(
			z.object({
				uptimeMonitorId: z.string(),
				startDate: z.string().optional(),
				endDate: z.string().optional(),
				limit: z.number().int().min(1).max(1000).default(100),
				offset: z.number().int().min(0).default(0),
			}),
		)
		.query(async ({ input, ctx }) => {
			await findOwnedMonitorOrThrow(input.uptimeMonitorId, ctx.user.id, ctx.t);

			const conditions = [
				eq(uptimeCheckLog.uptimeMonitorId, input.uptimeMonitorId),
			];

			if (input.startDate) {
				conditions.push(gte(uptimeCheckLog.createdAt, input.startDate));
			}
			if (input.endDate) {
				conditions.push(lte(uptimeCheckLog.createdAt, input.endDate));
			}

			const logs = await db
				.select({ ...getTableColumns(uptimeCheckLog) })
				.from(uptimeCheckLog)
				.innerJoin(
					uptimeMonitor,
					and(
						eq(
							uptimeCheckLog.uptimeMonitorId,
							uptimeMonitor.uptimeMonitorId,
						),
						eq(uptimeMonitor.userId, ctx.user.id),
					),
				)
				.where(and(...conditions))
				.orderBy(desc(uptimeCheckLog.createdAt))
				.limit(input.limit)
				.offset(input.offset);

			const [totalResult] = await db
				.select({ value: count() })
				.from(uptimeCheckLog)
				.innerJoin(
					uptimeMonitor,
					and(
						eq(
							uptimeCheckLog.uptimeMonitorId,
							uptimeMonitor.uptimeMonitorId,
						),
						eq(uptimeMonitor.userId, ctx.user.id),
					),
				)
				.where(and(...conditions));

			return {
				data: logs,
				/* v8 ignore next -- defensive: COUNT(*) always returns exactly one row */
				total: totalResult?.value ?? 0,
			};
		}),

  stats: protectedProcedure.input(z.object({ uptimeMonitorId: z.string(), days: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ input, ctx }) => {
      await findOwnedMonitorOrThrow(input.uptimeMonitorId, ctx.user.id, ctx.t);
      const until = new Date().toISOString();
      const since = new Date(Date.parse(until) - input.days * 86_400_000).toISOString();
      const [stats, incidents] = await Promise.all([
        getMonitorStatsForWindow(input.uptimeMonitorId, ctx.user.id, since, until),
        getMonitorIncidentSummary(input.uptimeMonitorId, ctx.user.id, since, until),
      ]);
      return { ...stats, upChecks: stats.successfulChecks, downChecks: stats.failedChecks,
        uptimePercentage: stats.uptimePercentage,
        avgResponseTime: stats.avgResponseTime, minResponseTime: stats.minResponseTime, maxResponseTime: stats.maxResponseTime,
        incidentCount: incidents.count, days: input.days };
    }),
});

// ---------------------------------------------------------------------------
// incident.*
// ---------------------------------------------------------------------------

const incidentRouter = router({
	list: protectedProcedure
		.input(
			z.object({
				uptimeMonitorId: z.string(),
				limit: z.number().int().min(1).max(200).default(50),
			}),
		)
		.query(async ({ input, ctx }) => {
			await findOwnedMonitorOrThrow(input.uptimeMonitorId, ctx.user.id, ctx.t);

			const incidents = await db
				.select({ ...getTableColumns(uptimeIncident) })
				.from(uptimeIncident)
				.innerJoin(
					uptimeMonitor,
					and(
						eq(
							uptimeIncident.uptimeMonitorId,
							uptimeMonitor.uptimeMonitorId,
						),
						eq(uptimeMonitor.userId, ctx.user.id),
					),
				)
				.where(eq(uptimeIncident.uptimeMonitorId, input.uptimeMonitorId))
				.orderBy(desc(uptimeIncident.startedAt))
				.limit(input.limit);

			return incidents;
		}),

	one: protectedProcedure
		.input(z.object({ incidentId: z.string() }))
		.query(async ({ input, ctx }) => {
			const [incident] = await db
				.select({ ...getTableColumns(uptimeIncident) })
				.from(uptimeIncident)
				.innerJoin(
					uptimeMonitor,
					and(
						eq(
							uptimeIncident.uptimeMonitorId,
							uptimeMonitor.uptimeMonitorId,
						),
						eq(uptimeMonitor.userId, ctx.user.id),
					),
				)
				.where(eq(uptimeIncident.incidentId, input.incidentId))
				.limit(1);
			if (!incident) {
				throw notFound(ctx.t, "incident");
			}

			return incident;
		}),

	/**
	 * Cross-monitor incident search for the dashboard command palette.
	 * Scoped to the caller's monitors via the join + userId filter; matches
	 * the query against the monitor name, the monitor url, or the incident
	 * cause. Returns only display-safe, owned fields.
	 */
	search: protectedProcedure
		.input(apiSearchUptimeIncidents)
		.query(async ({ input, ctx }) => {
			const pattern = `%${escapeLike(input.query)}%`;

			return db
				.select({
					incidentId: uptimeIncident.incidentId,
					uptimeMonitorId: uptimeIncident.uptimeMonitorId,
					monitorName: uptimeMonitor.name,
					status: uptimeIncident.status,
					startedAt: uptimeIncident.startedAt,
					resolvedAt: uptimeIncident.resolvedAt,
					durationSeconds: uptimeIncident.durationSeconds,
					cause: uptimeIncident.cause,
				})
				.from(uptimeIncident)
				.innerJoin(
					uptimeMonitor,
					eq(
						uptimeIncident.uptimeMonitorId,
						uptimeMonitor.uptimeMonitorId,
					),
				)
				.where(
					and(
						eq(uptimeMonitor.userId, ctx.user.id),
						or(
							ilike(uptimeMonitor.name, pattern),
							ilike(uptimeMonitor.url, pattern),
							ilike(uptimeIncident.cause, pattern),
						),
					),
				)
				.orderBy(desc(uptimeIncident.startedAt))
				.limit(input.limit);
		}),
});

// ---------------------------------------------------------------------------
// emailProvider.*
// ---------------------------------------------------------------------------

const emailProviderRouter = router({
	list: protectedProcedure.query(async ({ ctx }) => {
		return findEmailProvidersByUser(ctx.user.id);
	}),

	create: protectedProcedure
		.input(apiCreateUptimeEmailProvider)
		.mutation(async ({ input, ctx }) => {
			const provider = await createEmailProvider(input, ctx.user.id, ctx.t);
			return findEmailProviderById(
				provider.emailProviderId,
				ctx.user.id,
			);
		}),

	update: protectedProcedure
		.input(apiUpdateUptimeEmailProvider)
		.mutation(async ({ input, ctx }) => {
			const provider = await updateEmailProvider(
				input,
				ctx.user.id,
				ctx.t,
			);
			return findEmailProviderById(
				provider.emailProviderId,
				ctx.user.id,
			);
		}),

	delete: protectedProcedure
		.input(z.object({ emailProviderId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			await deleteEmailProvider(
				input.emailProviderId,
				ctx.user.id,
			);

			return { success: true };
		}),

	test: manualActionProcedure
		.input(
			z.object({
				emailProviderId: z.string(),
				testEmail: z.string().email().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const result = await testEmailProvider(
				input.emailProviderId,
				ctx.user.id,
				input.testEmail ?? ctx.user.email,
			);
			if (!result.success) {
				throw badRequest(ctx.t, "errors.testEmailFailed", {
					/* v8 ignore next -- defensive: a failed test result always carries an error message */
					details: result.error ?? "Unknown error",
				});
			}
			return { success: true, message: "Test email sent" };
		}),
});

// ---------------------------------------------------------------------------
// channel.*
// ---------------------------------------------------------------------------

const channelRouter = router({
	list: protectedProcedure
		.input(z.object({ uptimeMonitorId: z.string() }))
		.query(async ({ input, ctx }) => {
			await findOwnedMonitorOrThrow(input.uptimeMonitorId, ctx.user.id, ctx.t);

			const channels = await db
				.select()
				.from(uptimeNotificationChannel)
				.where(
					and(
						eq(
						uptimeNotificationChannel.uptimeMonitorId,
						input.uptimeMonitorId,
					),
						eq(uptimeNotificationChannel.userId, ctx.user.id),
					),
				)
				.orderBy(desc(uptimeNotificationChannel.createdAt));

			return channels.map(maskNotificationChannel);
		}),

	/** Account-level default channels — apply to all the user's monitors. */
	listDefaults: protectedProcedure.query(async ({ ctx }) => {
		const channels = await db
			.select()
			.from(uptimeNotificationChannel)
			.where(
				and(
					eq(uptimeNotificationChannel.userId, ctx.user.id),
					isNull(uptimeNotificationChannel.uptimeMonitorId),
				),
			)
			.orderBy(desc(uptimeNotificationChannel.createdAt));

		return channels.map(maskNotificationChannel);
	}),

	health: protectedProcedure.query(async ({ ctx }) => {
		const channels = await db
			.select({
				channelId: uptimeNotificationChannel.channelId,
				channelType: uptimeNotificationChannel.channelType,
				uptimeMonitorId: uptimeNotificationChannel.uptimeMonitorId,
			})
			.from(uptimeNotificationChannel)
			.where(eq(uptimeNotificationChannel.userId, ctx.user.id));

		if (channels.length === 0) {
			return [];
		}

		// One bounded scan, newest first, grouped in memory. The window only has
		// to be deep enough to find the last success per channel; a channel that
		// has not succeeded within it is already unambiguously broken.
		const logs = await db
			.select({
				channelId: uptimeNotificationLog.channelId,
				target: uptimeNotificationLog.target,
				outcome: uptimeNotificationLog.outcome,
				error: uptimeNotificationLog.error,
				createdAt: uptimeNotificationLog.createdAt,
			})
			.from(uptimeNotificationLog)
			.where(eq(uptimeNotificationLog.userId, ctx.user.id))
			.orderBy(desc(uptimeNotificationLog.createdAt))
			.limit(500);

		return channels.map((channel) => {
			const own = logs.filter((log) => log.channelId === channel.channelId);
			// `own` is newest-first: the streak ends at the first success.
			const firstSuccess = own.findIndex((log) => log.outcome === "sent");
			const consecutiveFailures =
				firstSuccess === -1 ? own.length : firstSuccess;

			return {
				channelId: channel.channelId,
				channelType: channel.channelType,
				uptimeMonitorId: channel.uptimeMonitorId,
				target: own[0]?.target ?? null,
				consecutiveFailures,
				lastError: own[0]?.outcome === "failed" ? (own[0].error ?? null) : null,
				lastAttemptAt: own[0]?.createdAt ?? null,
				lastSuccessAt:
					firstSuccess === -1 ? null : (own[firstSuccess]?.createdAt ?? null),
			};
		});
	}),

	createDefault: protectedProcedure
		.input(apiCreateUptimeDefaultNotificationChannel)
		.mutation(async ({ input, ctx }) => {
			assertNotificationChannelConfig(input, ctx.t);
			await assertNotificationChannelTarget(input, ctx.t);
			const signingSecret = input.channelType === "webhook" ? input.signingSecret ?? newWebhookSecret() : undefined;
			const storedSecrets = encryptNotificationChannelSecrets(
				input.channelType === "email" ? null : input.webhookUrl,
				input.channelType === "email" ? null : input.webhookHeaders,
			);

			// Validate email provider belongs to the same user if specified
			if (input.emailProviderId) {
				await findOwnedEmailProviderOrThrow(
					input.emailProviderId,
					ctx.user.id,
					ctx.t,
				);
			}

			const inserted = await insertOwnedChannel({
					uptimeMonitorId: null,
					userId: ctx.user.id,
					channelType: input.channelType,
					emailProviderId: input.emailProviderId ?? null,
					recipientAddresses: input.recipientAddresses ?? null,
					...storedSecrets,
					signingSecretCipher: signingSecret ? encrypt(signingSecret) : null,
					notifyOnDown: input.notifyOnDown,
          notifyOnDegraded: input.notifyOnDegraded,
					notifyOnRecovery: input.notifyOnRecovery,
					notifyOnTlsExpiry: input.notifyOnTlsExpiry,
					tlsExpiryThresholdDays: input.tlsExpiryThresholdDays,
				}, ctx.t);

			/* v8 ignore next 6 -- unreachable: INSERT ... RETURNING yields the row or throws */
			if (!inserted) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: ctx.t("errors.internal"),
				});
			}

			return maskNotificationChannel(inserted);
		}),

	create: protectedProcedure
		.input(apiCreateUptimeNotificationChannel)
		.mutation(async ({ input, ctx }) => {
			await findOwnedMonitorOrThrow(input.uptimeMonitorId, ctx.user.id, ctx.t);
			assertNotificationChannelConfig(input, ctx.t);
			await assertNotificationChannelTarget(input, ctx.t);
			const signingSecret = input.channelType === "webhook" ? input.signingSecret ?? newWebhookSecret() : undefined;
			const storedSecrets = encryptNotificationChannelSecrets(
				input.channelType === "email" ? null : input.webhookUrl,
				input.channelType === "email" ? null : input.webhookHeaders,
			);

			// Validate email provider belongs to the same user if specified
			if (input.emailProviderId) {
				await findOwnedEmailProviderOrThrow(
					input.emailProviderId,
					ctx.user.id,
					ctx.t,
				);
			}

			const inserted = await insertOwnedChannel({
					uptimeMonitorId: input.uptimeMonitorId,
					userId: ctx.user.id,
					channelType: input.channelType,
					emailProviderId: input.emailProviderId ?? null,
					recipientAddresses: input.recipientAddresses ?? null,
					...storedSecrets,
					signingSecretCipher: signingSecret ? encrypt(signingSecret) : null,
					notifyOnDown: input.notifyOnDown,
          notifyOnDegraded: input.notifyOnDegraded,
					notifyOnRecovery: input.notifyOnRecovery,
					notifyOnTlsExpiry: input.notifyOnTlsExpiry,
					tlsExpiryThresholdDays: input.tlsExpiryThresholdDays,
				}, ctx.t);

			/* v8 ignore next 6 -- unreachable: INSERT ... RETURNING yields the row or throws */
			if (!inserted) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: ctx.t("errors.internal"),
				});
			}

			return maskNotificationChannel(inserted);
		}),

	update: protectedProcedure
		.input(apiUpdateUptimeNotificationChannel)
		.mutation(async ({ input, ctx }) => db.transaction(async tx => {
			const scope = and(eq(uptimeNotificationChannel.channelId, input.channelId), eq(uptimeNotificationChannel.userId, ctx.user.id));
      const [channel] = await tx.select().from(uptimeNotificationChannel).where(scope).for("update");
      if (!channel) throw notFound(ctx.t, "notification channel");
			const decryptedChannel = decryptNotificationChannelSecrets(channel);
			const { channelId, ...updates } = input;
			const nextChannel = {
				...decryptedChannel,
				...updates,
			};
			if (nextChannel.channelType === "email") {
				nextChannel.webhookUrl = null;
				nextChannel.webhookHeaders = null;
			}
			assertNotificationChannelConfig(nextChannel, ctx.t);
			await assertNotificationChannelTarget(nextChannel, ctx.t);

			// Validate email provider if changing
			if (nextChannel.emailProviderId) {
				await findOwnedEmailProviderOrThrow(
					nextChannel.emailProviderId,
					ctx.user.id,
					ctx.t,
				);
			}

			const [updated] = await tx
				.update(uptimeNotificationChannel)
				.set({
					...updates,
          signingSecretCipher: nextChannel.channelType === "webhook" ? channel.signingSecretCipher ?? encrypt(newWebhookSecret()) : null,
					...encryptNotificationChannelSecrets(
						nextChannel.webhookUrl,
						nextChannel.webhookHeaders,
					),
				})
				.where(
					and(
						eq(uptimeNotificationChannel.channelId, channelId),
						eq(uptimeNotificationChannel.userId, ctx.user.id),
					),
				)
				.returning();

			/* v8 ignore next 6 -- unreachable: UPDATE ... RETURNING on an existing row */
			if (!updated) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: ctx.t("errors.internal"),
				});
			}

			return maskNotificationChannel(updated);
		})),

  rotateSecret: protectedProcedure.input(z.object({ channelId: z.string().min(1).max(64), signingSecret: apiWebhookSigningSecret }).strict())
    .mutation(({ input, ctx }) => db.transaction(async tx => {
      const scope = and(eq(uptimeNotificationChannel.channelId, input.channelId), eq(uptimeNotificationChannel.userId, ctx.user.id));
      const [channel] = await tx.select().from(uptimeNotificationChannel).where(scope).for("update");
      if (!channel) throw notFound(ctx.t, "notification channel");
      if (channel.channelType !== "webhook") throw badRequest(ctx.t, "errors.webhookOnly");
      await tx.update(uptimeNotificationChannel).set({ signingSecretCipher: encrypt(input.signingSecret) }).where(scope);
      return { rotated: true };
    })),

	delete: protectedProcedure
		.input(z.object({ channelId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			await findOwnedChannelOrThrow(input.channelId, ctx.user.id, ctx.t);

			await db
				.delete(uptimeNotificationChannel)
				.where(
					and(
						eq(uptimeNotificationChannel.channelId, input.channelId),
						eq(uptimeNotificationChannel.userId, ctx.user.id),
					),
				);

			return { success: true };
		}),

	test: manualActionProcedure
		.input(z.object({ channelId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const channel = await findOwnedChannelOrThrow(
				input.channelId,
				ctx.user.id,
				ctx.t,
			);

			// Default channels have no monitor — test against a synthetic one.
			const monitor: typeof uptimeMonitor.$inferSelect =
				channel.uptimeMonitorId === null
					? {
							externalKey: null,
							monitorType: "http",
							networkConfig: null,
							expectedStatuses: null,
							tlsMonitoringEnabled: true,
							requestCipher: null,
							redirectPolicy: "follow",
							httpAssertions: [],
							latencyPolicy: null,
							consecutiveSlow: 0,
							consecutiveHealthy: 0,
							lastOperationalAlertAt: null,
							lastOperationalAlertId: null,
							notificationOutageId: null,
							uptimeMonitorId: `test-default-${channel.channelId}`,
							name: "Example monitor",
							url: "https://example.com",
							method: "GET",
							expectedStatus: 200,
							timeout: 10000,
							interval: 300,
							active: true,
							status: "up",
							httpStatus: 503,
							responseTime: 120,
							lastCheckedAt: null,
							nextCheckAt: null,
							tlsExpiresAt: null,
							tlsExpiresInDays: null,
							consecutiveFailures: 0,
							failureThreshold: 3,
							uptimePercentage: null,
							tags: [],
							isPublic: false,
							statusPageTitle: null,
							statusPageDescription: null,
							userId: ctx.user.id,
							createdAt: new Date().toISOString(),
						}
					: await findOwnedMonitorOrThrow(
							channel.uptimeMonitorId,
							ctx.user.id,
							ctx.t,
						);

			const testPayload = {
				test: true,
				statusChangeId: `test-${channel.channelId}-${Date.now()}`,
				uptimeMonitorId: monitor.uptimeMonitorId,
				statusBefore: "up" as const,
				statusAfter: "down" as const,
				httpStatus: monitor.httpStatus ?? 503,
				responseTime: monitor.responseTime ?? 120,
				reason: "This is a test notification from Pulsy Uptime Monitor.",
				createdAt: new Date().toISOString(),
			};

			try {
				const deliveryChannel =
					decryptNotificationChannelSecrets(channel);
				if (deliveryChannel.channelType === "email") {
					if (
						!deliveryChannel.emailProviderId ||
						!deliveryChannel.recipientAddresses?.length
					) {
						throw new Error("Email provider and recipients are required");
					}
					const provider = await findOwnedEmailProviderOrThrow(
						deliveryChannel.emailProviderId,
						ctx.user.id,
						ctx.t,
					);
					if (!provider.verified) {
						throw new Error(
							"Email provider is not verified. Test the email provider first.",
						);
					}
					const deliveryProvider = await findEmailProviderById(
						deliveryChannel.emailProviderId,
						ctx.user.id,
						true,
					);
					await Promise.all(
						deliveryChannel.recipientAddresses.map((recipient) =>
							sendViaProvider(
								deliveryProvider,
								recipient,
								"Pulsy Uptime - Test Notification",
								`
								<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
									<h2 style="margin: 0 0 16px 0;">Test notification</h2>
									<p>This is a test notification for <strong>${escapeHtml(monitor.name)}</strong>.</p>
									<p><strong>URL:</strong> ${escapeHtml(monitor.url)}</p>
									<p><strong>Status:</strong> ${testPayload.statusAfter}</p>
									/* v8 ignore next 2 -- defensive: testPayload http/response fields are coalesced to numbers above */
									<p><strong>HTTP status:</strong> ${testPayload.httpStatus ?? "Unknown"}</p>
									<p><strong>Response time:</strong> ${testPayload.responseTime ?? "Unknown"}ms</p>
									<p style="color: #64748b; font-size: 12px; margin-top: 24px;">Sent by Pulsy Uptime Monitor</p>
								</div>
								`,
							),
						),
					);
					return {
						success: true,
						message: "Test notification sent",
					};
				}

				switch (deliveryChannel.channelType) {
					case "webhook":
						await sendWebhookNotification(
							deliveryChannel,
							monitor,
							testPayload,
						);
						return { success: true, message: "Test notification sent" };
					case "slack":
						await sendSlackNotification(
							deliveryChannel,
							monitor,
							testPayload,
						);
						return { success: true, message: "Test notification sent" };
					case "discord":
						await sendDiscordNotification(
							deliveryChannel,
							monitor,
							testPayload,
						);
						return { success: true, message: "Test notification sent" };
					case "telegram":
						await sendTelegramNotification(
							deliveryChannel,
							monitor,
							testPayload,
						);
						return {
							success: true,
							message: "Test notification sent via Telegram",
						};
					/* v8 ignore next 4 -- unreachable: channelType is a constrained enum and every member is handled above */
					default:
						throw new Error(
							`Unsupported channel type: ${deliveryChannel.channelType}`,
						);
				}
			} catch (err) {
				/* v8 ignore next -- defensive: senders throw Error; the non-Error branch is unreachable */
				const details = err instanceof Error ? err.message : "";
				throw badRequest(ctx.t, "errors.testNotificationFailed", { details });
			}
		}),
});

// ---------------------------------------------------------------------------
// dashboard.*
// ---------------------------------------------------------------------------

const dashboardRouter = router({
	summary: protectedProcedure.query(async ({ ctx }) => {
    const groups = await db.select({status:uptimeMonitor.status,active:uptimeMonitor.active,total:count(),responseTotal:sum(uptimeMonitor.responseTime),responseCount:count(uptimeMonitor.responseTime)})
      .from(uptimeMonitor).where(eq(uptimeMonitor.userId,ctx.user.id)).groupBy(uptimeMonitor.status,uptimeMonitor.active);
    // One partition shared with the browser counters: paused wins over the last
    // measured health, so the per-state counters add up to Total by construction.
    const counters=countMonitorStates(groups);
    assertCountersConsistent(counters);
    const [incidentResult] = await db.select({value:count()}).from(uptimeIncident)
      .innerJoin(uptimeMonitor,eq(uptimeMonitor.uptimeMonitorId,uptimeIncident.uptimeMonitorId))
      .where(and(eq(uptimeMonitor.userId,ctx.user.id),eq(uptimeIncident.status,"ongoing")));
    const ongoingIncidents=incidentResult?.value??0;

		// Equal-weight mean of monitors with recorded checks in the last 30 days.
		// Missing coverage is unknown; genuine zero stays in the average.
		const aggregates = await getOwnedUptimeAggregates(ctx.user.id);
		const { avgUptimePercentage, uptimeMonitorsWithData } = meanUptimePercentage([...aggregates.values()].map(m => m.uptimePercentage));

    const responseCount=groups.reduce((total,row)=>total+row.responseCount,0);
    const avgResponseTime=responseCount ? Math.round(groups.reduce((total,row)=>total+Number(row.responseTotal??0),0)/responseCount) : null;

		return {
			...counters,
			ongoingIncidents,
			avgUptimePercentage,
			uptimeMonitorsWithData,
			avgResponseTime,
		};
	}),
});

// ---------------------------------------------------------------------------
// share.* — expiring share links that let anyone clone monitor configs
// ---------------------------------------------------------------------------

async function previewShareConfiguration(userId: string, ids: string[], t: Translator) {
			const monitorIds = [...new Set(ids)];

			// Every shared monitor must belong to the caller. Report a plain
			// NOT_FOUND without revealing which id failed.
			const owned = await db.query.uptimeMonitor.findMany({
				where: and(
					inArray(uptimeMonitor.uptimeMonitorId, monitorIds),
					eq(uptimeMonitor.userId, userId),
				),
			});
			if (owned.length !== monitorIds.length) {
				throw notFound(t, "monitor");
			}
			if (owned.some(monitor => monitor.monitorType !== "http")) throw badRequest(t, "errors.monitorTypeAction");
      if (owned.some(monitor => !isSafeToShare(monitor, t))) throw badRequest(t, "errors.sharePrivateValues");

 return owned.map(monitor => toSharedMonitorConfig(monitor, t));
}

const shareRouter = router({
  preview: protectedProcedure.input(apiCreateUptimeShareLink.omit({ expiresInDays: true, showSharerName: true })).mutation(({ ctx, input }) => previewShareConfiguration(ctx.user.id, input.uptimeMonitorIds, ctx.t)),
  create: protectedProcedure.input(apiCreateUptimeShareLink).mutation(async ({ input, ctx }) => db.transaction(async tx => {
    const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, ctx.user.id)).for("update");
    if (!owner) throw notFound(ctx.t, "account");
    const preview = await previewShareConfiguration(ctx.user.id, input.uptimeMonitorIds, ctx.t);
    const [live] = await tx.select({ value: count() }).from(uptimeShareLink).where(and(eq(uptimeShareLink.userId, ctx.user.id), gt(uptimeShareLink.expiresAt, new Date().toISOString())));
    assertBelowCap(live?.value ?? 0, "shareLinks", ctx.t);
    const [link] = await tx.insert(uptimeShareLink).values({ token: generateShareToken(), monitorIds: preview.map(monitor => monitor.uptimeMonitorId), expiresAt: new Date(Date.now() + input.expiresInDays * 86400000).toISOString(), showSharerName: input.showSharerName, userId: ctx.user.id }).returning();
    if (!link) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: ctx.t("errors.internal") });
    return link;
  })),

	list: protectedProcedure.query(async ({ ctx }) => {
		const links = await db.query.uptimeShareLink.findMany({
			where: eq(uptimeShareLink.userId, ctx.user.id),
			orderBy: desc(uptimeShareLink.createdAt),
		});

		// Resolve still-existing monitor names with one query across all links.
		const allMonitorIds = [...new Set(links.flatMap((l) => l.monitorIds))];
		const monitors =
			allMonitorIds.length > 0
				? await db.query.uptimeMonitor.findMany({
						where: and(
							inArray(uptimeMonitor.uptimeMonitorId, allMonitorIds),
							eq(uptimeMonitor.userId, ctx.user.id),
						),
						columns: { uptimeMonitorId: true, name: true },
					})
				: [];
		const nameById = new Map(
			monitors.map((m) => [m.uptimeMonitorId, m.name]),
		);

		return links.map((link) => ({
			shareLinkId: link.shareLinkId,
			token: link.token,
			createdAt: link.createdAt,
			expiresAt: link.expiresAt,
			showSharerName: link.showSharerName,
			monitorCount: link.monitorIds.length,
			monitorNames: link.monitorIds
				.map((id) => nameById.get(id))
				.filter((name): name is string => name !== undefined),
		}));
	}),

	revoke: protectedProcedure
		.input(apiRevokeUptimeShareLink)
		.mutation(async ({ input, ctx }) => {
			const deleted = await db
				.delete(uptimeShareLink)
				.where(
					and(
						eq(uptimeShareLink.shareLinkId, input.shareLinkId),
						eq(uptimeShareLink.userId, ctx.user.id),
					),
				)
				.returning();
			// Missing and someone-else's links are indistinguishable by design.
			if (deleted.length === 0) {
				throw notFound(ctx.t, "share link");
			}
			return { success: true };
		}),

	clone: protectedProcedure
		.input(apiCloneUptimeShareLink)
		.mutation(async ({ input, ctx }) => {
			const link = await findLiveShareLinkOrThrow(input.token, ctx.t);
			const shared = await findSharedMonitors(link, ctx.t);

			// Only monitors that are both still shared AND requested get cloned;
			// ids outside the share are silently dropped, never cloned.
			const requested = new Set(input.uptimeMonitorIds);
			const toClone = shared.filter((m) =>
				requested.has(m.uptimeMonitorId),
			);
			if (toClone.length === 0) {
				throw badRequest(ctx.t, "errors.shareLinkEmptySelection");
			}

			// Clones start fresh in the recipient's account: pending, private,
			// no history, scheduled like any newly created monitor.
      // Explicit cloning preserves OSS duplicate semantics while using the same
      // owner lock, egress policy and first-check spread as ordinary creation.
      const configurations = toClone.map(m => ({ ...apiCreateUptimeMonitor.parse({ ...toSharedMonitorConfig(m, ctx.t), active: true }), url: m.url }));
      for (const config of configurations) await assertMonitorUrlAllowed(config.url, ctx.t);
      const inserted = await db.transaction(async tx => {
        const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, ctx.user.id)).for("update");
        if (!owner) throw notFound(ctx.t, "account");
        return tx.insert(uptimeMonitor).values(configurations.map(config => ({
          userId: ctx.user.id, name: config.name, url: config.url, method: config.method,
          expectedStatus: config.expectedStatus, expectedStatuses: config.expectedStatuses ?? null,
          tlsMonitoringEnabled: config.tlsMonitoringEnabled ?? true, timeout: config.timeout,
          interval: config.interval, failureThreshold: config.failureThreshold, tags: config.tags,
          active: true, status: "pending" as const, isPublic: false, consecutiveFailures: 0,
          nextCheckAt: firstCheckAt(configurations.length),
        }))).returning();
      });
      for (const monitor of inserted) if (monitor.active) scheduleMonitorCheck(monitor, { checkIfDue: true });

			return inserted;
		}),
});

// ---------------------------------------------------------------------------
// statusPage.* — named public status pages (optionally on a verified custom
// domain). Every management query is scoped to the owning user; the public
// resolve lives in `publicRouter`. Domain ownership is proven by a DNS TXT
// challenge resolved over `dns/promises` (no outbound HTTP → no SSRF surface).
// ---------------------------------------------------------------------------

// Resolve custom-domain DNS against public resolvers, NOT the host's resolver.
// The default node resolver follows /etc/resolv.conf (systemd-resolved in a
// container/host), which caches NXDOMAIN: a domain queried before its records
// existed stays "unresolvable" for the negative-TTL even after the user adds
// the record — making verification appear stuck for any domain, not just one.
// A dedicated Resolver pinned to public DNS sidesteps that cache entirely.
// Override with DNS_RESOLVERS (comma-separated) if 1.1.1.1/8.8.8.8 are blocked.
// Known tradeoff: static public resolver list; DNS_RESOLVERS env is the upgrade path.
const dnsResolver = new Resolver({ timeout: 5000, tries: 2 });
dnsResolver.setServers(
	(process.env.DNS_RESOLVERS?.trim() || "1.1.1.1,8.8.8.8")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean),
);
const resolve4 = (host: string) => dnsResolver.resolve4(host);
const resolveTxt = (host: string) => dnsResolver.resolveTxt(host);

// The DNS label the TXT challenge is published under: `_pulsy-verify.<domain>`.
const STATUS_PAGE_VERIFY_PREFIX = "_pulsy-verify";

// Routing target the operator advertises for custom domains: the value users
// must point their hostname at (CNAME target, or A-record IP) so the host-side
// nginx + certbot daemon (ops/custom-domains) can serve the page and issue TLS.
// The TXT challenge proves *ownership*; this record provides *routing* — both
// are required. Prefer a CNAME (stable across IP changes); fall back to an A
// record. If neither env var is set (e.g. a self-hoster wiring nginx by hand),
// the attach response simply omits the routing record.
const CUSTOM_DOMAIN_CNAME_TARGET = process.env.CUSTOM_DOMAIN_CNAME_TARGET?.trim();
const CUSTOM_DOMAIN_IP = process.env.CUSTOM_DOMAIN_IP?.trim();

function customDomainRoutingRecord(customDomain: string):
	| { recordType: "CNAME" | "A"; recordName: string; recordValue: string }
	| null {
	if (CUSTOM_DOMAIN_CNAME_TARGET) {
		return {
			recordType: "CNAME",
			recordName: customDomain,
			recordValue: CUSTOM_DOMAIN_CNAME_TARGET,
		};
	}
	if (CUSTOM_DOMAIN_IP) {
		return {
			recordType: "A",
			recordName: customDomain,
			recordValue: CUSTOM_DOMAIN_IP,
		};
	}
	return null;
}

/**
 * The IP a correctly-pointed custom domain must resolve to: the configured
 * `CUSTOM_DOMAIN_IP`, or the A record of `CUSTOM_DOMAIN_CNAME_TARGET`. Returns
 * null when the operator advertises no routing target. DNS-only — no outbound
 * HTTP, so no SSRF surface (mirrors `statusPageDomainTxtMatches`).
 */
async function expectedCustomDomainIp(): Promise<string | null> {
	if (CUSTOM_DOMAIN_IP) return CUSTOM_DOMAIN_IP;
	if (CUSTOM_DOMAIN_CNAME_TARGET) {
		try {
			const [ip] = await resolve4(CUSTOM_DOMAIN_CNAME_TARGET);
			return ip ?? null;
		} catch {
			return null;
		}
	}
	return null;
}

// Slug of the always-available free default status page. The legacy
// `/status/:userId` URL resolves to it, and `list` guarantees it exists so it
// can always be opened from the dashboard. It is protected: never deletable,
// and its slug can never change.
const DEFAULT_STATUS_PAGE_SLUG = "default";
// Title used when lazily creating a user's default page (mirrors the 0006
// migration backfill); the user can rename it afterwards.
const DEFAULT_STATUS_PAGE_TITLE = "Service Status";

/** Load a status page and assert it belongs to the caller (else NOT_FOUND). */
async function findOwnedStatusPageOrThrow(
	statusPageId: string,
	userId: string,
	t: Translator,
): Promise<UptimeStatusPageRow> {
	const page = await db.query.uptimeStatusPage.findFirst({
		where: and(
			eq(uptimeStatusPage.statusPageId, statusPageId),
			eq(uptimeStatusPage.userId, userId),
		),
	});
	if (!page) {
		throw notFound(t, "statusPage");
	}
	return page;
}

/** Reject a slug already taken by another of the user's pages (per-user unique). */
async function assertStatusPageSlugAvailable(
	userId: string,
	slug: string,
	excludeStatusPageId: string | null,
	t: Translator,
): Promise<void> {
	const existing = await db.query.uptimeStatusPage.findFirst({
		where: and(
			eq(uptimeStatusPage.userId, userId),
			eq(uptimeStatusPage.slug, slug),
		),
		columns: { statusPageId: true },
	});
	if (existing && existing.statusPageId !== excludeStatusPageId) {
		throw new TRPCError({
			code: "CONFLICT",
			message: t("errors.statusPageSlugTaken"),
		});
	}
}

/**
 * True iff `name` has a TXT record whose (chunk-joined) value equals `token`.
 * Resolution failures (NXDOMAIN / no records) count as "not verified", never an
 * error — the caller decides what an unmatched challenge means.
 */
async function statusPageDomainTxtMatches(
	name: string,
	token: string,
): Promise<boolean> {
	let records: string[][];
	try {
		records = await resolveTxt(name);
	} catch {
		return false;
	}
	// node returns each TXT record as an array of ≤255-char chunks to be joined.
	return records.some((chunks) => chunks.join("").trim() === token);
}

const statusPageRouter = router({
  communication: statusCommunicationRouter,
	list: protectedProcedure.query(async ({ ctx }) => {
		// Guarantee the default page exists so it is always present in the
		// list and openable. New empty defaults remain drafts until explicitly published.
		// `onConflictDoNothing` against the per-user unique slug keeps concurrent
		// list calls safe.
		const existingDefault = await db.query.uptimeStatusPage.findFirst({
			where: and(
				eq(uptimeStatusPage.userId, ctx.user.id),
				eq(uptimeStatusPage.slug, DEFAULT_STATUS_PAGE_SLUG),
			),
			columns: { statusPageId: true },
		});
		if (!existingDefault) {
			await db
				.insert(uptimeStatusPage)
				.values({
					userId: ctx.user.id,
					slug: DEFAULT_STATUS_PAGE_SLUG,
					title: DEFAULT_STATUS_PAGE_TITLE,
					isPublished: false,
				})
				.onConflictDoNothing();
		}
    const pages = await db.query.uptimeStatusPage.findMany({
      where: eq(uptimeStatusPage.userId, ctx.user.id),
      orderBy: desc(uptimeStatusPage.createdAt),
      with: { monitors: { columns: { uptimeMonitorId: true } } },
    });
    return pages.map(({ monitors, ...page }) => ({ ...page, componentCount: monitors.length }));
	}),

	one: protectedProcedure
		.input(apiGetUptimeStatusPage)
		.query(async ({ input, ctx }) => {
			const page = await findOwnedStatusPageOrThrow(
				input.statusPageId,
				ctx.user.id,
				ctx.t,
			);
			const links = await db
				.select({ ...getTableColumns(uptimeStatusPageMonitor) })
				.from(uptimeStatusPageMonitor)
				.innerJoin(
					uptimeStatusPage,
					and(
						eq(
							uptimeStatusPageMonitor.statusPageId,
							uptimeStatusPage.statusPageId,
						),
						eq(uptimeStatusPage.userId, ctx.user.id),
					),
				)
				.innerJoin(
					uptimeMonitor,
					and(
						eq(
							uptimeStatusPageMonitor.uptimeMonitorId,
							uptimeMonitor.uptimeMonitorId,
						),
						eq(uptimeMonitor.userId, ctx.user.id),
					),
				)
				.where(eq(uptimeStatusPageMonitor.statusPageId, page.statusPageId))
				.orderBy(uptimeStatusPageMonitor.sortOrder);
			return { ...page, componentCount: links.length, monitorIds: links.map((l) => l.uptimeMonitorId) };
		}),

	create: protectedProcedure
		.input(apiCreateUptimeStatusPage)
		.mutation(async ({ input, ctx }) => {
      const requestId = randomUUID();
      try { return await db.transaction(async tx => {
      const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, ctx.user.id)).for("update");
      if (!owner) throw notFound(ctx.t, "account");
      const existing = await tx.query.uptimeStatusPage.findFirst({where:and(eq(uptimeStatusPage.userId,ctx.user.id),eq(uptimeStatusPage.slug,input.slug))});
      if (existing) {
        const links = await tx.select({id:uptimeStatusPageMonitor.uptimeMonitorId}).from(uptimeStatusPageMonitor).where(eq(uptimeStatusPageMonitor.statusPageId,existing.statusPageId));
        if(existing.title===input.title && existing.description===(input.description??null) && existing.logoUrl===(input.logoUrl??null) && existing.isPublished===input.isPublished && JSON.stringify(links.map(row=>row.id).sort())===JSON.stringify([...(input.uptimeMonitorIds??[])].sort())) return existing;
        throw new TRPCError({code:"CONFLICT",message:ctx.t("errors.statusPageSlugTaken"),cause:new FieldValidationError("slug","errors.statusPageSlugTaken")});
      }
      if (input.isPublished && !input.uptimeMonitorIds?.length && !input.confirmEmptyPublication) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.emptyPublication") });

			const [created] = await tx
				.insert(uptimeStatusPage)
				.values({
					userId: ctx.user.id,
					slug: input.slug,
					title: input.title,
					description: input.description ?? null,
					logoUrl: input.logoUrl ?? null,
					isPublished: input.isPublished,
				})
        .onConflictDoNothing({target:[uptimeStatusPage.userId,uptimeStatusPage.slug]})
				.returning();
			/* v8 ignore next 6 -- unreachable: INSERT ... RETURNING yields the row or throws */
			if (!created) {
				throw new TRPCError({
					code: "CONFLICT",
          message: ctx.t("errors.statusPageSlugTaken"),
          cause: new FieldValidationError("slug", "errors.statusPageSlugTaken"),
				});
			}
      if (input.uptimeMonitorIds) await replacePageSelectionInTransaction(tx, ctx.user.id, created.statusPageId, input.uptimeMonitorIds, ctx.t);
			return created;
      }); } catch(error) {
        if(error instanceof TRPCError) throw error;
        if(isUniqueViolation(error)) throw new TRPCError({code:"CONFLICT",message:ctx.t("errors.statusPageSlugTaken"),cause:new FieldValidationError("slug","errors.statusPageSlugTaken")});
        console.error(JSON.stringify({event:"statusPage.create.failed",requestId}));
        throw new TRPCError({code:"INTERNAL_SERVER_ERROR",message:ctx.t("errors.requestFailed",{requestId})});
      }
    }),

  duplicate: protectedProcedure.input(z.object({ statusPageId: z.string().min(1).max(64), title: z.string().trim().min(1).max(255) }).strict()).mutation(async ({ ctx, input }) => db.transaction(async tx => {
    const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, ctx.user.id)).for("update");
    if (!owner) throw notFound(ctx.t, "account");
    const [source] = await tx.select().from(uptimeStatusPage).where(and(eq(uptimeStatusPage.statusPageId, input.statusPageId), eq(uptimeStatusPage.userId, ctx.user.id))).for("share");
    if (!source) throw notFound(ctx.t, "statusPage");
    const [created] = await tx.insert(uptimeStatusPage).values({ userId: ctx.user.id, title: input.title, slug: `page-${randomUUID()}`, description: source.description, logoUrl: source.logoUrl, historyEnabled: source.historyEnabled, isPublished: false }).returning();
    if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: ctx.t("errors.internal") });
    const components = await tx.select({ uptimeMonitorId: uptimeStatusPageMonitor.uptimeMonitorId, sortOrder: uptimeStatusPageMonitor.sortOrder, publicName: uptimeStatusPageMonitor.publicName, publicDescription: uptimeStatusPageMonitor.publicDescription, publicGroup: uptimeStatusPageMonitor.publicGroup }).from(uptimeStatusPageMonitor).innerJoin(uptimeMonitor, and(eq(uptimeMonitor.uptimeMonitorId, uptimeStatusPageMonitor.uptimeMonitorId), eq(uptimeMonitor.userId, ctx.user.id))).where(eq(uptimeStatusPageMonitor.statusPageId, source.statusPageId));
    if (components.length) await tx.insert(uptimeStatusPageMonitor).values(components.map(component => ({ ...component, statusPageId: created.statusPageId })));
    return created;
  })),

	update: protectedProcedure
		.input(apiUpdateUptimeStatusPage)
		.mutation(async ({ input, ctx }) => db.transaction(async tx => {
      const [page] = await tx.select().from(uptimeStatusPage).where(and(eq(uptimeStatusPage.statusPageId, input.statusPageId), eq(uptimeStatusPage.userId, ctx.user.id))).for("update");
      if (!page) throw notFound(ctx.t, "statusPage");
      if (input.isPublished && !page.isPublished && !input.confirmEmptyPublication) {
        const [component] = await tx.select({ id: uptimeStatusPageMonitor.id }).from(uptimeStatusPageMonitor).where(eq(uptimeStatusPageMonitor.statusPageId, page.statusPageId)).limit(1);
        if (!component) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.emptyPublication") });
      }
      if (input.expected && (Object.keys(input.expected) as Array<keyof typeof input.expected>).some(key => input.expected![key] !== page[key])) throw new TRPCError({ code: "CONFLICT", message: ctx.t("errors.statusPageConflict") });
			// The default page's slug is locked (other fields stay editable).
			if (
				page.slug === DEFAULT_STATUS_PAGE_SLUG &&
				input.slug !== undefined &&
				input.slug !== DEFAULT_STATUS_PAGE_SLUG
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: ctx.t("errors.statusPageDefaultProtected"),
				});
			}
			if (input.slug !== undefined) {
				await assertStatusPageSlugAvailable(
					ctx.user.id,
					input.slug,
					input.statusPageId,
					ctx.t,
				);
			}
			const { statusPageId, expected: _expected, confirmEmptyPublication: _confirmation, ...updates } = input;
			const [updated] = await tx
				.update(uptimeStatusPage)
				.set(updates)
				.where(and(eq(uptimeStatusPage.statusPageId, statusPageId), eq(uptimeStatusPage.userId, ctx.user.id)))
				.returning();
			/* v8 ignore next 6 -- unreachable: UPDATE ... RETURNING on an existing row */
			if (!updated) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: ctx.t("errors.internal"),
				});
			}
			return updated;
		})),

	delete: protectedProcedure
		.input(apiDeleteUptimeStatusPage)
		.mutation(async ({ input, ctx }) => {
			const page = await findOwnedStatusPageOrThrow(
				input.statusPageId,
				ctx.user.id,
				ctx.t,
			);
			// The default page is the stable legacy URL and cannot be deleted.
			if (page.slug === DEFAULT_STATUS_PAGE_SLUG) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: ctx.t("errors.statusPageDefaultProtected"),
				});
			}
			const [deleted] = await db
				.delete(uptimeStatusPage)
				.where(
					and(
						eq(uptimeStatusPage.statusPageId, input.statusPageId),
						eq(uptimeStatusPage.userId, ctx.user.id),
					),
				)
				.returning({ statusPageId: uptimeStatusPage.statusPageId });
			/* v8 ignore next 3 -- defensive: ownership was checked immediately above */
			if (!deleted) {
				throw notFound(ctx.t, "statusPage");
			}
			return { success: true };
		}),

  addSelectionPreview: protectedProcedure.input(z.object({ statusPageId: z.string().min(1).max(64), monitorIds: z.array(z.string().min(1).max(64)).min(1) }).strict()).query(({ ctx, input }) => previewPageSelection(ctx.user.id, input.statusPageId, input.monitorIds, ctx.t)),
  addSelectionApply: protectedProcedure.input(z.object({ statusPageId: z.string().min(1).max(64), monitorIds: z.array(z.string().min(1).max(64)).min(1), revision: z.string().regex(/^[0-9a-f]{64}$/) }).strict()).mutation(({ ctx, input }) => applyPageSelection(ctx.user.id, input.statusPageId, input.monitorIds, input.revision, ctx.t)),
  setMonitorsPreview: protectedProcedure.input(apiSetStatusPageMonitors.omit({ revision: true })).query(({ ctx, input }) => previewPageReplacement(ctx.user.id, input.statusPageId, input.uptimeMonitorIds, ctx.t)),
  setMonitorsPreviewPost: protectedProcedure.input(apiSetStatusPageMonitors.omit({ revision: true })).mutation(({ ctx, input }) => previewPageReplacement(ctx.user.id, input.statusPageId, input.uptimeMonitorIds, ctx.t)),
  setMonitors: protectedProcedure.input(apiSetStatusPageMonitors).mutation(({ ctx, input }) => replacePageSelection(ctx.user.id, input.statusPageId, input.uptimeMonitorIds, ctx.t, input.revision)),

	// Attach (or re-point) a custom domain. Enforces global uniqueness; returns
	// the TXT record the user must publish to verify.
	attachDomain: protectedProcedure
		.input(apiAttachCustomDomain)
		.mutation(async ({ input, ctx }) => {
			const page = await findOwnedStatusPageOrThrow(
				input.statusPageId,
				ctx.user.id,
				ctx.t,
			);

			const clash = await db.query.uptimeStatusPage.findFirst({
				where: and(
					eq(uptimeStatusPage.customDomain, input.customDomain),
					eq(uptimeStatusPage.domainVerified, true),
					ne(uptimeStatusPage.statusPageId, page.statusPageId),
				),
				columns: { statusPageId: true },
			});
			if (clash) {
				throw new TRPCError({
					code: "CONFLICT",
					message: ctx.t("errors.customDomainTaken"),
				});
			}

			const token = generateShareToken();
			const [updated] = await db
				.update(uptimeStatusPage)
				.set({
					customDomain: input.customDomain,
					domainVerified: false,
					domainVerifyToken: token,
					domainVerifiedAt: null,
					// Reset any edge-provisioning state from a previously attached
					// domain — provisioning only begins once this one is verified.
					domainProvisionStatus: null,
					domainProvisionError: null,
					domainProvisionedAt: null,
				})
				.where(
					and(
						eq(uptimeStatusPage.statusPageId, page.statusPageId),
						eq(uptimeStatusPage.userId, ctx.user.id),
					),
				)
				.returning({ statusPageId: uptimeStatusPage.statusPageId });
			/* v8 ignore next 3 -- defensive: ownership was checked immediately above */
			if (!updated) {
				throw notFound(ctx.t, "statusPage");
			}

			return {
				customDomain: input.customDomain,
				recordType: "TXT" as const,
				recordName: `${STATUS_PAGE_VERIFY_PREFIX}.${input.customDomain}`,
				recordValue: token,
				domainVerified: false,
				// Routing record the user must also create (CNAME/A) so the domain
				// actually reaches this server. Null if the operator hasn't set a
				// CUSTOM_DOMAIN_CNAME_TARGET / CUSTOM_DOMAIN_IP target.
				routingRecord: customDomainRoutingRecord(input.customDomain),
			};
		}),

	// Resolve the TXT challenge over DNS. Idempotent: a already-verified page
	// short-circuits; a missing/mismatched record stays unverified (BAD_REQUEST).
	verifyDomain: protectedProcedure
		.input(apiStatusPageDomainAction)
		.mutation(async ({ input, ctx }) => {
			const page = await findOwnedStatusPageOrThrow(
				input.statusPageId,
				ctx.user.id,
				ctx.t,
			);
			if (!page.customDomain || !page.domainVerifyToken) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: ctx.t("errors.customDomainNotVerified"),
				});
			}
			if (page.domainVerified) {
				return {
					domainVerified: true,
					domainVerifiedAt: page.domainVerifiedAt,
					domainProvisionStatus: page.domainProvisionStatus,
				};
			}
			const matched = await statusPageDomainTxtMatches(
				`${STATUS_PAGE_VERIFY_PREFIX}.${page.customDomain}`,
				page.domainVerifyToken,
			);
			if (!matched) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: ctx.t("errors.customDomainNotVerified"),
				});
			}
			const domainVerifiedAt = new Date().toISOString();
			// Ownership is proven — hand the domain to the host-side provisioning
			// daemon by marking it `pending`. The daemon writes the nginx vhost and
			// issues the TLS cert once the domain's DNS points at this server, then
			// flips this to `active` (or `failed` with domainProvisionError).
			const [updated] = await db
				.update(uptimeStatusPage)
				.set({
					domainVerified: true,
					domainVerifiedAt,
					domainProvisionStatus: "pending",
					domainProvisionError: null,
				})
				.where(
					and(
						eq(uptimeStatusPage.statusPageId, page.statusPageId),
						eq(uptimeStatusPage.userId, ctx.user.id),
						eq(uptimeStatusPage.customDomain, page.customDomain),
						eq(uptimeStatusPage.domainVerifyToken, page.domainVerifyToken),
					),
				)
				.returning({ statusPageId: uptimeStatusPage.statusPageId })
        .catch((error: unknown) => {
          if (isUniqueViolation(error)) throw new TRPCError({ code: "CONFLICT", message: ctx.t("errors.customDomainTaken") });
          throw error;
        });
			if (!updated) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: ctx.t("errors.customDomainNotVerified"),
				});
			}
			return {
				domainVerified: true,
				domainVerifiedAt,
				domainProvisionStatus: "pending" as const,
			};
		}),

	detachDomain: protectedProcedure
		.input(apiStatusPageDomainAction)
		.mutation(async ({ input, ctx }) => {
			const page = await findOwnedStatusPageOrThrow(
				input.statusPageId,
				ctx.user.id,
				ctx.t,
			);
			const [updated] = await db
				.update(uptimeStatusPage)
				.set({
					customDomain: null,
					domainVerified: false,
					domainVerifyToken: null,
					domainVerifiedAt: null,
					// Clear provisioning state too; the daemon removes the nginx vhost
					// for any domain no longer present + verified on its next reconcile.
					domainProvisionStatus: null,
					domainProvisionError: null,
					domainProvisionedAt: null,
				})
				.where(
					and(
						eq(uptimeStatusPage.statusPageId, page.statusPageId),
						eq(uptimeStatusPage.userId, ctx.user.id),
					),
				)
				.returning({ statusPageId: uptimeStatusPage.statusPageId });
			/* v8 ignore next 3 -- defensive: ownership was checked immediately above */
			if (!updated) {
				throw notFound(ctx.t, "statusPage");
			}
			return { success: true };
		}),

	// Live integration status for the page's custom domain: ownership (TXT),
	// routing (does the hostname's A record point at us?), and the host daemon's
	// certificate-provisioning state. Lets the dashboard verify routing instantly
	// instead of waiting for the next ~60s daemon tick. DNS-only — the domain
	// resolved is the owner's own customDomain (no SSRF surface).
	domainStatus: protectedProcedure
		.input(apiStatusPageDomainAction)
		.query(async ({ input, ctx }) => {
			const page = await findOwnedStatusPageOrThrow(
				input.statusPageId,
				ctx.user.id,
				ctx.t,
			);
			const expectedIp = await expectedCustomDomainIp();
			let resolvedIps: string[] = [];
			if (page.customDomain) {
				try {
					resolvedIps = await resolve4(page.customDomain);
				} catch {
					resolvedIps = [];
				}
			}
			return {
				customDomain: page.customDomain,
				ownershipVerified: page.domainVerified,
				routing: {
					ok: expectedIp != null && resolvedIps.includes(expectedIp),
					resolvedIps,
					expectedIp,
					record: page.customDomain
						? customDomainRoutingRecord(page.customDomain)
						: null,
				},
				provisionStatus: page.domainProvisionStatus,
				provisionError: page.domainProvisionError,
				provisionedAt: page.domainProvisionedAt,
			};
		}),
});

// ---------------------------------------------------------------------------
// public.* (no auth required) — resolves published status pages by per-user
// (userId, slug), by verified custom-domain Host, and the legacy per-user URL.
// ---------------------------------------------------------------------------

/**
 * Safe per-monitor projection for any public status page. This is the ONLY
 * shape a public resolve exposes — never url/httpStatus/TLS/channels/owner
 * identity. Centralized so no caller inlines an alternative.
 */
type PublicMonitorSource = UptimeMonitorRow & { componentId?: string; publicDescription?: string | null; publicGroup?: string | null };
function toPublicMonitorStatus(m: PublicMonitorSource, sample: { availabilityPercentage: number; slowPercentage: number } | undefined) {
	return {
		componentId: m.componentId ?? null,
		description: m.publicDescription ?? null,
		group: m.publicGroup ?? null,
		monitorType: m.monitorType,
		name: m.name,
		status: m.status,
		// Rolling 30-day availability: (up + degraded) / recorded checks (see
		// availabilityPercent). A degraded check answered correctly, so a slow
		// monitor reads ≈100% with `slowPercentage` reported separately. The
		// stored monitor column is never written, so it is not read here.
		uptimePercentage: sample?.availabilityPercentage ?? null,
		slowPercentage: sample?.slowPercentage ?? null,
		responseTime: m.responseTime,
		lastCheckedAt: m.lastCheckedAt,
	};
}

/**
 * Build the sanitized public aggregate (safe monitors + overall status +
 * last-7-day incidents) from a set of the owner's monitor rows. Shared by every
 * public entry point so the three surfaces are byte-identical.
 */
async function buildPublicStatusAggregate(monitors: PublicMonitorSource[]) {
	const overallStatus = computeOverallStatus(monitors);

	const sevenDaysAgo = new Date(
		Date.now() - 7 * 24 * 60 * 60 * 1000,
	).toISOString();
	const monitorIds = monitors.map((m) => m.uptimeMonitorId);
	// Every monitor of a public page is re-queried with the page owner's userId.
	const samples = monitors[0]
		? await getOwnedUptimeAggregates(monitors[0].userId, 30, monitorIds)
		: new Map<string, { availabilityPercentage: number; slowPercentage: number }>();

	let recentIncidents: Array<{
		monitorName: string;
		status: string;
		startedAt: string;
		resolvedAt: string | null;
		durationSeconds: number | null;
	}> = [];

	if (monitorIds.length > 0) {
		const incidents = await db
			.select({ ...getTableColumns(uptimeIncident) })
			.from(uptimeIncident)
      .innerJoin(uptimeMonitor, and(eq(uptimeMonitor.uptimeMonitorId, uptimeIncident.uptimeMonitorId), eq(uptimeMonitor.userId, monitors[0]!.userId)))
			.where(
				and(
					inArray(uptimeIncident.uptimeMonitorId, monitorIds),
					gte(uptimeIncident.startedAt, sevenDaysAgo),
				),
			)
			.orderBy(desc(uptimeIncident.startedAt))
			.limit(20);

		const monitorMap = new Map(
			monitors.map((m) => [m.uptimeMonitorId, m.name]),
		);
		recentIncidents = incidents.map((inc) => ({
			/* v8 ignore next -- defensive: every incident maps to one of the page's monitors */
			monitorName: monitorMap.get(inc.uptimeMonitorId) ?? "Unknown",
			status: inc.status,
			startedAt: inc.startedAt,
			resolvedAt: inc.resolvedAt,
			durationSeconds: inc.durationSeconds,
		}));
	}

	return {
		asOf: new Date().toISOString(),
		monitors: monitors.map((m) => toPublicMonitorStatus(m, samples.get(m.uptimeMonitorId))),
		overallStatus,
		recentIncidents,
	};
}

/** Wrap a published page aggregate with its display metadata. */
async function toPublicStatusPageView(
	page: UptimeStatusPageRow,
	aggregate: Awaited<ReturnType<typeof buildPublicStatusAggregate>>,
) {
  const maintenance = await publicMaintenanceComponents(page.userId, page.statusPageId);
	return {
		title: page.title,
		description: page.description,
		logoUrl: page.logoUrl,
		publicKey: page.statusPageId,
		historyEnabled: page.historyEnabled,
		emailSubscriptionsEnabled: await publicSubscriptionReady(page.userId, page.statusPageId),
		announcements: await publishedAnnouncements(page.userId, page.statusPageId),
		...aggregate,
    monitors: aggregate.monitors.map(monitor => ({ ...monitor, maintenance: !!monitor.componentId && maintenance.has(monitor.componentId) })),
	};
}

/**
 * The active monitors linked to a page, in the page's sort order, re-queried
 * under the page owner's id — so a monitor the owner deleted or deactivated
 * silently drops out at resolve time.
 */
async function resolveStatusPageMonitors(
	page: UptimeStatusPageRow,
): Promise<PublicMonitorSource[]> {
	const links = await db
		.select()
		.from(uptimeStatusPageMonitor)
		.where(eq(uptimeStatusPageMonitor.statusPageId, page.statusPageId))
		.orderBy(uptimeStatusPageMonitor.sortOrder);
	if (links.length === 0) return [];

	const monitors = await db.query.uptimeMonitor.findMany({
		where: and(
			eq(uptimeMonitor.userId, page.userId),
			inArray(
				uptimeMonitor.uptimeMonitorId,
				links.map((l) => l.uptimeMonitorId),
			),
			eq(uptimeMonitor.active, true),
		),
	});
	const byId = new Map(monitors.map((m) => [m.uptimeMonitorId, m]));
	// Preserve the page's order; drop links whose monitor is gone/inactive.
	return links.flatMap(link => {
    const monitor = byId.get(link.uptimeMonitorId);
    return monitor ? [{ ...monitor, name: link.publicName ?? monitor.name, componentId: link.id, publicDescription: link.publicDescription, publicGroup: link.publicGroup }] : [];
  });
}

/** Internal resolver for dedicated published HTTP projections. Never serialize the page row. */
export async function readPublishedStatusPageByKey(publicKey: string) {
  const page = await db.query.uptimeStatusPage.findFirst({ where: and(eq(uptimeStatusPage.statusPageId, publicKey), eq(uptimeStatusPage.isPublished, true)) });
  if (!page) return null;
  return { page, view: await toPublicStatusPageView(page, await buildPublicStatusAggregate(await resolveStatusPageMonitors(page))) };
}

const publicRouter = router({
	// Legacy per-user URL (`/status/:userId`). Delegates to the user's `default`
	// published default page only; missing/draft identities never expose a fallback.
	status: publicProcedure
		.input(z.object({ userId: z.string() }))
		.query(async ({ input, ctx }) => {
			const page = await db.query.uptimeStatusPage.findFirst({
				where: and(
					eq(uptimeStatusPage.userId, input.userId),
					eq(uptimeStatusPage.slug, "default"),
				),
			});
			if (!page || !page.isPublished) {
				throw notFound(ctx.t, "statusPage");
			}
			const monitors = await resolveStatusPageMonitors(page);
			return toPublicStatusPageView(page, await buildPublicStatusAggregate(monitors));
		}),

	// Resolve a published page by its per-user (userId, slug). Unpublished or
	// missing → NOT_FOUND (indistinguishable).
	statusPageBySlug: publicProcedure
		.input(apiResolveStatusPageBySlug)
		.query(async ({ input, ctx }) => {
			const page = await db.query.uptimeStatusPage.findFirst({
				where: and(
					eq(uptimeStatusPage.userId, input.userId),
					eq(uptimeStatusPage.slug, input.slug),
				),
			});
			if (!page || !page.isPublished) {
				throw notFound(ctx.t, "statusPage");
			}
			const monitors = await resolveStatusPageMonitors(page);
			return toPublicStatusPageView(page, await buildPublicStatusAggregate(monitors));
		}),

	// Resolve a published page by its DNS-verified custom-domain Host. Requires
	// BOTH domainVerified and isPublished; otherwise NOT_FOUND.
	statusPageByDomain: publicProcedure
		.input(apiResolveStatusPageByDomain)
		.query(async ({ input, ctx }) => {
			const page = await db.query.uptimeStatusPage.findFirst({
				where: and(eq(uptimeStatusPage.customDomain, input.host), eq(uptimeStatusPage.domainVerified, true), eq(uptimeStatusPage.isPublished, true)),
			});
			if (!page || !page.domainVerified || !page.isPublished) {
				throw notFound(ctx.t, "statusPage");
			}
			const monitors = await resolveStatusPageMonitors(page);
			return toPublicStatusPageView(page, await buildPublicStatusAggregate(monitors));
		}),

	// Resolve a share link for the claim page. Public because the recipient may
	// not be signed in yet; returns ONLY cloneable config fields plus the
	// sharer's display name — never the owner's id, email, channels, or any
	// monitor state/history.
	sharedLink: publicProcedure
		.input(apiResolveUptimeShareLink)
		.query(async ({ input, ctx }) => {
			const link = await findLiveShareLinkOrThrow(input.token, ctx.t);
			const monitors = await findSharedMonitors(link, ctx.t);

			// The display name is exposed only when the owner opted in on this
			// link; otherwise the claim page shows a generic sharer.
			const owner = link.showSharerName
				? await db.query.user.findFirst({
						where: eq(user.id, link.userId),
						columns: { name: true },
					})
				: undefined;

			return {
				/* v8 ignore next -- defensive: the user FK cascade deletes the link with its owner */
				sharedBy: owner?.name.trim() || null,
				expiresAt: link.expiresAt,
				monitors: monitors.map(monitor => toSharedMonitorConfig(monitor, ctx.t)),
			};
		}),
});

// ---------------------------------------------------------------------------
// slaReport.* — monthly SLA / uptime reports.
// `data` replaces the former `monitor.slaReport` query (breaking path change).
// ---------------------------------------------------------------------------

/** Load an SLA-report subscription and assert it belongs to the caller. */
async function findOwnedSubscriptionOrThrow(
	slaReportSubscriptionId: string,
	userId: string,
	t: Translator,
): Promise<UptimeSlaReportSubscriptionRow> {
	const sub = await db.query.uptimeSlaReportSubscription.findFirst({
		where: and(
			eq(
				uptimeSlaReportSubscription.slaReportSubscriptionId,
				slaReportSubscriptionId,
			),
			eq(uptimeSlaReportSubscription.userId, userId),
		),
	});
	if (!sub) {
		throw notFound(t, "subscription");
	}
	return sub;
}

const slaReportSubscriptionRouter = router({
	list: protectedProcedure.query(async ({ ctx }) => {

		const subs = await db.query.uptimeSlaReportSubscription.findMany({
			where: eq(uptimeSlaReportSubscription.userId, ctx.user.id),
			orderBy: desc(uptimeSlaReportSubscription.createdAt),
		});

		const monitorIds = subs
			.map((s) => s.uptimeMonitorId)
			.filter((id): id is string => id !== null);
		const monitors =
			monitorIds.length > 0
				? await db.query.uptimeMonitor.findMany({
						where: and(
							inArray(uptimeMonitor.uptimeMonitorId, monitorIds),
							eq(uptimeMonitor.userId, ctx.user.id),
						),
						columns: { uptimeMonitorId: true, name: true },
					})
				: [];
		const nameById = new Map(monitors.map((m) => [m.uptimeMonitorId, m.name]));

		return subs.map((s) => ({
			slaReportSubscriptionId: s.slaReportSubscriptionId,
			uptimeMonitorId: s.uptimeMonitorId,
			monitorName: s.uptimeMonitorId
				? (nameById.get(s.uptimeMonitorId) ?? null)
				: null,
			recipientAddresses: s.recipientAddresses,
			emailProviderId: s.emailProviderId,
			active: s.active,
			lastSentAt: s.lastSentAt,
			createdAt: s.createdAt,
		}));
	}),

	upsert: protectedProcedure
		.input(apiUpsertSlaReportSubscription)
		.mutation(async ({ input, ctx }) => {

			// A bound monitor (if any) and the provider must belong to the caller.
			if (input.uptimeMonitorId) {
				await findOwnedMonitorOrThrow(
					input.uptimeMonitorId,
					ctx.user.id,
					ctx.t,
				);
			}
			const provider = await findOwnedEmailProviderOrThrow(
				input.emailProviderId,
				ctx.user.id,
				ctx.t,
			);
			if (input.active && !provider.verified) {
				throw badRequest(ctx.t, "errors.slaProviderUnverified");
			}

			if (input.slaReportSubscriptionId) {
				const [updated] = await db
					.update(uptimeSlaReportSubscription)
					.set({
						uptimeMonitorId: input.uptimeMonitorId ?? null,
						recipientAddresses: input.recipientAddresses,
						emailProviderId: input.emailProviderId,
						active: input.active,
					})
					.where(
						and(
							eq(
								uptimeSlaReportSubscription.slaReportSubscriptionId,
								input.slaReportSubscriptionId,
							),
							eq(uptimeSlaReportSubscription.userId, ctx.user.id),
						),
					)
					.returning();
				if (!updated) {
					throw notFound(ctx.t, "subscription");
				}
				return updated;
			}

			return db.transaction(async tx => {
				await tx.select({ id: user.id }).from(user).where(eq(user.id, ctx.user.id)).for("update");
				const [subscriptions] = await tx.select({ value: count() }).from(uptimeSlaReportSubscription)
					.where(eq(uptimeSlaReportSubscription.userId, ctx.user.id));
				assertBelowCap(subscriptions?.value ?? 0, "slaSubscriptions", ctx.t);
				const [created] = await tx
					.insert(uptimeSlaReportSubscription)
					.values({
						uptimeMonitorId: input.uptimeMonitorId ?? null,
						userId: ctx.user.id,
						recipientAddresses: input.recipientAddresses,
						emailProviderId: input.emailProviderId,
						active: input.active,
					})
					.returning();
				/* v8 ignore next 6 -- unreachable: INSERT ... RETURNING yields the row or throws */
				if (!created) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: ctx.t("errors.internal"),
					});
				}
				return created;
			});
		}),

	remove: protectedProcedure
		.input(apiRemoveSlaReportSubscription)
		.mutation(async ({ input, ctx }) => {
			const deleted = await db
				.delete(uptimeSlaReportSubscription)
				.where(
					and(
						eq(
							uptimeSlaReportSubscription.slaReportSubscriptionId,
							input.slaReportSubscriptionId,
						),
						eq(uptimeSlaReportSubscription.userId, ctx.user.id),
					),
				)
				.returning();
			if (deleted.length === 0) {
				throw notFound(ctx.t, "subscription");
			}
			return { success: true };
		}),

	sendNow: protectedProcedure
		.input(apiSendSlaReportNow)
		.mutation(async ({ input, ctx }) => {
			const sub = await findOwnedSubscriptionOrThrow(
				input.slaReportSubscriptionId,
				ctx.user.id,
				ctx.t,
			);
			return processSubscription(sub, new Date());
		}),
});

const slaReportRouter = router({
	// Keep the downloaded PDF and visible report on one owned measurement snapshot.
	download: protectedProcedure.input(apiSlaReport).query(async ({ input, ctx }) => {
		const report = await buildSlaReportModel({
			monitorId: input.uptimeMonitorId,
			userId: ctx.user.id,
			window: { kind: "days", days: input.days },
			t: ctx.t,
		});
		const pdf = await renderSlaReportPdf(report, ctx.t, ctx.language, input.timezone ?? await accountReportTimezone(ctx.user.id));
		return { report, pdf: pdf.toString("base64") };
	}),
	data: protectedProcedure.input(apiSlaReport).query(async ({ input, ctx }) => {
		return buildSlaReportModel({
			monitorId: input.uptimeMonitorId,
			userId: ctx.user.id,
			window: { kind: "days", days: input.days },
			t: ctx.t,
		});
	}),
	subscription: slaReportSubscriptionRouter,
});

// ---------------------------------------------------------------------------
// Aggregate router — nested sub-routers produce paths like
// `uptimeMonitor.monitor.list`, `uptimeMonitor.checkLog.stats`, etc.
// ---------------------------------------------------------------------------

export const uptimeRouter = router({
  portability: monitorPortabilityRouter,
  view: monitorViewsRouter,
  template: monitorTemplatesRouter,
  server: serverHealthRouter,
  heartbeat: heartbeatRouter,
	maintenance: maintenanceRouter,
	incidentWorkspace: incidentWorkspaceRouter,
	reliability: reliabilityRouter,
  network: networkRouter,
  egress: egressRouter,
	monitor: monitorRouter,
	statusChange: statusChangeRouter,
	notificationLog: notificationLogRouter,
	checkLog: checkLogRouter,
	incident: incidentRouter,
	emailProvider: emailProviderRouter,
	channel: channelRouter,
	share: shareRouter,
	statusPage: statusPageRouter,
	slaReport: slaReportRouter,
	dashboard: dashboardRouter,
	public: publicRouter,
});
