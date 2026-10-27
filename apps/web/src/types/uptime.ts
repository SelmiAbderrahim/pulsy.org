import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@pulsy/server/trpc";
import type { NetworkConfiguration } from "@pulsy/db/validation-network";
export interface LatencyPolicy {
  thresholdMs: number | null;
  slowCount: number;
  recoveryThresholdMs: number | null;
  recoveryCount: number;
  importance: "critical" | "warning" | "informational";
  cooldownSeconds: number;
}

export type HttpAssertion =
  | { type: "body_contains" | "body_not_contains"; value: string }
  | { type: "header_equals" | "header_contains"; name: string; value: string }
  | { type: "json"; path: string; op: "exists" | "equals" | "not_equals" | "lt" | "lte" | "gt" | "gte"; value?: string | number | boolean | null | Array<string | number | boolean | null> };
export interface HttpRequestConfiguration {
  headers: Array<{ name: string; value: string }>;
  body?: string;
  contentType?: string;
  auth?: { type: "basic"; username: string; password: string } | { type: "bearer"; token: string };
}
export interface HttpConfigurationPatch {
  latencyPolicy?: LatencyPolicy | null;
  httpAssertions?: HttpAssertion[];
  redirectPolicy?: "follow" | "manual" | "error";
  requestConfig?: HttpRequestConfiguration | null;
}
export interface HttpConfigurationResult {
  latencySample?: boolean;
  status: "up" | "down" | "degraded"; httpStatus: number | null; responseTime: number | null;
  errorMessage?: string; assertionOutcomes?: Array<{ index: number; passed: boolean; reason: string }>;
}

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
  heartbeat?: { lastReceivedAt: string | null; expectedAt: string; deadlineAt: string } | null;
  networkConfig?: NetworkConfiguration | null;
  referencedChannels?: Array<{ id: string; type: UptimeNotificationChannelType }>;
  latencyPolicy?: LatencyPolicy | null;
  httpAssertions?: HttpAssertion[];
  redirectPolicy?: "follow" | "manual" | "error";
  requestConfigured?: boolean;
  alertSuppression?: { ids: string[]; until: string; maintenance: boolean } | null;
  uptimeChecks?: number;
  overrideChannelCount?: number;
  statusPageCount?: number;
  monitorType?: "http" | "heartbeat" | "dns" | "tcp" | "server";
  uptimeMonitorId: string;
  name: string;
  url: string;
  method: UptimeMonitorMethod;
  expectedStatus: number;
  expectedStatuses?: string | null;
  tlsMonitoringEnabled?: boolean;
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
export type UptimeNotificationEvent = "down" | "degraded" | "recovery" | "tls_expiry";

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
  notifyOnDegraded?: boolean;
  notifyOnRecovery: boolean;
  notifyOnTlsExpiry: boolean;
  tlsExpiryThresholdDays: number;
  createdAt: string;
  /** Populated when requested via relations */
  emailProvider?: UptimeEmailProvider;
}

export interface UptimeChannelHealth {
  channelId: string;
  channelType: UptimeNotificationChannelType;
  uptimeMonitorId: string | null;
  /** Audit target of the most recent attempt (masked; never a secret). */
  target: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
}

/** Consecutive failures before a channel is shown as broken. */
export const CHANNEL_UNHEALTHY_THRESHOLD = 3;

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
  expectedAt?: string | null;
  notifiedAt?: string | null;
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
  expectedAt?: string | null;
  notifiedAt?: string | null;
}

// ============================================
// API Input Types
// ============================================

export interface CreateUptimeMonitorInput extends HttpConfigurationPatch {
  channelIds?: string[];
  name: string;
  url: string;
  method?: UptimeMonitorMethod;
  expectedStatus?: number;
  expectedStatuses?: string | null;
  tlsMonitoringEnabled?: boolean;
  timeout?: number;
  interval?: number;
  failureThreshold?: number;
  active?: boolean;
  tags?: string[];
}

export interface UpdateUptimeMonitorInput extends HttpConfigurationPatch {
  uptimeMonitorId: string;
  name?: string;
  url?: string;
  method?: UptimeMonitorMethod;
  expectedStatus?: number;
  expectedStatuses?: string | null;
  tlsMonitoringEnabled?: boolean;
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
  expectedStatuses?: string | null;
  tlsMonitoringEnabled?: boolean;
  timeout?: number;
  interval?: number;
  failureThreshold?: number;
  tags?: string[];
}

