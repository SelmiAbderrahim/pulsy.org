import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { beforeEach } from "vitest";
import { createHash } from "node:crypto";
import {
	apiKey,
	db,
	user,
	uptimeEmailProvider,
	uptimeMonitor,
	uptimeNotificationChannel,
	uptimeShareLink,
	uptimeSlaReportSubscription,
	uptimeStatusPage,
	uptimeStatusPageMonitor,
} from "@pulsy/db";

// ---------------------------------------------------------------------------
// DB-backed test helpers. DATABASE_URL is provisioned by global-setup.ts, so a
// static `@pulsy/db` import here is safe (the worker imports this after env is
// set). Pure-unit test files simply don't import this module and never touch a
// database.
// ---------------------------------------------------------------------------

export { db };

// Every table the suite writes to, in an order safe for TRUNCATE ... CASCADE.
const ALL_TABLES = [
	"uptime_heartbeat_run",
	"uptime_heartbeat",
	"uptime_deferred_alert",
	"uptime_maintenance",
	"uptime_incident_event",
	"uptime_incident_escalation",
	"uptime_incident_response",
	"uptime_incident_group",
	"uptime_reliability_annotation",
	"uptime_reliability_cursor",
	"uptime_reliability_day",
	"uptime_reliability_policy",
	"uptime_server_metric",
	"uptime_server",
	"uptime_status_mail_job",
	"uptime_status_mail_gate",
	"uptime_status_subscriber",
	"uptime_status_subscription_config",
	"uptime_status_announcement",
	"uptime_monitor_view",
	"uptime_monitor_template",
	"uptime_monitor_channel_binding",
	"uptime_check_day",

	"uptime_notification_log",
	"uptime_status_change",
	"uptime_check_log",
	"uptime_notification_channel",
	"uptime_sla_report_subscription",
	"uptime_status_page_monitor",
	"uptime_status_page",
	"uptime_incident",
	"uptime_email_provider",
	"uptime_share_link",
	"uptime_monitor",
	"api_key",
	"organization_member",
	"organization",
	"session",
	"account",
	"verification",
	"user",
];

/** Wipe all rows so each test starts from a clean, isolated state. */
export async function resetDb(): Promise<void> {
	await db.execute(
		sql.raw(
			`TRUNCATE TABLE ${ALL_TABLES.map((t) => `"${t}"`).join(
				", ",
			)} RESTART IDENTITY CASCADE`,
		),
	);
}

/**
 * Register a `beforeEach` truncation for the calling test file. DB-backed
 * suites call this once at top level for isolation.
 */
export function useCleanDatabase(): void {
	beforeEach(resetDb);
}

// ---------------------------------------------------------------------------
// Factories — minimal, deterministic rows. Pass overrides to vary a field.
// ---------------------------------------------------------------------------

export async function createTestUser(
	overrides: Partial<typeof user.$inferInsert> = {},
): Promise<typeof user.$inferSelect> {
	const id = overrides.id ?? `user_${nanoid()}`;
	const [row] = await db
		.insert(user)
		.values({
			id,
			name: overrides.name ?? "Test User",
			email: overrides.email ?? `${id}@pulsy.test`,
			emailVerified: overrides.emailVerified ?? true,
			...overrides,
		})
		.returning();
	if (!row) throw new Error("createTestUser failed");
	return row;
}

export async function createTestMonitor(
	userId: string,
	overrides: Partial<typeof uptimeMonitor.$inferInsert> = {},
): Promise<typeof uptimeMonitor.$inferSelect> {
	const [row] = await db
		.insert(uptimeMonitor)
		.values({
			name: overrides.name ?? "Test Monitor",
			url: overrides.url ?? "https://example.com",
			method: overrides.method ?? "GET",
			expectedStatus: overrides.expectedStatus ?? 200,
			timeout: overrides.timeout ?? 10_000,
			interval: overrides.interval ?? 300,
			failureThreshold: overrides.failureThreshold ?? 3,
			active: overrides.active ?? true,
			userId,
			...overrides,
		})
		.returning();
	if (!row) throw new Error("createTestMonitor failed");
	return row;
}

export async function createTestEmailProvider(
	userId: string,
	overrides: Partial<typeof uptimeEmailProvider.$inferInsert> = {},
): Promise<typeof uptimeEmailProvider.$inferSelect> {
	const [row] = await db
		.insert(uptimeEmailProvider)
		.values({
			name: overrides.name ?? "Test Provider",
			providerType: overrides.providerType ?? "resend",
			fromAddress: overrides.fromAddress ?? "alerts@pulsy.test",
			userId,
			...overrides,
		})
		.returning();
	if (!row) throw new Error("createTestEmailProvider failed");
	return row;
}

export async function createTestChannel(
	uptimeMonitorId: string,
	overrides: Partial<typeof uptimeNotificationChannel.$inferInsert> = {},
): Promise<typeof uptimeNotificationChannel.$inferSelect> {
	// Channels are user-scoped: resolve the owner from the parent monitor
	// unless the caller pins one explicitly.
	const userId =
		overrides.userId ??
		(
			await db.query.uptimeMonitor.findFirst({
				where: (m, { eq }) => eq(m.uptimeMonitorId, uptimeMonitorId),
			})
		)?.userId;
	if (!userId) throw new Error("createTestChannel: monitor not found");

	const [row] = await db
		.insert(uptimeNotificationChannel)
		.values({
			uptimeMonitorId,
			channelType: overrides.channelType ?? "webhook",
			webhookUrl: overrides.webhookUrl ?? "https://hooks.test.invalid/in",
			...overrides,
			userId,
		})
		.returning();
	if (!row) throw new Error("createTestChannel failed");
	return row;
}

