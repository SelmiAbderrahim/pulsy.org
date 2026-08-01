import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod validation schemas for the uptime-monitor API surface.
//
// Kept separate from the Drizzle table declarations (uptime-monitor.ts) so this
// validation logic is unit-tested and coverage-gated, while the declarative
// schema/relation definitions are treated as configuration.
// ---------------------------------------------------------------------------

export const apiCreateUptimeMonitor = z.object({
	name: z.string().min(1).max(255),
	url: z.string().url(),
	method: z.enum(["GET", "HEAD", "POST"]).default("GET"),
	expectedStatus: z.number().int().min(100).max(599).default(200),
	timeout: z.number().int().min(1000).max(60000).default(10000),
	interval: z
		.number()
		.int()
		.refine((v) => [30, 60, 300, 600, 1800, 3600].includes(v), {
			message: "Interval must be 30, 60, 300, 600, 1800, or 3600 seconds",
		})
		.default(300),
	failureThreshold: z.number().int().min(1).max(10).default(3),
	active: z.boolean().default(true),
	tags: z.array(z.string().min(1).max(50)).max(10).default([]),
});

export const apiCreateUptimeMonitorsBulk = z.object({
	monitors: z.array(apiCreateUptimeMonitor).min(1).max(50),
});

export const apiUpdateUptimeMonitor = z.object({
	uptimeMonitorId: z.string(),
	name: z.string().min(1).max(255).optional(),
	url: z.string().url().optional(),
	method: z.enum(["GET", "HEAD", "POST"]).optional(),
	expectedStatus: z.number().int().min(100).max(599).optional(),
	timeout: z.number().int().min(1000).max(60000).optional(),
	interval: z
		.number()
		.int()
		.refine((v) => [30, 60, 300, 600, 1800, 3600].includes(v), {
			message: "Interval must be 30, 60, 300, 600, 1800, or 3600 seconds",
		})
		.optional(),
	failureThreshold: z.number().int().min(1).max(10).optional(),
	active: z.boolean().optional(),
	tags: z.array(z.string().min(1).max(50)).max(10).optional(),
	isPublic: z.boolean().optional(),
	statusPageTitle: z.string().max(255).nullable().optional(),
	statusPageDescription: z.string().max(1000).nullable().optional(),
});

// Subset of monitor config fields editable in a bulk update. Mirrors the
// constraints in `apiUpdateUptimeMonitor`; excludes per-monitor identity
// (name/url), the active flag (handled by toggleActive), and status-page fields.
const apiUptimeMonitorBulkPatch = z.object({
	method: z.enum(["GET", "HEAD", "POST"]).optional(),
	expectedStatus: z.number().int().min(100).max(599).optional(),
	timeout: z.number().int().min(1000).max(60000).optional(),
	interval: z
		.number()
		.int()
		.refine((v) => [30, 60, 300, 600, 1800, 3600].includes(v), {
			message: "Interval must be 30, 60, 300, 600, 1800, or 3600 seconds",
		})
		.optional(),
	failureThreshold: z.number().int().min(1).max(10).optional(),
	tags: z.array(z.string().min(1).max(50)).max(10).optional(),
});

export const apiUpdateUptimeMonitorsBulk = z.object({
	monitorIds: z.array(z.string()).min(1).max(50),
	patch: apiUptimeMonitorBulkPatch.refine((p) => Object.keys(p).length > 0, {
		message: "At least one field must be provided",
	}),
});

const apiEmailProviderCredentialShape = {
	name: z.string().min(1).max(255),
	providerType: z.enum(["resend", "sendgrid", "smtp"]),
	apiKey: z.string().min(1).optional(),
	smtpHost: z.string().min(1).optional(),
	smtpPort: z.number().int().min(1).max(65535).optional(),
	smtpUsername: z.string().min(1).optional(),
	smtpPassword: z.string().min(1).optional(),
	smtpSecure: z.boolean().default(true),
	fromAddress: z.string().email(),
} satisfies z.ZodRawShape;

function requireField(
	ctx: z.RefinementCtx,
	path: string,
	message: string,
): void {
	ctx.addIssue({
		// Zod 4: `z.ZodIssueCode` was removed — issue codes are string literals.
		code: "custom",
		path: [path],
		message,
	});
}

export const apiCreateUptimeEmailProvider = z
	.object(apiEmailProviderCredentialShape)
	.superRefine((value, ctx) => {
		if (
			(value.providerType === "resend" || value.providerType === "sendgrid") &&
			!value.apiKey
		) {
			requireField(ctx, "apiKey", "API key is required");
		}

		if (value.providerType === "smtp") {
			if (!value.smtpHost) requireField(ctx, "smtpHost", "SMTP host is required");
			if (!value.smtpPort) requireField(ctx, "smtpPort", "SMTP port is required");
			if (!value.smtpUsername) {
				requireField(ctx, "smtpUsername", "SMTP username is required");
			}
			if (!value.smtpPassword) {
				requireField(ctx, "smtpPassword", "SMTP password is required");
			}
		}
	});

