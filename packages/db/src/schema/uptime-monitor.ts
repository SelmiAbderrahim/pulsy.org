import { DEFAULT_FAILURE_THRESHOLD } from "./monitor-defaults";
import { relations, sql } from "drizzle-orm";
import type { CapturedReliabilityObservation } from "./validation-reliability";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	real,
	text,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { user } from "./auth";
import type { HttpAssertion } from "./validation-http";
import type { LatencyPolicy } from "./validation-latency";
import type { NetworkConfiguration } from "./validation-network";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const uptimeMonitorMethodEnum = pgEnum("uptimeMonitorMethod", [
	"GET",
	"HEAD",
	"POST",
]);

export const uptimeMonitorStatusEnum = pgEnum("uptimeMonitorStatus", [
	"up",
	"down",
	"degraded",
	"pending",
]);

export const uptimeCheckStatusEnum = pgEnum("uptimeCheckStatus", [
	"up",
	"down",
	"degraded",
]);

export const uptimeIncidentStatusEnum = pgEnum("uptimeIncidentStatus", [
	"ongoing",
	"resolved",
]);

export const uptimeEmailProviderTypeEnum = pgEnum("uptimeEmailProviderType", [
	"resend",
	"sendgrid",
	"smtp",
]);

export const uptimeNotificationChannelTypeEnum = pgEnum(
	"uptimeNotificationChannelType",
	["email", "webhook", "slack", "discord", "telegram"],
);

export const uptimeNotificationEventEnum = pgEnum("uptimeNotificationEvent", [
	"down",
	"degraded",
	"recovery",
	"tls_expiry",
]);

export const uptimeNotificationOutcomeEnum = pgEnum(
	"uptimeNotificationOutcome",
	["sent", "failed"],
);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Main uptime monitor entity — tracks a URL to monitor. Scoped to its owner.
 */
