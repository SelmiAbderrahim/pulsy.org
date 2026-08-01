/**
 * Uptime Monitor Types
 *
 * TypeScript interfaces for the uptime monitoring feature.
 * Matches the Pulsy uptime monitor database schema.
 *
 * @module types/uptime
 */

// ============================================
// Enums / Union Types
// ============================================

export type UptimeMonitorMethod = "GET" | "HEAD" | "POST";
export type UptimeMonitorStatus = "up" | "down" | "degraded" | "pending";
export type UptimeCheckStatus = "up" | "down" | "degraded";
export type UptimeIncidentStatus = "ongoing" | "resolved";
export type UptimeEmailProviderType = "resend" | "sendgrid" | "smtp";
export type UptimeNotificationChannelType =
  | "email"
  | "webhook"
  | "slack"
  | "discord"
  | "telegram";

// ============================================
// Core Entities
// ============================================

/**
 * Uptime monitor entity
 */
export interface UptimeMonitor {
  uptimeMonitorId: string;
  name: string;
  url: string;
  method: UptimeMonitorMethod;
  expectedStatus: number;
  timeout: number;
  interval: number;
  active: boolean;
  status: UptimeMonitorStatus;
  httpStatus: number | null;
  responseTime: number | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  tlsExpiresAt: string | null;
  tlsExpiresInDays: number | null;
  consecutiveFailures: number;
  failureThreshold: number;
  uptimePercentage: number | null;
  tags: string[];
  isPublic: boolean;
  statusPageTitle: string | null;
  statusPageDescription: string | null;
  userId: string;
  createdAt: string;
  /** Populated when requested via relations */
  notificationChannels?: UptimeNotificationChannel[];
  /** Populated when requested via relations */
  incidents?: UptimeIncident[];
}

/**
 * Status change event logged when a monitor transitions between states
 */
export interface UptimeStatusChange {
  statusChangeId: string;
  uptimeMonitorId: string;
  statusBefore: UptimeMonitorStatus;
  statusAfter: UptimeMonitorStatus;
  httpStatus: number | null;
  responseTime: number | null;
  reason: string | null;
  createdAt: string;
}

/**
 * Individual check log entry for a monitor
 */
export interface UptimeCheckLog {
  checkLogId: string;
  uptimeMonitorId: string;
  httpStatus: number | null;
  responseTime: number | null;
  status: UptimeCheckStatus;
  errorMessage: string | null;
  createdAt: string;
}

export interface PaginatedUptimeCheckLogs {
  data: UptimeCheckLog[];
  total: number;
}

/**
 * Which transition triggered a notification send.
 */
export type UptimeNotificationEvent = "down" | "recovery" | "tls_expiry";

/**
 * Outcome of a notification delivery attempt chain (after retries).
 */
export type UptimeNotificationOutcome = "sent" | "failed";

/**
 * Delivery-audit row: one per channel target per dispatch, with the final
 * outcome. `target` is never a secret (email address, or URL host / chat id).
 */
export interface UptimeNotificationLog {
  notificationLogId: string;
  uptimeMonitorId: string;
  channelId: string | null;
  channelType: UptimeNotificationChannelType;
  target: string;
  event: UptimeNotificationEvent;
  statusChangeId: string | null;
  outcome: UptimeNotificationOutcome;
  attempts: number;
  providerMessageId: string | null;
  error: string | null;
  createdAt: string;
}

export interface PaginatedUptimeNotificationLogs {
  data: UptimeNotificationLog[];
  total: number;
}

/**
 * Email provider configuration for uptime notifications
 */
export interface UptimeEmailProvider {
  emailProviderId: string;
  name: string;
  providerType: UptimeEmailProviderType;
  apiKey: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  smtpPassword: string | null;
  smtpSecure: boolean;
  fromAddress: string;
  verified: boolean;
  userId: string;
  createdAt: string;
}

/**
 * Notification channel — attached to a monitor, or an account-level default
 * (uptimeMonitorId null) that applies to all the user's monitors.
 */
export interface UptimeNotificationChannel {
  channelId: string;
  uptimeMonitorId: string | null;
  userId: string;
  channelType: UptimeNotificationChannelType;
  emailProviderId: string | null;
  recipientAddresses: string[] | null;
  /** Whether an encrypted webhook/Slack/Discord/Telegram target is stored. */
  hasWebhookUrl: boolean;
  /** Safe display-only target label; never contains a complete URL or token. */
  webhookUrlMasked: string | null;
  /** Whether encrypted custom header values are stored. */
  hasWebhookHeaders: boolean;
  /** Header names are safe to expose; their values never leave the server. */
  webhookHeaderNames: string[];
  notifyOnDown: boolean;
  notifyOnRecovery: boolean;
  notifyOnTlsExpiry: boolean;
  tlsExpiryThresholdDays: number;
  createdAt: string;
  /** Populated when requested via relations */
  emailProvider?: UptimeEmailProvider;
}

/**
 * Incident created when a monitor goes down
 */