export const apiUpdateUptimeEmailProvider = z.object({
	emailProviderId: z.string(),
	name: z.string().min(1).max(255).optional(),
	providerType: z.enum(["resend", "sendgrid", "smtp"]).optional(),
	apiKey: z.string().min(1).optional(),
	smtpHost: z.string().min(1).optional(),
	smtpPort: z.number().int().min(1).max(65535).optional(),
	smtpUsername: z.string().min(1).optional(),
	smtpPassword: z.string().min(1).optional(),
	smtpSecure: z.boolean().optional(),
	fromAddress: z.string().email().optional(),
});

function isTelegramTarget(value: string): boolean {
	if (value.startsWith("https://api.telegram.org/bot")) {
		/* v8 ignore next -- a value with this prefix always parses as a valid URL */
		return z.string().url().safeParse(value).success;
	}

	const parts = value.split(":");
	return parts.length >= 3 && parts.every((part) => part.length > 0);
}

function validateChannelTarget(
	value: {
		channelType?: "email" | "webhook" | "slack" | "discord" | "telegram";
		emailProviderId?: string | null;
		recipientAddresses?: string[];
		webhookUrl?: string | null;
	},
	ctx: z.RefinementCtx,
): void {
	switch (value.channelType) {
		case "email":
			if (!value.emailProviderId) {
				requireField(ctx, "emailProviderId", "Email provider is required");
			}
			if (!value.recipientAddresses?.length) {
				requireField(ctx, "recipientAddresses", "At least one recipient is required");
			}
			return;
		case "webhook":
		case "slack":
		case "discord":
			if (!value.webhookUrl) {
				requireField(ctx, "webhookUrl", "Webhook URL is required");
				return;
			}
			if (!z.string().url().safeParse(value.webhookUrl).success) {
				requireField(ctx, "webhookUrl", "Webhook URL must be a valid URL");
			}
			return;
		case "telegram":
			if (!value.webhookUrl) {
				requireField(ctx, "webhookUrl", "Telegram target is required");
				return;
			}
			if (!isTelegramTarget(value.webhookUrl)) {
				requireField(
					ctx,
					"webhookUrl",
					"Telegram target must be a Telegram API URL or BOT_TOKEN:CHAT_ID",
				);
			}
			return;
		/* v8 ignore next 2 -- unreachable: channelType is a validated enum before superRefine runs */
		default:
			return;
	}
}

const apiNotificationChannelConfigShape = {
	channelType: z.enum(["email", "webhook", "slack", "discord", "telegram"]),
	emailProviderId: z.string().optional(),
	recipientAddresses: z.array(z.string().email()).optional(),
	webhookUrl: z.string().min(1).optional(),
	webhookHeaders: z.record(z.string(), z.string()).nullable().optional(),
	notifyOnDown: z.boolean().default(true),
	notifyOnRecovery: z.boolean().default(true),
	notifyOnTlsExpiry: z.boolean().default(false),
	tlsExpiryThresholdDays: z.number().int().min(1).max(90).default(14),
} satisfies z.ZodRawShape;

export const apiCreateUptimeNotificationChannel = z
	.object({
		uptimeMonitorId: z.string(),
		...apiNotificationChannelConfigShape,
	})
	.superRefine(validateChannelTarget);

// Account-level default channel: same config, no monitor binding.
export const apiCreateUptimeDefaultNotificationChannel = z
	.object(apiNotificationChannelConfigShape)
	.superRefine(validateChannelTarget);

export const apiUpdateUptimeNotificationChannel = z.object({
	channelId: z.string(),
	channelType: z
		.enum(["email", "webhook", "slack", "discord", "telegram"])
		.optional(),
	emailProviderId: z.string().nullable().optional(),
	recipientAddresses: z.array(z.string().email()).optional(),
	webhookUrl: z.string().min(1).nullable().optional(),
	webhookHeaders: z.record(z.string(), z.string()).nullable().optional(),
	notifyOnDown: z.boolean().optional(),
	notifyOnRecovery: z.boolean().optional(),
	notifyOnTlsExpiry: z.boolean().optional(),
	tlsExpiryThresholdDays: z.number().int().min(1).max(90).optional(),
});

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

const shareTokenSchema = z.string().min(16).max(128);

export const apiCreateUptimeShareLink = z.object({
	uptimeMonitorIds: z.array(z.string().min(1)).min(1).max(50),
	expiresInDays: z
		.union([z.literal(7), z.literal(30), z.literal(90)])
		.default(30),
});

export const apiResolveUptimeShareLink = z.object({
	token: shareTokenSchema,
});

export const apiCloneUptimeShareLink = z.object({
	token: shareTokenSchema,
	uptimeMonitorIds: z.array(z.string().min(1)).min(1).max(50),
});