export interface BulkUpdateUptimeMonitorsResult {
  updated: UptimeMonitor[];
  results: Array<{ id: string; status: "updated" | "rejected"; reason?: string }>;
}

export interface BulkUpdateUptimeMonitorsInput {
  monitorIds: string[];
  patch: BulkUpdateUptimeMonitorPatch;
}

// ============================================
// Public Status Page Types
// ============================================

export interface PublicMonitorStatus {
  componentId?: string | null;
  description?: string | null;
  group?: string | null;
  maintenance?: boolean;
  monitorType?: "http" | "heartbeat" | "dns" | "tcp" | "server";
  networkConfig?: NetworkConfiguration | null;
  name: string;
  status: UptimeMonitorStatus;
  /** Rolling 30-day availability: (up + degraded) / recorded checks. */
  uptimePercentage: number | null;
  /** Rolling 30-day share of degraded (slow but correct) checks. */
  slowPercentage?: number | null;
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
  asOf?: string;
  publicKey?: string;
  emailSubscriptionsEnabled?: boolean;
  historyEnabled?: boolean;
  announcements?: import("./status-communication").PublicAnnouncement[];
  // Page display metadata — null on the legacy per-user surface when the user
  // has no `default` page.
  title: string | null;
  description: string | null;
  logoUrl: string | null;
  monitors: PublicMonitorStatus[];
  overallStatus: import("@pulsy/db/status-math").OverallStatus;
  recentIncidents: PublicIncidentSummary[];
}

// ============================================
// Status Pages (named public pages + custom domains)
// ============================================

export interface StatusPage {
  componentCount?: number;
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
  confirmEmptyPublication?: boolean;
  uptimeMonitorIds?: string[];
  slug: string;
  title: string;
  description?: string | null;
  logoUrl?: string | null;
  isPublished?: boolean;
}

export interface UpdateStatusPageInput {
  confirmEmptyPublication?: boolean;
  expected?: Pick<StatusPage, "title" | "slug" | "description" | "isPublished">;
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
  showSharerName?: boolean;
  monitorCount: number;
  monitorNames: string[];
}

export interface CreateUptimeShareLinkInput {
  uptimeMonitorIds: string[];
  expiresInDays?: 7 | 30 | 90;
  showSharerName?: boolean;
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
  expectedStatuses?: string | null;
  tlsMonitoringEnabled?: boolean;
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
  notifyOnDegraded?: boolean;
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
  notifyOnDegraded?: boolean;
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
  monitorsPaused: number;
  avgUptimePercentage: number | null;
  uptimeMonitorsWithData: number;
  activeMonitors?: number;
  avgResponseTime?: number | null;
}

/**
 * Statistics for a single monitor over a time period
 */
export type UptimeMonitorStats = inferRouterOutputs<AppRouter>["uptimeMonitor"]["checkLog"]["stats"];

/**
 * Data point for the uptime bar chart visualization
 */
export type UptimeBarDataPoint = UptimeDailyDataPoint;

// ============================================
// SLA reports
// ============================================

/** Aggregate response/uptime stats inside an SLA report window. */
export interface SlaReportStats {
  totalChecks: number;
  successfulChecks: number;
  degradedChecks: number;
  failedChecks: number;
  avgResponseTime: number | null;
  minResponseTime: number | null;
  maxResponseTime: number | null;
  p95ResponseTime: number | null;
  uptimePercentage: number | null;
}

export interface SlaReportIncidentSummary {
  count: number;
  totalDowntimeSeconds: number;
  longestIncidentSeconds: number;
}

/** One incident overlapping a report window; downtime is clipped to the window. */
export interface SlaReportIncident {
  incidentId: string;
  status: string;
  startedAt: string;
  resolvedAt: string | null;
  downtimeSeconds: number;
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
  windowTimezone?: "UTC";
  incidentList?: SlaReportIncident[];
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

/** The daily endpoint includes explicit unknown days and observed check counts. */
export type UptimeDailyDataPoint = inferRouterOutputs<AppRouter>["uptimeMonitor"]["checkLog"]["daily"][number];
