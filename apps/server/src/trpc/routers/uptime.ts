import { apiNetworkMonitor } from "@pulsy/db/validation-network";
import { randomUUID } from "node:crypto";
import { createNetworkMonitor, updateNetworkMonitor } from "../../services/uptime/network-monitor";
import { assertMonitorUrlAllowed, isMonitorUrlAllowed, isMonitorHostAllowed } from "../../services/uptime/egress-input";
import { httpConfigPatch, assertCredentialOrigin, maskMonitor, toOwnerMonitor } from "../../services/uptime/http-config";
import { updateUptimeMonitor } from "../../services/uptime/monitor-service";
import { createMonitorsForUser } from "../../services/uptime/monitor-operations";
import { performHttpCheck } from "../../services/uptime/checker-service";
import { evaluateLatencyTransition } from "../../services/uptime/latency-policy";
import { updateMonitorsBulk, deleteMonitorsBulk } from "../../services/uptime/bulk-monitor-write";
import { firstCheckAt } from "../../services/uptime/first-check";
import { getOwnedUptimeAggregates, getMonitorDailyUptime } from "../../services/uptime/stats-service";
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
	eq,
	gte,
	ilike,
	inArray,
	isNull,
	lte,
	count,
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
): Promise<UptimeMonitorRow[]> {
	return db.query.uptimeMonitor.findMany({
		where: and(
			inArray(uptimeMonitor.uptimeMonitorId, link.monitorIds),
			eq(uptimeMonitor.userId, link.userId),
		),
	});
}

/**
 * The only monitor fields a share link ever exposes or clones. Never current
 * status, history, TLS data, status-page settings, or anything owner-scoped.
 */
function toSharedMonitorConfig(m: UptimeMonitorRow) {
	return {
		uptimeMonitorId: m.uptimeMonitorId,
		name: m.name,
		url: m.url,
		method: m.method,
		expectedStatus: m.expectedStatus,
		timeout: m.timeout,
		interval: m.interval,
		failureThreshold: m.failureThreshold,
		tags: m.tags ?? [],
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
    activeHttpTests.add(ctx.user.id);
    try {
      const result = await performHttpCheck(candidate);
      if (!candidate.latencyPolicy) return result;
      const sample = evaluateLatencyTransition({ previousStatus: "pending", checkStatus: result.status, responseTime: result.responseTime, consecutiveFailures: 0, failureThreshold: candidate.failureThreshold, consecutiveSlow: 0, consecutiveHealthy: 0, policy: candidate.latencyPolicy });
      return { ...result, status: sample.sampleStatus, latencySample: true };
    }
    finally { activeHttpTests.delete(ctx.user.id); }
  }),
	list: protectedProcedure.query(async ({ ctx }) => {
		const monitors = await db.query.uptimeMonitor.findMany({
			where: eq(uptimeMonitor.userId, ctx.user.id),
			orderBy: desc(uptimeMonitor.createdAt),
		});
		const aggregates = await getOwnedUptimeAggregates(ctx.user.id, 30, monitors.map(m => m.uptimeMonitorId));
    return monitors.map(m => ({ ...maskMonitor(m), ...(aggregates.get(m.uptimeMonitorId) ?? { uptimeChecks: 0 }) }));
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
			return {
				...maskMonitor(monitor),
				notificationChannels: monitor.notificationChannels.map(
					maskNotificationChannel,
				),
			};
		}),

  create: localizedHttpProcedure.input(apiCreateUptimeMonitor).mutation(async ({ input, ctx }) => {
    const monitor = await createMonitorForUser(input, ctx.user.id, ctx.t);
    if (monitor.active) scheduleMonitorCheck(monitor, { checkIfDue: true });
    return maskMonitor(monitor);
  }),
  createBulk: localizedHttpProcedure.input(apiCreateUptimeMonitorsBulk).mutation(async ({ input, ctx }) => {
    const monitors = await createMonitorsForUser(input.monitors, ctx.user.id, ctx.t, "urls");
    for (const monitor of monitors) if (monitor.active) scheduleMonitorCheck(monitor, { checkIfDue: true });
    return monitors.map(maskMonitor);
  }),
  update: localizedHttpProcedure.input(apiUpdateUptimeMonitor).mutation(async ({ input, ctx }) => {
    const updated = await updateUptimeMonitor(input, ctx.user.id, ctx.t);
    if (updated.active) rescheduleMonitorCheck(updated); else cancelMonitorCheck(updated.uptimeMonitorId);
    return maskMonitor(updated);
  }),
  updateBulk: protectedProcedure.input(apiUpdateUptimeMonitorsBulk).mutation(async ({ input, ctx }) => {
    const requestId = ctx.requestId ?? randomUUID();
    const result = await updateMonitorsBulk(input, ctx.user.id, ctx.t, requestId);
    for (const monitor of result.updated) {
      try { if (monitor.active) rescheduleMonitorCheck(monitor); else cancelMonitorCheck(monitor.uptimeMonitorId); }
      catch { console.error(JSON.stringify({event:"monitor.updateBulk.scheduler.failed", requestId, monitorId:monitor.uptimeMonitorId})); }
    }
    return { updated: result.updated.map(maskMonitor), results: result.results };
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
      const [row] = await tx.update(uptimeMonitor).set({ active: !monitor.active, nextCheckAt: !monitor.active ? firstCheckAt() : null }).where(scope).returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: ctx.t("errors.internal") });
      return row;
    });
    if (updated.active) scheduleMonitorCheck(updated, { checkIfDue: true }); else cancelMonitorCheck(updated.uptimeMonitorId);
    return maskMonitor(updated);
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
			return maskMonitor(await runManualCheck(monitor, ctx.t));
		}),
});