export const apiRevokeUptimeShareLink = z.object({
	shareLinkId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// API keys (Bearer credentials for the public `/api/v1` REST surface).
// ---------------------------------------------------------------------------

export const apiCreateApiKey = z.object({
	name: z.string().trim().min(1).max(100),
});

export const apiRevokeApiKey = z.object({
	apiKeyId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Cross-monitor incident search (powers the dashboard command palette).
// ---------------------------------------------------------------------------

export const apiSearchUptimeIncidents = z.object({
	query: z.string().trim().min(1).max(100),
	limit: z.number().int().min(1).max(50).default(20),
});

// ---------------------------------------------------------------------------
// SLA reports (tier-gated monthly PDF / uptime reports).
// ---------------------------------------------------------------------------

// On-demand report window (days). Mirrors the legacy inline schema.
export const apiSlaReport = z.object({
	uptimeMonitorId: z.string().min(1),
	days: z.number().int().min(1).max(366).default(30),
});

// Create or update a monthly-email subscription. `uptimeMonitorId` null/omitted
// ⇒ account-wide (all of the user's monitors). Passing `slaReportSubscriptionId`
// updates that subscription in place; omitting it creates a new one.
export const apiUpsertSlaReportSubscription = z.object({
	slaReportSubscriptionId: z.string().min(1).optional(),
	uptimeMonitorId: z.string().min(1).nullable().optional(),
	recipientAddresses: z.array(z.string().email()).min(1).max(20),
	emailProviderId: z.string().min(1),
	active: z.boolean().default(true),
});

export const apiRemoveSlaReportSubscription = z.object({
	slaReportSubscriptionId: z.string().min(1),
});

export const apiSendSlaReportNow = z.object({
	slaReportSubscriptionId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Status pages (named public pages + optional verified custom domain).
// ---------------------------------------------------------------------------

// Public path segment: lowercase, hyphen-joined alphanumeric labels, ≤63 chars.
const statusPageSlugSchema = z
	.string()
	.trim()
	.toLowerCase()
	.min(1)
	.max(63)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
		message: "Slug may contain only lowercase letters, numbers, and hyphens",
	});

// A custom domain hostname: lowercased, no scheme/path/port, ≤253 chars, at
// least two labels, punycode-safe (`xn--…`), never an IP address or wildcard.
const HOSTNAME_RE =
	/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const customDomainSchema = z
	.string()
	.trim()
	.toLowerCase()
	.max(253)
	.refine((v) => HOSTNAME_RE.test(v), {
		message: "Must be a valid domain name (no scheme, port, path, or wildcard)",
	})
	// The right-most label (the TLD) is never all-numeric; this also rejects
	// dotted-quad IPv4 addresses, which would otherwise satisfy HOSTNAME_RE.
	.refine((v) => !/^\d+$/.test(v.split(".").pop() ?? ""), {
		message: "Must be a domain name, not an IP address",
	});

// Logo shown on the public page. http(s) only (an <img src>), never a
// `javascript:`/`data:` URI even though `new URL()` would parse those.
const statusPageLogoUrlSchema = z
	.string()
	.trim()
	.url()
	.max(2048)
	.refine((v) => v.startsWith("https://") || v.startsWith("http://"), {
		message: "Logo URL must be http or https",
	});

export const apiCreateUptimeStatusPage = z.object({
	slug: statusPageSlugSchema,
	title: z.string().trim().min(1).max(255),
	description: z.string().max(1000).nullable().optional(),
	logoUrl: statusPageLogoUrlSchema.nullable().optional(),
	isPublished: z.boolean().default(false),
});

export const apiUpdateUptimeStatusPage = z.object({
	statusPageId: z.string().min(1),
	slug: statusPageSlugSchema.optional(),
	title: z.string().trim().min(1).max(255).optional(),
	description: z.string().max(1000).nullable().optional(),
	logoUrl: statusPageLogoUrlSchema.nullable().optional(),
	isPublished: z.boolean().optional(),
});

export const apiGetUptimeStatusPage = z.object({
	statusPageId: z.string().min(1),
});

export const apiDeleteUptimeStatusPage = z.object({
	statusPageId: z.string().min(1),
});

// Replace a page's monitor set wholesale. Empty array clears the page.
export const apiSetStatusPageMonitors = z.object({
	statusPageId: z.string().min(1),
	uptimeMonitorIds: z.array(z.string().min(1)).max(100),
});

export const apiAttachCustomDomain = z.object({
	statusPageId: z.string().min(1),
	customDomain: customDomainSchema,
});

// verifyDomain / detachDomain take only the page id.
export const apiStatusPageDomainAction = z.object({
	statusPageId: z.string().min(1),
});

// Public resolve by per-user (userId, slug).
export const apiResolveStatusPageBySlug = z.object({
	userId: z.string().min(1),
	slug: statusPageSlugSchema,
});

// Public resolve by verified custom-domain Host.
export const apiResolveStatusPageByDomain = z.object({
	host: customDomainSchema,
});