export interface UptimeIncident {
  incidentId: string;
  uptimeMonitorId: string;
  status: UptimeIncidentStatus;
  startedAt: string;
  resolvedAt: string | null;
  durationSeconds: number | null;
  cause: string | null;
}

/**
 * A cross-monitor incident search hit (command palette). Enriched with the
 * owning monitor's display name.
 */
export interface IncidentSearchResult {
  incidentId: string;
  uptimeMonitorId: string;
  monitorName: string;
  status: UptimeIncidentStatus;
  startedAt: string;
  resolvedAt: string | null;
  durationSeconds: number | null;
  cause: string | null;
}

// ============================================
// API Input Types
// ============================================

export interface CreateUptimeMonitorInput {
  name: string;
  url: string;
  method?: UptimeMonitorMethod;
  expectedStatus?: number;
  timeout?: number;
  interval?: number;
  failureThreshold?: number;
  active?: boolean;
  tags?: string[];
}

export interface UpdateUptimeMonitorInput {
  uptimeMonitorId: string;
  name?: string;
  url?: string;
  method?: UptimeMonitorMethod;
  expectedStatus?: number;
  timeout?: number;
  interval?: number;
  failureThreshold?: number;
  active?: boolean;
  tags?: string[];
  isPublic?: boolean;
  statusPageTitle?: string | null;
  statusPageDescription?: string | null;
}

/**
 * Shared config fields applied to many monitors at once via bulk edit.
 * Excludes per-monitor identity (name/url) and the active flag.
 */
export interface BulkUpdateUptimeMonitorPatch {
  method?: UptimeMonitorMethod;
  expectedStatus?: number;
  timeout?: number;
  interval?: number;
  failureThreshold?: number;
  tags?: string[];
}

export interface BulkUpdateUptimeMonitorsInput {
  monitorIds: string[];
  patch: BulkUpdateUptimeMonitorPatch;
}

// ============================================
// Public Status Page Types
// ============================================

export interface PublicMonitorStatus {
  name: string;
  status: UptimeMonitorStatus;
  uptimePercentage: number | null;
  responseTime: number | null;
  lastCheckedAt: string | null;
}

export interface PublicIncidentSummary {
  monitorName: string;
  status: UptimeIncidentStatus;
  startedAt: string;
  resolvedAt: string | null;
  durationSeconds: number | null;
}

export interface PublicStatusPage {
  // Page display metadata — null on the legacy per-user surface when the user
  // has no `default` page.
  title: string | null;
  description: string | null;
  logoUrl: string | null;
  monitors: PublicMonitorStatus[];
  overallStatus: "operational" | "degraded" | "outage";
  recentIncidents: PublicIncidentSummary[];
}

// ============================================
// Status Pages (named public pages + custom domains)
// ============================================

export interface StatusPage {
  statusPageId: string;
  userId: string;
  slug: string;
  title: string;
  description: string | null;
  logoUrl: string | null;
  isPublished: boolean;
  customDomain: string | null;
  domainVerified: boolean;
  domainVerifyToken: string | null;
  domainVerifiedAt: string | null;
  // Edge-provisioning lifecycle for a verified custom domain, written by the
  // host-side nginx + certbot daemon. Null until the domain is verified.
  domainProvisionStatus: "pending" | "active" | "failed" | null;
  domainProvisionError: string | null;
  domainProvisionedAt: string | null;
  createdAt: string;
}

export interface StatusPageWithMonitors extends StatusPage {
  monitorIds: string[];
}

export interface CreateStatusPageInput {
  slug: string;
  title: string;
  description?: string | null;
  logoUrl?: string | null;
  isPublished?: boolean;
}

export interface UpdateStatusPageInput {
  statusPageId: string;
  slug?: string;
  title?: string;
  description?: string | null;
  logoUrl?: string | null;
  isPublished?: boolean;
}

export interface DomainRoutingRecord {
  recordType: "CNAME" | "A";
  recordName: string;
  recordValue: string;
}

export interface AttachDomainResult {
  customDomain: string;
  recordType: "TXT";
  recordName: string;
  recordValue: string;
  domainVerified: false;
  // Routing record (CNAME/A) the user must also create so the domain reaches
  // this server. Null when the operator hasn't configured a routing target.
  routingRecord: DomainRoutingRecord | null;
}

export interface StatusPageDomainState {
  domainVerified: boolean;
  domainVerifiedAt: string | null;
}

export interface DomainStatus {
  customDomain: string | null;
  ownershipVerified: boolean;
  routing: {
    ok: boolean;
    resolvedIps: string[];
    expectedIp: string | null;
    record: DomainRoutingRecord | null;
  };
  provisionStatus: "pending" | "active" | "failed" | null;
  provisionError: string | null;
  provisionedAt: string | null;
}

// ============================================
// Share Link Types
// ============================================

/** A share link as returned to its owner (list/create). */
export interface UptimeShareLink {
  shareLinkId: string;
  token: string;
  createdAt: string;
  expiresAt: string;
  monitorCount: number;
  monitorNames: string[];
}