/** Account-level default channel — applies to all the user's monitors. */
export async function createTestDefaultChannel(
	userId: string,
	overrides: Partial<typeof uptimeNotificationChannel.$inferInsert> = {},
): Promise<typeof uptimeNotificationChannel.$inferSelect> {
	const [row] = await db
		.insert(uptimeNotificationChannel)
		.values({
			uptimeMonitorId: null,
			channelType: overrides.channelType ?? "webhook",
			webhookUrl: overrides.webhookUrl ?? "https://hooks.test.invalid/in",
			...overrides,
			userId,
		})
		.returning();
	if (!row) throw new Error("createTestDefaultChannel failed");
	return row;
}

/** Share link — defaults to a 30-day expiry and a unique high-entropy token. */
export async function createTestShareLink(
	userId: string,
	monitorIds: string[],
	overrides: Partial<typeof uptimeShareLink.$inferInsert> = {},
): Promise<typeof uptimeShareLink.$inferSelect> {
	const [row] = await db
		.insert(uptimeShareLink)
		.values({
			token: overrides.token ?? `tok_${nanoid()}_${nanoid()}`,
			monitorIds,
			expiresAt:
				overrides.expiresAt ??
				new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
			...overrides,
			userId,
		})
		.returning();
	if (!row) throw new Error("createTestShareLink failed");
	return row;
}

/**
 * SLA-report subscription. Defaults to account-wide (`uptimeMonitorId: null`)
 * with a single recipient and no linked provider unless overridden.
 */
export async function createTestSlaReportSubscription(
	userId: string,
	overrides: Partial<typeof uptimeSlaReportSubscription.$inferInsert> = {},
): Promise<typeof uptimeSlaReportSubscription.$inferSelect> {
	const [row] = await db
		.insert(uptimeSlaReportSubscription)
		.values({
			uptimeMonitorId: overrides.uptimeMonitorId ?? null,
			recipientAddresses: overrides.recipientAddresses ?? ["ops@pulsy.test"],
			emailProviderId: overrides.emailProviderId ?? null,
			active: overrides.active ?? true,
			...overrides,
			userId,
		})
		.returning();
	if (!row) throw new Error("createTestSlaReportSubscription failed");
	return row;
}

/** Status page — defaults to a published page with a unique slug. */
export async function createTestStatusPage(
	userId: string,
	overrides: Partial<typeof uptimeStatusPage.$inferInsert> = {},
): Promise<typeof uptimeStatusPage.$inferSelect> {
	const [row] = await db
		.insert(uptimeStatusPage)
		.values({
			slug: overrides.slug ?? `page-${nanoid()}`,
			title: overrides.title ?? "Test Status Page",
			isPublished: overrides.isPublished ?? true,
			...overrides,
			userId,
		})
		.returning();
	if (!row) throw new Error("createTestStatusPage failed");
	return row;
}

/** Link a monitor to a status page. */
export async function createTestStatusPageMonitor(
	statusPageId: string,
	uptimeMonitorId: string,
	overrides: Partial<typeof uptimeStatusPageMonitor.$inferInsert> = {},
): Promise<typeof uptimeStatusPageMonitor.$inferSelect> {
	const [row] = await db
		.insert(uptimeStatusPageMonitor)
		.values({
			sortOrder: overrides.sortOrder ?? 0,
			...overrides,
			statusPageId,
			uptimeMonitorId,
		})
		.returning();
	if (!row) throw new Error("createTestStatusPageMonitor failed");
	return row;
}

/**
 * Insert an API key for `userId`. Returns the row plus the plaintext token so
 * tests can present it as a Bearer credential. Pass `{ plaintext }` to control
 * the token, or `{ revokedAt }` / `{ expiresAt }` to exercise rejection paths.
 */
export async function createTestApiKey(
	userId: string,
	overrides: Partial<typeof apiKey.$inferInsert> & { plaintext?: string } = {},
): Promise<{ row: typeof apiKey.$inferSelect; plaintext: string }> {
	const { plaintext: plaintextOverride, ...rest } = overrides;
	const plaintext = plaintextOverride ?? `pul_${nanoid()}${nanoid()}`;
	const hashedKey =
		rest.hashedKey ??
		createHash("sha256").update(plaintext, "utf8").digest("hex");
	const keyPrefix = rest.keyPrefix ?? plaintext.slice(0, 8);

	const [row] = await db
		.insert(apiKey)
		.values({
			name: rest.name ?? "Test Key",
			...rest,
			keyPrefix,
			hashedKey,
			userId,
		})
		.returning();
	if (!row) throw new Error("createTestApiKey failed");
	return { row, plaintext };
}

/** A platform superadmin (role pre-set). */
export async function createTestSuperadmin(
	overrides: Partial<typeof user.$inferInsert> = {},
): Promise<typeof user.$inferSelect> {
	return createTestUser({ role: "superadmin", ...overrides });
}