export const uptimeMonitor = pgTable(
	"uptime_monitor",
	{
		uptimeMonitorId: text("uptimeMonitorId")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		name: text("name").notNull(),
		externalKey: text("externalKey"),
		monitorType: text("monitorType").$type<"http" | "heartbeat" | "dns" | "tcp" | "server">().notNull().default("http"),
    networkConfig: jsonb("networkConfig").$type<NetworkConfiguration>(),
		url: text("url").notNull(),
		method: uptimeMonitorMethodEnum("method").notNull().default("GET"),
		expectedStatus: integer("expectedStatus").notNull().default(200),
    expectedStatuses: text("expectedStatuses"),
    tlsMonitoringEnabled: boolean("tlsMonitoringEnabled").notNull().default(true),
		// Advanced requests are encrypted as one payload; never project this field.
		requestCipher: text("requestCipher"),
		redirectPolicy: text("redirectPolicy").notNull().default("follow"),
		httpAssertions: jsonb("httpAssertions").$type<HttpAssertion[]>().notNull().default([]),
    latencyPolicy: jsonb("latencyPolicy").$type<LatencyPolicy>(),
    consecutiveSlow: integer("consecutiveSlow").notNull().default(0),
    consecutiveHealthy: integer("consecutiveHealthy").notNull().default(0),
    lastOperationalAlertAt: text("lastOperationalAlertAt"),
    lastOperationalAlertId: text("lastOperationalAlertId"),
		timeout: integer("timeout").notNull().default(10000), // ms
		interval: integer("interval").notNull().default(300), // seconds: 60/300/600/1800/3600
		active: boolean("active").notNull().default(true),

		// Current state
		status: uptimeMonitorStatusEnum("status").notNull().default("pending"),
		// Durable notification identity; not a FK to retention-managed history.
		notificationOutageId: text("notificationOutageId"),
		httpStatus: integer("httpStatus"),
		responseTime: integer("responseTime"), // ms
		lastCheckedAt: text("lastCheckedAt"),
		nextCheckAt: text("nextCheckAt"),

		// TLS monitoring
		tlsExpiresAt: text("tlsExpiresAt"),
		tlsExpiresInDays: integer("tlsExpiresInDays"),

		// Failure tracking
		consecutiveFailures: integer("consecutiveFailures").notNull().default(0),
		failureThreshold: integer("failureThreshold").notNull().default(DEFAULT_FAILURE_THRESHOLD), // 1-10

		// Computed stats
		uptimePercentage: real("uptimePercentage"), // 30-day computed

		// Tags for grouping/filtering
		tags: text("tags").array().default([]),

		// Public status page
		isPublic: boolean("isPublic").notNull().default(false),
		statusPageTitle: text("statusPageTitle"),
		statusPageDescription: text("statusPageDescription"),

		// Ownership (single-user: scoped to the owning user)
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		createdAt: text("createdAt")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => [
		// Every list/detail/dashboard query filters by the owning user.
		index("uptime_monitor_user_idx").on(table.userId),
		uniqueIndex("uptime_monitor_owner_external_key_idx").on(table.userId, table.externalKey),
		// initializeAllMonitors() loads all active monitors on startup.
		index("uptime_monitor_active_idx").on(table.active),
	],
);

/**
 * Status change audit trail — records every up/down/degraded transition
 */
export const uptimeStatusChange = pgTable(
	"uptime_status_change",
	{
		statusChangeId: text("statusChangeId")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		uptimeMonitorId: text("uptimeMonitorId")
			.notNull()
			.references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
		statusBefore: uptimeMonitorStatusEnum("statusBefore").notNull(),
		statusAfter: uptimeMonitorStatusEnum("statusAfter").notNull(),
		httpStatus: integer("httpStatus"),
		responseTime: integer("responseTime"),
		reason: text("reason"),
		createdAt: text("createdAt")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => [
		// History queries list a monitor's changes newest-first.
		index("uptime_status_change_monitor_created_idx").on(
			table.uptimeMonitorId,
			table.createdAt,
		),
		// Retention cleanup deletes by createdAt across all monitors.
		index("uptime_status_change_created_idx").on(table.createdAt),
	],
);

/**
 * Individual check log — granular history for charts
 */
/** Exact sample counts for complete UTC days; maintained transactionally by
 * check-log triggers, including imports, retention and deletions. */
export const uptimeCheckDay = pgTable("uptime_check_day", {
  monitorId: text("monitorId").notNull().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
  day: text("day").notNull(),
  status: text("status").notNull(),
  checks: integer("checks").notNull(),
}, table => ({ key: uniqueIndex("uptime_check_day_key").on(table.monitorId, table.day, table.status) }));

export const uptimeCheckLog = pgTable(
	"uptime_check_log",
	{
		checkLogId: text("checkLogId")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		uptimeMonitorId: text("uptimeMonitorId")
			.notNull()
			.references(() => uptimeMonitor.uptimeMonitorId, {
				onDelete: "cascade",
			}),
		httpStatus: integer("httpStatus"),
		responseTime: integer("responseTime"),
		status: uptimeCheckStatusEnum("status").notNull(),
		errorMessage: text("errorMessage"),
		assertionOutcomes: jsonb("assertionOutcomes").$type<Array<{ index: number; passed: boolean; reason: string }>>(),
		observation: jsonb("observation").$type<CapturedReliabilityObservation>(),
		observationEndedAt: text("observationEndedAt"),
		createdAt: text("createdAt")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => [
		index("uptime_check_log_monitor_created_idx").on(
			table.uptimeMonitorId,
			table.createdAt,
		),
		// Covers rolling status counts without visiting diagnostic/history rows.
		index("uptime_check_log_monitor_created_status_idx").on(table.uptimeMonitorId, table.createdAt, table.status),
		// Retention cleanup deletes by createdAt across all monitors.
		index("uptime_check_log_created_idx").on(table.createdAt),
	],
);

/**
 * User-managed email provider credentials
 */
export const uptimeEmailProvider = pgTable("uptime_email_provider", {
	emailProviderId: text("emailProviderId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull(),
	providerType: uptimeEmailProviderTypeEnum("providerType").notNull(),

	// API-based providers (Resend, SendGrid)
	apiKey: text("apiKey"), // encrypted

	// SMTP provider
	smtpHost: text("smtpHost"),
	smtpPort: integer("smtpPort"),
	smtpUsername: text("smtpUsername"),
	smtpPassword: text("smtpPassword"), // encrypted
	smtpSecure: boolean("smtpSecure").default(true),

	fromAddress: text("fromAddress").notNull(),
	verified: boolean("verified").notNull().default(false),

	// Ownership (single-user: scoped to the owning user)
	userId: text("userId")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),

	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

/**
 * Notification channel — routes alerts to email/webhook/slack/discord/telegram.
 * Either bound to one monitor (`uptimeMonitorId` set) or an account-level
 * default (`uptimeMonitorId IS NULL`) that applies to all the user's monitors.
 */
export const uptimeNotificationChannel = pgTable(
	"uptime_notification_channel",
	{
		channelId: text("channelId")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		// NULL ⇒ account-level default channel: applies to all of the user's
		// monitors (current and future) unless a monitor channel claims the
		// same target first.
		uptimeMonitorId: text("uptimeMonitorId").references(
			() => uptimeMonitor.uptimeMonitorId,
			{ onDelete: "cascade" },
		),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		channelType: uptimeNotificationChannelTypeEnum("channelType").notNull(),

		// Email channel
		emailProviderId: text("emailProviderId").references(
			() => uptimeEmailProvider.emailProviderId,
			{ onDelete: "set null" },
		),
		recipientAddresses: text("recipientAddresses").array(),

		// Webhook / Slack / Discord / Telegram
		// The URL/target and each custom-header value are AES-256-GCM ciphertext
		// when secretVersion is 1. Version 0 identifies legacy plaintext rows so
		// the server can migrate them atomically before accepting traffic.
		webhookUrl: text("webhookUrl"),
		webhookHeaders: jsonb("webhookHeaders").$type<Record<string, string>>(),
		secretVersion: integer("secretVersion").notNull().default(0),
		// Encrypted with the OSS per-field AES-GCM scheme; never expose ciphertext.
		signingSecretCipher: text("signingSecretCipher"),

		// What events to notify
		notifyOnDown: boolean("notifyOnDown").notNull().default(true),
		notifyOnDegraded: boolean("notifyOnDegraded").notNull().default(false),
		notifyOnRecovery: boolean("notifyOnRecovery").notNull().default(true),
		notifyOnTlsExpiry: boolean("notifyOnTlsExpiry").notNull().default(false),
		tlsExpiryThresholdDays: integer("tlsExpiryThresholdDays")
			.notNull()
			.default(14),

		createdAt: text("createdAt")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => [
		// Channels are loaded by monitor on every status change to dispatch alerts.
		index("uptime_notification_channel_monitor_idx").on(
			table.uptimeMonitorId,
		),
		// Account-level default channels are loaded by owner on every dispatch.
		index("uptime_notification_channel_user_idx").on(table.userId),
	],
);

/**
 * Notification delivery audit log — one row per channel-target dispatch,
 * written with the FINAL outcome after in-process retries. Audit record only,
 * never a work queue: there is no "pending" state and no replayer.
 */
export const uptimeNotificationLog = pgTable(
	"uptime_notification_log",
	{
		notificationLogId: text("notificationLogId")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		uptimeMonitorId: text("uptimeMonitorId")
			.notNull()
			.references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
		// The channel may be deleted after the send; the audit row survives.
		channelId: text("channelId").references(
			() => uptimeNotificationChannel.channelId,
			{ onDelete: "set null" },
		),
		channelType: uptimeNotificationChannelTypeEnum("channelType").notNull(),
		// email: full recipient address (user-owned data, rows are user-scoped);
		// webhook/slack/discord: URL host ONLY (tokens live in the path);
		// telegram: a generic "telegram" label (never the bot token or chat id).
		target: text("target").notNull(),
		event: uptimeNotificationEventEnum("event").notNull(),
		// Informational link to the transition that triggered this send. NULL for
		// tls_expiry (synthetic change, no row). Intentionally NOT a foreign key:
		// it is an audit string, and retention prunes status changes and logs
		// independently — a dangling id is harmless and never joined on.
		statusChangeId: text("statusChangeId"),
		outcome: uptimeNotificationOutcomeEnum("outcome").notNull(),
		attempts: integer("attempts").notNull().default(1),
		providerMessageId: text("providerMessageId"),
		error: text("error"), // truncated to 500 chars at write time
		createdAt: text("createdAt")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => [
		// Global "Notification history" lists a user's rows newest-first.
		index("uptime_notification_log_user_created_idx").on(
			table.userId,
			table.createdAt,
		),
		// Monitor-detail delivery history.
		index("uptime_notification_log_monitor_created_idx").on(
			table.uptimeMonitorId,
			table.createdAt,
		),
		// Retention cleanup deletes by createdAt across all users.
		index("uptime_notification_log_created_idx").on(table.createdAt),
	],
);

/**
 * Grouped downtime incident — spans from first failure to recovery
 */
export const uptimeIncident = pgTable(
	"uptime_incident",
	{
		incidentId: text("incidentId")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		uptimeMonitorId: text("uptimeMonitorId")
			.notNull()
			.references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
		status: uptimeIncidentStatusEnum("status").notNull().default("ongoing"),
		startedAt: text("startedAt")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
		resolvedAt: text("resolvedAt"),
		durationSeconds: integer("durationSeconds"),
		cause: text("cause"),
		severity: text("severity").$type<"critical" | "warning" | "informational">(),
		// Heartbeat timeline: when the missed ping was due. `startedAt` is the grace
		// end (the instant the monitor is declared Down); null for probe incidents.
		expectedAt: text("expectedAt"),
		// First successful outage alert delivery for this incident.
		notifiedAt: text("notifiedAt"),
	},
	(table) => [
		// getOngoingIncident / incident lists filter by monitor + status.
		index("uptime_incident_monitor_status_idx").on(
			table.uptimeMonitorId,
			table.status,
		),
		// Retention cleanup filters resolved incidents by startedAt.
		index("uptime_incident_started_idx").on(table.startedAt),
		// At most one ongoing incident per monitor, enforced by the database so a
		// writer that forgets the monitor row lock still cannot open a duplicate.
		uniqueIndex("uptime_incident_one_ongoing_idx")
			.on(table.uptimeMonitorId)
			.where(sql`${table.status} = 'ongoing'`),
	],
);

/**
 * Share link — lets a user hand a set of monitor configurations to anyone via
 * an expiring token URL. Recipients clone the configs into their own account;
 * nothing else (channels, providers, history) ever crosses accounts.
 */
export const uptimeShareLink = pgTable(
	"uptime_share_link",
	{
		shareLinkId: text("shareLinkId")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		// Cryptographically random (crypto.randomBytes), generated by the server.
		token: text("token").notNull().unique(),
		// Snapshot of the shared monitor IDs; monitors deleted after sharing
		// silently drop out at resolve time.
		monitorIds: text("monitorIds").array().notNull(),
		expiresAt: text("expiresAt").notNull(),
		// Owner opt-in: the public resolve returns the sharer's display name
		// only when true; otherwise recipients see a generic "A Pulsy user".
		showSharerName: boolean("showSharerName").notNull().default(false),

		// Ownership (single-user: scoped to the owning user)
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		createdAt: text("createdAt")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => [
		// Management UI lists a user's own share links.
		index("uptime_share_link_user_idx").on(table.userId),
	],
);

/**
 * SLA report subscription — opt-in to receive a monthly SLA / uptime PDF report
 * by email on the 1st of each month. Either bound to one monitor
 * (`uptimeMonitorId` set) or account-wide (`uptimeMonitorId IS NULL`, covering
 * all of the user's monitors). Tier-gated (Team plan / OSS-free).
 */
export const uptimeSlaReportSubscription = pgTable(
	"uptime_sla_report_subscription",
	{
		slaReportSubscriptionId: text("slaReportSubscriptionId")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		// NULL ⇒ account-wide: the monthly job builds a report for every monitor
		// the user owns. Set ⇒ that single monitor only.
		uptimeMonitorId: text("uptimeMonitorId").references(
			() => uptimeMonitor.uptimeMonitorId,
			{ onDelete: "cascade" },
		),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		recipientAddresses: text("recipientAddresses").array().notNull(),
		// Provider used to send the monthly email; if the provider is deleted the
		// subscription survives (NULL) and is skipped until re-pointed.
		emailProviderId: text("emailProviderId").references(
			() => uptimeEmailProvider.emailProviderId,
			{ onDelete: "set null" },
		),
		active: boolean("active").notNull().default(true),
		lastSentAt: text("lastSentAt"),
		createdAt: text("createdAt")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => [
		// Management UI lists a user's own subscriptions.
		index("uptime_sla_report_subscription_user_idx").on(table.userId),
		// The monthly job loads every active subscription across all users.
		index("uptime_sla_report_subscription_active_idx").on(table.active),
	],
);

/**
 * Status page — a named, publishable public page that aggregates a chosen set
 * of the owner's monitors. Reachable on the app host at
 * `/status/:userId/:slug` (the `slug='default'` page also backs the legacy
 * `/status/:userId` URL) and, once a custom domain is DNS-verified, at the root
 * of that domain. Scoped to its owning user.
 */
export const uptimeStatusPage = pgTable(
	"uptime_status_page",
	{
		statusPageId: text("statusPageId")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// Public path segment, unique per user: `/status/:userId/:slug`.
		slug: text("slug").notNull(),
		title: text("title").notNull(),
		description: text("description"),
		logoUrl: text("logoUrl"),
		// Only published pages resolve publicly; unpublished ⇒ NOT_FOUND.
		isPublished: boolean("isPublished").notNull().default(false),
		historyEnabled: boolean("historyEnabled").notNull().default(false),
		// Optional custom domain (one per page). Unique platform-wide when set.
		customDomain: text("customDomain"),
		domainVerified: boolean("domainVerified").notNull().default(false),
		// TXT challenge value placed at `_pulsy-verify.<customDomain>`.
		// Cryptographically random (crypto.randomBytes), generated server-side.
		domainVerifyToken: text("domainVerifyToken"),
		domainVerifiedAt: text("domainVerifiedAt"),
		// Edge-provisioning lifecycle for a verified custom domain, written by the
		// host-side nginx+certbot reconciliation daemon (ops/custom-domains). The
		// app never touches nginx/ACME itself. Null until a domain is verified.
		//   pending → awaiting (or retrying) vhost + Let's Encrypt cert issuance
		//   active  → vhost live and TLS cert issued; domain serves over HTTPS
		//   failed  → see domainProvisionError (e.g. DNS not pointed at the server)
		domainProvisionStatus: text("domainProvisionStatus"),
		domainProvisionError: text("domainProvisionError"),
		domainProvisionedAt: text("domainProvisionedAt"),
		createdAt: text("createdAt")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => [
		// Public resolve by (userId, slug); also enforces per-user slug uniqueness.
		uniqueIndex("uptime_status_page_user_slug_idx").on(
			table.userId,
			table.slug,
		),
		// Public resolve by Host. A custom domain is served by one page platform-wide,
		// but only a DNS-verified claim is exclusive: an unverified claim proves
		// nothing, so it must not be able to block the real owner of the domain.
		uniqueIndex("uptime_status_page_custom_domain_idx")
			.on(table.customDomain)
			.where(sql`${table.customDomain} IS NOT NULL AND ${table.domainVerified} = true`),
		// Management UI lists a user's own pages.
		index("uptime_status_page_user_idx").on(table.userId),
	],
);

/**
 * Join row linking a monitor to a status page (many-to-many). Page membership —
 * not the monitor's own (deprecated) `isPublic` flag — determines what a page
 * renders.
 */
export const uptimeStatusPageMonitor = pgTable(
	"uptime_status_page_monitor",
	{
		id: text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		statusPageId: text("statusPageId")
			.notNull()
			.references(() => uptimeStatusPage.statusPageId, {
				onDelete: "cascade",
			}),
		uptimeMonitorId: text("uptimeMonitorId")
			.notNull()
			.references(() => uptimeMonitor.uptimeMonitorId, {
				onDelete: "cascade",
			}),
		sortOrder: integer("sortOrder").notNull().default(0),
		publicName: text("publicName"),
		publicDescription: text("publicDescription"),
		publicGroup: text("publicGroup"),
	},
	(table) => [
		// A monitor appears at most once per page; also the page-membership lookup.
		uniqueIndex("uptime_status_page_monitor_unique_idx").on(
			table.statusPageId,
			table.uptimeMonitorId,
		),
		// Resolve a page's monitors.
		index("uptime_status_page_monitor_page_idx").on(table.statusPageId),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const uptimeMonitorRelations = relations(uptimeMonitor, ({ many }) => ({
	statusChanges: many(uptimeStatusChange),
	checkLogs: many(uptimeCheckLog),
	notificationChannels: many(uptimeNotificationChannel),
	incidents: many(uptimeIncident),
	notificationLogs: many(uptimeNotificationLog),
}));

export const uptimeNotificationLogRelations = relations(
	uptimeNotificationLog,
	({ one }) => ({
		monitor: one(uptimeMonitor, {
			fields: [uptimeNotificationLog.uptimeMonitorId],
			references: [uptimeMonitor.uptimeMonitorId],
		}),
	}),
);

export const uptimeStatusChangeRelations = relations(
	uptimeStatusChange,
	({ one }) => ({
		monitor: one(uptimeMonitor, {
			fields: [uptimeStatusChange.uptimeMonitorId],
			references: [uptimeMonitor.uptimeMonitorId],
		}),
	}),
);

export const uptimeCheckLogRelations = relations(uptimeCheckLog, ({ one }) => ({
	monitor: one(uptimeMonitor, {
		fields: [uptimeCheckLog.uptimeMonitorId],
		references: [uptimeMonitor.uptimeMonitorId],
	}),
}));

export const uptimeEmailProviderRelations = relations(
	uptimeEmailProvider,
	({ many }) => ({
		channels: many(uptimeNotificationChannel),
	}),
);

export const uptimeNotificationChannelRelations = relations(
	uptimeNotificationChannel,
	({ one }) => ({
		monitor: one(uptimeMonitor, {
			fields: [uptimeNotificationChannel.uptimeMonitorId],
			references: [uptimeMonitor.uptimeMonitorId],
		}),
		emailProvider: one(uptimeEmailProvider, {
			fields: [uptimeNotificationChannel.emailProviderId],
			references: [uptimeEmailProvider.emailProviderId],
		}),
	}),
);

export const uptimeIncidentRelations = relations(uptimeIncident, ({ one }) => ({
	monitor: one(uptimeMonitor, {
		fields: [uptimeIncident.uptimeMonitorId],
		references: [uptimeMonitor.uptimeMonitorId],
	}),
}));

export const uptimeSlaReportSubscriptionRelations = relations(
	uptimeSlaReportSubscription,
	({ one }) => ({
		monitor: one(uptimeMonitor, {
			fields: [uptimeSlaReportSubscription.uptimeMonitorId],
			references: [uptimeMonitor.uptimeMonitorId],
		}),
		emailProvider: one(uptimeEmailProvider, {
			fields: [uptimeSlaReportSubscription.emailProviderId],
			references: [uptimeEmailProvider.emailProviderId],
		}),
	}),
);

export const uptimeStatusPageRelations = relations(
	uptimeStatusPage,
	({ many }) => ({
		monitors: many(uptimeStatusPageMonitor),
	}),
);

export const uptimeStatusPageMonitorRelations = relations(
	uptimeStatusPageMonitor,
	({ one }) => ({
		statusPage: one(uptimeStatusPage, {
			fields: [uptimeStatusPageMonitor.statusPageId],
			references: [uptimeStatusPage.statusPageId],
		}),
		monitor: one(uptimeMonitor, {
			fields: [uptimeStatusPageMonitor.uptimeMonitorId],
			references: [uptimeMonitor.uptimeMonitorId],
		}),
	}),
);