export interface CreateUptimeShareLinkInput {
  uptimeMonitorIds: string[];
  expiresInDays?: 7 | 30 | 90;
}

/** The raw share-link row returned by share.create (owner-only). */
export interface CreatedUptimeShareLink {
  shareLinkId: string;
  token: string;
  monitorIds: string[];
  createdAt: string;
  expiresAt: string;
}

/** Sanitized monitor config exposed by the public resolve endpoint. */
export interface SharedMonitorConfig {
  uptimeMonitorId: string;
  name: string;
  url: string;
  method: UptimeMonitorMethod;
  expectedStatus: number;
  timeout: number;
  interval: number;
  failureThreshold: number;
  tags: string[];
}

export interface ResolvedShareLink {
  sharedBy: string | null;
  expiresAt: string;
  monitors: SharedMonitorConfig[];
}

export interface CreateUptimeEmailProviderInput {
  name: string;
  providerType: UptimeEmailProviderType;
  apiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUsername?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
  fromAddress: string;
}

export interface UpdateUptimeEmailProviderInput {
  emailProviderId: string;
  name?: string;
  providerType?: UptimeEmailProviderType;
  apiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUsername?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
  fromAddress?: string;
}

export interface CreateUptimeNotificationChannelInput {
  uptimeMonitorId: string;
  channelType: UptimeNotificationChannelType;
  emailProviderId?: string;
  recipientAddresses?: string[];
  webhookUrl?: string;
  webhookHeaders?: Record<string, string>;
  notifyOnDown?: boolean;
  notifyOnRecovery?: boolean;
  notifyOnTlsExpiry?: boolean;
  tlsExpiryThresholdDays?: number;
}

/** Account-level default channel: same config, no monitor binding. */
export type CreateUptimeDefaultNotificationChannelInput = Omit<
  CreateUptimeNotificationChannelInput,
  "uptimeMonitorId"
>;

export interface UpdateUptimeNotificationChannelInput {
  channelId: string;
  channelType?: UptimeNotificationChannelType;
  emailProviderId?: string | null;
  recipientAddresses?: string[];
  webhookUrl?: string | null;
  webhookHeaders?: Record<string, string> | null;
  notifyOnDown?: boolean;
  notifyOnRecovery?: boolean;
  notifyOnTlsExpiry?: boolean;
  tlsExpiryThresholdDays?: number;
}

// ============================================
// Dashboard / Stats Types
// ============================================

/**
 * Aggregate summary for the uptime dashboard
 */
export interface UptimeDashboardSummary {
  totalMonitors: number;
  monitorsUp: number;
  monitorsDown: number;
  monitorsDegraded: number;
  monitorsPending: number;
  avgUptime: number;
}

/**
 * Statistics for a single monitor over a time period
 */
export interface UptimeMonitorStats {
  totalChecks: number;
  upChecks: number;
  downChecks: number;
  incidentCount: number;
  days: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  uptimePercentage: number;
}

/**
 * Data point for the uptime bar chart visualization
 */
export interface UptimeBarDataPoint {
  date: string;
  status: "up" | "down" | "degraded" | "partial";
  uptimePercent: number;
}

// ============================================
// SLA reports (tier-gated)
// ============================================

/** Aggregate response/uptime stats inside an SLA report window. */
export interface SlaReportStats {
  totalChecks: number;
  successfulChecks: number;
  failedChecks: number;
  avgResponseTime: number | null;
  minResponseTime: number | null;
  maxResponseTime: number | null;
  p95ResponseTime: number | null;
  uptimePercentage: number;
}

export interface SlaReportIncidentSummary {
  count: number;
  totalDowntimeSeconds: number;
  longestIncidentSeconds: number;
}

export interface SlaReportDailyUptime {
  date: string;
  uptimePercentage: number;
  totalChecks: number;
}

/** Full SLA report model returned by `slaReport.data`. */
export interface SlaReport {
  uptimeMonitorId: string;
  monitorName: string;
  url: string;
  windowFrom: string;
  windowTo: string;
  windowDays: number;
  periodLabel: string;
  generatedAt: string;
  stats: SlaReportStats;
  incidents: SlaReportIncidentSummary;
  dailyUptime: SlaReportDailyUptime[];
}

/** One monthly-email subscription, as returned by `slaReport.subscription.list`. */
export interface SlaReportSubscription {
  slaReportSubscriptionId: string;
  /** null ⇒ account-wide (all of the user's monitors). */
  uptimeMonitorId: string | null;
  monitorName: string | null;
  recipientAddresses: string[];
  emailProviderId: string | null;
  active: boolean;
  lastSentAt: string | null;
  createdAt: string;
}

export interface UpsertSlaReportSubscriptionInput {
  slaReportSubscriptionId?: string;
  /** null/omitted ⇒ account-wide. */
  uptimeMonitorId?: string | null;
  recipientAddresses: string[];
  emailProviderId: string;
  active?: boolean;
}