const networkRouter = router({
  create: protectedProcedure.input(apiNetworkMonitor).mutation(async ({ input, ctx }) => {
    const monitor = await createNetworkMonitor(input, ctx.user.id, ctx.t);
    if (monitor.active) scheduleMonitorCheck(monitor, { checkIfDue: true });
    return maskMonitor(monitor);
  }),
  update: protectedProcedure.input(apiNetworkMonitor.extend({ monitorId: z.string() })).mutation(async ({ input, ctx }) => {
    const monitor = await updateNetworkMonitor(input, ctx.user.id, ctx.t);
    if (monitor.active) rescheduleMonitorCheck(monitor); else cancelMonitorCheck(monitor.uptimeMonitorId);
    return maskMonitor(monitor);
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
    const until = new Date();
    const since = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate() - input.days + 1)).toISOString();
    return getMonitorDailyUptime(input.uptimeMonitorId, ctx.user.id, since, until.toISOString());
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

	stats: protectedProcedure
		.input(
			z.object({
				uptimeMonitorId: z.string(),
				days: z.number().int().min(1).max(90).default(30),
			}),
		)
		.query(async ({ input, ctx }) => {
			await findOwnedMonitorOrThrow(input.uptimeMonitorId, ctx.user.id, ctx.t);

			const since = new Date(
				Date.now() - input.days * 24 * 60 * 60 * 1000,
			).toISOString();

			const conditions = and(
				eq(uptimeCheckLog.uptimeMonitorId, input.uptimeMonitorId),
				gte(uptimeCheckLog.createdAt, since),
			);

			const logs = await db
				.select({
					status: uptimeCheckLog.status,
					responseTime: uptimeCheckLog.responseTime,
				})
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
				.where(conditions);

			const total = logs.length;
			const upLogs = logs.filter((log) => log.status === "up");
			const up = upLogs.length;
			const uptimePercentage =
				total > 0 ? Math.round((up / total) * 10000) / 100 : 0;
			const responseTimes = logs
				.map((log) => log.responseTime)
				.filter((value): value is number => typeof value === "number");
			const upResponseTimes = upLogs
				.map((log) => log.responseTime)
				.filter((value): value is number => typeof value === "number");
			const avgResponseTime =
				upResponseTimes.length > 0
					? Math.round(
							upResponseTimes.reduce((sum, value) => sum + value, 0) /
								upResponseTimes.length,
						)
					: 0;
			const maxResponseTime =
				responseTimes.length > 0 ? Math.max(...responseTimes) : 0;
			const minResponseTime =
				upResponseTimes.length > 0 ? Math.min(...upResponseTimes) : 0;

			// Incident count in the period
			const [incidentCount] = await db
				.select({ value: count() })
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
				.where(
					and(
						eq(uptimeIncident.uptimeMonitorId, input.uptimeMonitorId),
						gte(uptimeIncident.startedAt, since),
					),
				);

			return {
				totalChecks: total,
				upChecks: up,
				downChecks: total - up,
				uptimePercentage,
				avgResponseTime,
				maxResponseTime,
				minResponseTime,
				/* v8 ignore next -- defensive: COUNT(*) always returns exactly one row */
				incidentCount: incidentCount?.value ?? 0,
				days: input.days,
			};
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

	test: protectedProcedure
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

	createDefault: protectedProcedure
		.input(apiCreateUptimeDefaultNotificationChannel)
		.mutation(async ({ input, ctx }) => {
			assertNotificationChannelConfig(input, ctx.t);
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

			const [inserted] = await db
				.insert(uptimeNotificationChannel)
				.values({
					uptimeMonitorId: null,
					userId: ctx.user.id,
					channelType: input.channelType,
					emailProviderId: input.emailProviderId ?? null,
					recipientAddresses: input.recipientAddresses ?? null,
					...storedSecrets,
					notifyOnDown: input.notifyOnDown,
					notifyOnRecovery: input.notifyOnRecovery,
					notifyOnTlsExpiry: input.notifyOnTlsExpiry,
					tlsExpiryThresholdDays: input.tlsExpiryThresholdDays,
				})
				.returning();

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

			const [inserted] = await db
				.insert(uptimeNotificationChannel)
				.values({
					uptimeMonitorId: input.uptimeMonitorId,
					userId: ctx.user.id,
					channelType: input.channelType,
					emailProviderId: input.emailProviderId ?? null,
					recipientAddresses: input.recipientAddresses ?? null,
					...storedSecrets,
					notifyOnDown: input.notifyOnDown,
					notifyOnRecovery: input.notifyOnRecovery,
					notifyOnTlsExpiry: input.notifyOnTlsExpiry,
					tlsExpiryThresholdDays: input.tlsExpiryThresholdDays,
				})
				.returning();

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
		.mutation(async ({ input, ctx }) => {
			const channel = await findOwnedChannelOrThrow(
				input.channelId,
				ctx.user.id,
				ctx.t,
			);
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

			// Validate email provider if changing
			if (nextChannel.emailProviderId) {
				await findOwnedEmailProviderOrThrow(
					nextChannel.emailProviderId,
					ctx.user.id,
					ctx.t,
				);
			}

			const [updated] = await db
				.update(uptimeNotificationChannel)
				.set({
					...updates,
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
		}),

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

	test: protectedProcedure
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
		const monitors = await db
			.select()
			.from(uptimeMonitor)
			.where(eq(uptimeMonitor.userId, ctx.user.id));

		const totalMonitors = monitors.length;
		const activeMonitors = monitors.filter((m) => m.active).length;
		const monitorsUp = monitors.filter((m) => m.status === "up").length;
		const monitorsDown = monitors.filter((m) => m.status === "down").length;
		const monitorsDegraded = monitors.filter(
			(m) => m.status === "degraded",
		).length;
		const monitorsPending = monitors.filter(
			(m) => m.status === "pending",
		).length;

		// Ongoing incidents across all monitors
		const monitorIds = monitors.map((m) => m.uptimeMonitorId);

		let ongoingIncidents = 0;
		if (monitorIds.length > 0) {
			const [incidentResult] = await db
				.select({ value: count() })
				.from(uptimeIncident)
				.where(
					and(
						inArray(uptimeIncident.uptimeMonitorId, monitorIds),
						eq(uptimeIncident.status, "ongoing"),
					),
				);
			/* v8 ignore next -- defensive: COUNT(*) always returns exactly one row */
			ongoingIncidents = incidentResult?.value ?? 0;
		}

		// Average uptime percentage across all monitors with data
		const monitorsWithUptime = monitors.filter(
			(m) => m.uptimePercentage !== null,
		);
		const avgUptimePercentage =
			monitorsWithUptime.length > 0
				? Math.round(
						(monitorsWithUptime.reduce(
							/* v8 ignore next -- defensive: list is pre-filtered to non-null uptimePercentage */
							(sum, m) => sum + (m.uptimePercentage ?? 0),
							0,
						) /
							monitorsWithUptime.length) *
							100,
					) / 100
				: null;

		// Average response time across monitors with data
		const monitorsWithResponseTime = monitors.filter(
			(m) => m.responseTime !== null,
		);
		const avgResponseTime =
			monitorsWithResponseTime.length > 0
				? Math.round(
						monitorsWithResponseTime.reduce(
							/* v8 ignore next -- defensive: list is pre-filtered to non-null responseTime */
							(sum, m) => sum + (m.responseTime ?? 0),
							0,
						) / monitorsWithResponseTime.length,
					)
				: null;

		return {
			totalMonitors,
			activeMonitors,
			monitorsUp,
			monitorsDown,
			monitorsDegraded,
			monitorsPending,
			ongoingIncidents,
			avgUptimePercentage,
			avgResponseTime,
		};
	}),
});

// ---------------------------------------------------------------------------
// share.* — expiring share links that let anyone clone monitor configs
// ---------------------------------------------------------------------------

const shareRouter = router({
	create: protectedProcedure
		.input(apiCreateUptimeShareLink)
		.mutation(async ({ input, ctx }) => {
			const monitorIds = [...new Set(input.uptimeMonitorIds)];

			// Every shared monitor must belong to the caller. Report a plain
			// NOT_FOUND without revealing which id failed.
			const owned = await db.query.uptimeMonitor.findMany({
				where: and(
					inArray(uptimeMonitor.uptimeMonitorId, monitorIds),
					eq(uptimeMonitor.userId, ctx.user.id),
				),
				columns: { uptimeMonitorId: true },
			});
			if (owned.length !== monitorIds.length) {
				throw notFound(ctx.t, "monitor");
			}

			const [link] = await db
				.insert(uptimeShareLink)
				.values({
					token: generateShareToken(),
					monitorIds,
					expiresAt: new Date(
						Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
					).toISOString(),
					userId: ctx.user.id,
				})
				.returning();

			/* v8 ignore next 6 -- unreachable: INSERT ... RETURNING yields the row or throws */
			if (!link) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: ctx.t("errors.internal"),
				});
			}

			return link;
		}),

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
			const shared = await findSharedMonitors(link);

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
			const inserted = await db
				.insert(uptimeMonitor)
				.values(
					toClone.map((m) => {
						const config = toSharedMonitorConfig(m);
						return {
							name: config.name,
							url: config.url,
							method: config.method,
							expectedStatus: config.expectedStatus,
							timeout: config.timeout,
							interval: config.interval,
							failureThreshold: config.failureThreshold,
							tags: config.tags,
							active: true,
							status: "pending" as const,
							consecutiveFailures: 0,
							isPublic: false,
							nextCheckAt: new Date(
								Date.now() + config.interval * 1000,
							).toISOString(),
							userId: ctx.user.id,
						};
					}),
				)
				.returning();

			for (const monitor of inserted) {
				scheduleMonitorCheck(monitor);
			}

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
	list: protectedProcedure.query(async ({ ctx }) => {
		// Guarantee the free default page exists so it is always present in the
		// list and openable. Created published (empty page renders "operational").
		// `onConflictDoNothing` against the per-user unique slug keeps concurrent
		// list calls safe and bypasses the tier limit (this is the free default).
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
					isPublished: true,
				})
				.onConflictDoNothing();
		}
		return db.query.uptimeStatusPage.findMany({
			where: eq(uptimeStatusPage.userId, ctx.user.id),
			orderBy: desc(uptimeStatusPage.createdAt),
		});
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
			return { ...page, monitorIds: links.map((l) => l.uptimeMonitorId) };
		}),

	create: protectedProcedure
		.input(apiCreateUptimeStatusPage)
		.mutation(async ({ input, ctx }) => {
			await assertStatusPageSlugAvailable(ctx.user.id, input.slug, null, ctx.t);

			const [created] = await db
				.insert(uptimeStatusPage)
				.values({
					userId: ctx.user.id,
					slug: input.slug,
					title: input.title,
					description: input.description ?? null,
					logoUrl: input.logoUrl ?? null,
					isPublished: input.isPublished,
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
		}),

	update: protectedProcedure
		.input(apiUpdateUptimeStatusPage)
		.mutation(async ({ input, ctx }) => {
			const page = await findOwnedStatusPageOrThrow(
				input.statusPageId,
				ctx.user.id,
				ctx.t,
			);
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
			const { statusPageId, ...updates } = input;
			const [updated] = await db
				.update(uptimeStatusPage)
				.set(updates)
				.where(
					and(
						eq(uptimeStatusPage.statusPageId, statusPageId),
						eq(uptimeStatusPage.userId, ctx.user.id),
					),
				)
				.returning();
			/* v8 ignore next 3 -- defensive: ownership was checked immediately above */
			if (!updated) {
				throw notFound(ctx.t, "statusPage");
			}
			return updated;
		}),

	delete: protectedProcedure
		.input(apiDeleteUptimeStatusPage)
		.mutation(async ({ input, ctx }) => {
			const page = await findOwnedStatusPageOrThrow(
				input.statusPageId,
				ctx.user.id,
				ctx.t,
			);
			// The default page is the guaranteed free page and can't be deleted.
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

	// Replace a page's monitor set wholesale. Every id must belong to the caller;
	// a mismatch is a plain NOT_FOUND that never reveals which id failed (mirrors
	// share.create).
	setMonitors: protectedProcedure
		.input(apiSetStatusPageMonitors)
		.mutation(async ({ input, ctx }) => {
			const ids = [...new Set(input.uptimeMonitorIds)];
			return db.transaction(async (tx) => {
				// Lock the owned parent and every submitted monitor for the full
				// replace, closing the ownership-check/mutation race and making a
				// rejected mixed-owner batch leave the previous links untouched.
				const [page] = await tx
					.select()
					.from(uptimeStatusPage)
					.where(
						and(
							eq(uptimeStatusPage.statusPageId, input.statusPageId),
							eq(uptimeStatusPage.userId, ctx.user.id),
						),
					)
					.limit(1)
					.for("update");
				if (!page) {
					throw notFound(ctx.t, "statusPage");
				}

				if (ids.length > 0) {
					const owned = await tx
						.select({ uptimeMonitorId: uptimeMonitor.uptimeMonitorId })
						.from(uptimeMonitor)
						.where(
							and(
								inArray(uptimeMonitor.uptimeMonitorId, ids),
								eq(uptimeMonitor.userId, ctx.user.id),
							),
						)
						.for("update");
					if (owned.length !== ids.length) {
						throw notFound(ctx.t, "monitor");
					}
				}

				// Wholesale replace: clear then re-link in the submitted order. The
				// delete itself is also constrained through the owned parent row.
				await tx
					.delete(uptimeStatusPageMonitor)
					.where(
						inArray(
							uptimeStatusPageMonitor.statusPageId,
							tx
								.select({ statusPageId: uptimeStatusPage.statusPageId })
								.from(uptimeStatusPage)
								.where(
									and(
										eq(
											uptimeStatusPage.statusPageId,
											page.statusPageId,
										),
										eq(uptimeStatusPage.userId, ctx.user.id),
									),
								),
						),
					);
				if (ids.length > 0) {
					await tx.insert(uptimeStatusPageMonitor).values(
						ids.map((uptimeMonitorId, i) => ({
							statusPageId: page.statusPageId,
							uptimeMonitorId,
							sortOrder: i,
						})),
					);
				}
				return { success: true, count: ids.length };
			});
		}),

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
				.returning({ statusPageId: uptimeStatusPage.statusPageId });
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
function toPublicMonitorStatus(m: UptimeMonitorRow) {
	return {
		name: m.name,
		status: m.status,
		uptimePercentage: m.uptimePercentage,
		responseTime: m.responseTime,
		lastCheckedAt: m.lastCheckedAt,
	};
}

/**
 * Build the sanitized public aggregate (safe monitors + overall status +
 * last-7-day incidents) from a set of the owner's monitor rows. Shared by every
 * public entry point so the three surfaces are byte-identical.
 */
async function buildPublicStatusAggregate(monitors: UptimeMonitorRow[]) {
	const hasDown = monitors.some((m) => m.status === "down");
	const hasDegraded = monitors.some((m) => m.status === "degraded");
	const overallStatus = hasDown
		? "outage"
		: hasDegraded
			? "degraded"
			: "operational";

	const sevenDaysAgo = new Date(
		Date.now() - 7 * 24 * 60 * 60 * 1000,
	).toISOString();
	const monitorIds = monitors.map((m) => m.uptimeMonitorId);

	let recentIncidents: Array<{
		monitorName: string;
		status: string;
		startedAt: string;
		resolvedAt: string | null;
		durationSeconds: number | null;
	}> = [];

	if (monitorIds.length > 0) {
		const incidents = await db
			.select()
			.from(uptimeIncident)
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
		monitors: monitors.map(toPublicMonitorStatus),
		overallStatus,
		recentIncidents,
	};
}

/** Wrap an aggregate with the page's display metadata (nullable for the legacy
 * per-user surface when the user has no default page). */
function toPublicStatusPageView(
	page: UptimeStatusPageRow | null,
	aggregate: Awaited<ReturnType<typeof buildPublicStatusAggregate>>,
) {
	return {
		title: page?.title ?? null,
		description: page?.description ?? null,
		logoUrl: page?.logoUrl ?? null,
		...aggregate,
	};
}

/**
 * The active monitors linked to a page, in the page's sort order, re-queried
 * under the page owner's id — so a monitor the owner deleted or deactivated
 * silently drops out at resolve time.
 */
async function resolveStatusPageMonitors(
	page: UptimeStatusPageRow,
): Promise<UptimeMonitorRow[]> {
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
	return links
		.map((l) => byId.get(l.uptimeMonitorId))
		.filter((m): m is UptimeMonitorRow => m !== undefined);
}

const publicRouter = router({
	// Legacy per-user URL (`/status/:userId`). Delegates to the user's `default`
	// page (created by the migration backfill) only while it is published.
	// Missing and unpublished defaults both return an empty aggregate so old
	// links never 404 and cannot reveal private page metadata or monitor state.
	status: publicProcedure
		.input(z.object({ userId: z.string() }))
		.query(async ({ input }) => {
			const page = await db.query.uptimeStatusPage.findFirst({
				where: and(
					eq(uptimeStatusPage.userId, input.userId),
					eq(uptimeStatusPage.slug, "default"),
					eq(uptimeStatusPage.isPublished, true),
				),
			});
			const monitors = page ? await resolveStatusPageMonitors(page) : [];
			return toPublicStatusPageView(page ?? null, await buildPublicStatusAggregate(monitors));
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
				where: eq(uptimeStatusPage.customDomain, input.host),
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
			const monitors = await findSharedMonitors(link);

			const owner = await db.query.user.findFirst({
				where: eq(user.id, link.userId),
				columns: { name: true },
			});

			return {
				/* v8 ignore next -- defensive: the user FK cascade deletes the link with its owner */
				sharedBy: owner?.name ?? null,
				expiresAt: link.expiresAt,
				monitors: monitors.map(toSharedMonitorConfig),
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
			await findOwnedEmailProviderOrThrow(
				input.emailProviderId,
				ctx.user.id,
				ctx.t,
			);

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

			const [created] = await db
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
