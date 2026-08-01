/**
 * Uptime Monitor Service - API operations for uptime monitoring
 *
 * Handles all uptime monitor management operations via the Pulsy tRPC API.
 * Uses the `uptimeMonitor` tRPC router.
 *
 * @module services/uptime/uptimeService
 */

import { SERVER_URL, trpcQuery, trpcMutation } from "@/lib/api/trpc";
import type {
  UptimeMonitor,
  UptimeStatusChange,
  UptimeCheckLog,
  UptimeEmailProvider,
  UptimeNotificationChannel,
  UptimeIncident,
  IncidentSearchResult,
  UptimeDashboardSummary,
  UptimeMonitorStats,
  PublicStatusPage,
  PaginatedUptimeCheckLogs,
  PaginatedUptimeNotificationLogs,
  CreateUptimeMonitorInput,
  UpdateUptimeMonitorInput,
  BulkUpdateUptimeMonitorsInput,
  CreateUptimeEmailProviderInput,
  UpdateUptimeEmailProviderInput,
  CreateUptimeNotificationChannelInput,
  CreateUptimeDefaultNotificationChannelInput,
  UpdateUptimeNotificationChannelInput,
  CreateUptimeShareLinkInput,
  CreatedUptimeShareLink,
  UptimeShareLink,
  ResolvedShareLink,
  SlaReport,
  SlaReportSubscription,
  UpsertSlaReportSubscriptionInput,
  StatusPage,
  StatusPageWithMonitors,
  CreateStatusPageInput,
  UpdateStatusPageInput,
  AttachDomainResult,
  StatusPageDomainState,
  DomainStatus,
} from "@/types/uptime";

/**
 * Uptime Monitor Service
 *
 * Provides CRUD operations and management for uptime monitors, email providers,
 * notification channels, incidents, and dashboard statistics via tRPC.
 */
export const UptimeService = {
  // ============================================
  // Monitor CRUD
  // ============================================

  /**
   * List all uptime monitors for the current user
   */
  async listMonitors(): Promise<UptimeMonitor[]> {
    return trpcQuery<UptimeMonitor[]>("uptimeMonitor", "monitor.list");
  },

  /**
   * Get a single uptime monitor by ID (includes relations)
   */
  async getMonitor(uptimeMonitorId: string): Promise<UptimeMonitor> {
    return trpcQuery<UptimeMonitor>("uptimeMonitor", "monitor.one", {
      uptimeMonitorId,
    });
  },

  /**
   * Create a new uptime monitor
   */
  async createMonitor(
    input: CreateUptimeMonitorInput
  ): Promise<UptimeMonitor> {
    return trpcMutation<UptimeMonitor>(
      "uptimeMonitor",
      "monitor.create",
      input
    );
  },

  /**
   * Create multiple uptime monitors at once (bulk add)
   */
  async createMonitorsBulk(
    monitors: CreateUptimeMonitorInput[]
  ): Promise<UptimeMonitor[]> {
    return trpcMutation<UptimeMonitor[]>(
      "uptimeMonitor",
      "monitor.createBulk",
      { monitors }
    );
  },

  /**
   * Update an existing uptime monitor
   */
  async updateMonitor(
    input: UpdateUptimeMonitorInput
  ): Promise<UptimeMonitor> {
    return trpcMutation<UptimeMonitor>(
      "uptimeMonitor",
      "monitor.update",
      input
    );
  },

  /**
   * Apply the same config patch to many monitors at once (bulk edit)
   */
  async updateMonitorsBulk(
    input: BulkUpdateUptimeMonitorsInput
  ): Promise<UptimeMonitor[]> {
    return trpcMutation<UptimeMonitor[]>(
      "uptimeMonitor",
      "monitor.updateBulk",
      input
    );
  },

  /**
   * Delete an uptime monitor
   */
  async deleteMonitor(uptimeMonitorId: string): Promise<void> {
    return trpcMutation<undefined>("uptimeMonitor", "monitor.delete", {
      uptimeMonitorId,
    });
  },

  /**
   * Toggle the active state of a monitor
   */
  async toggleActive(uptimeMonitorId: string): Promise<UptimeMonitor> {
    return trpcMutation<UptimeMonitor>(
      "uptimeMonitor",
      "monitor.toggleActive",
      { uptimeMonitorId }
    );
  },

  /**
   * Trigger an immediate check for a monitor
   */
  async checkNow(uptimeMonitorId: string): Promise<void> {
    return trpcMutation<undefined>("uptimeMonitor", "monitor.checkNow", {
      uptimeMonitorId,
    });
  },

  // ============================================
  // Status Changes
  // ============================================

  /**
   * List status change events for a monitor
   */
  async listStatusChanges(
    uptimeMonitorId: string,
    limit?: number
  ): Promise<UptimeStatusChange[]> {
    return trpcQuery<UptimeStatusChange[]>(
      "uptimeMonitor",
      "statusChange.list",
      { uptimeMonitorId, limit }
    );
  },

  // ============================================
  // Notification Delivery Logs
  // ============================================

  /**
   * List notification delivery-log rows. Omit `uptimeMonitorId` for the
   * account-wide history; pass it to scope to a single monitor.
   */
  async listNotificationLogs(options?: {
    uptimeMonitorId?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedUptimeNotificationLogs> {
    return trpcQuery<PaginatedUptimeNotificationLogs>(
      "uptimeMonitor",
      "notificationLog.list",
      { ...options }
    );
  },

  // ============================================
  // Check Logs
  // ============================================

  /**
   * List check logs for a monitor with optional pagination
   */
  async listCheckLogs(
    uptimeMonitorId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<PaginatedUptimeCheckLogs> {
    return trpcQuery<PaginatedUptimeCheckLogs>("uptimeMonitor", "checkLog.list", {
      uptimeMonitorId,
      ...options,
    });
  },

  /**
   * Get aggregate stats for a monitor's check logs over a period
   */
  async getCheckLogStats(
    uptimeMonitorId: string,
    days?: number
  ): Promise<UptimeMonitorStats> {
    return trpcQuery<UptimeMonitorStats>("uptimeMonitor", "checkLog.stats", {
      uptimeMonitorId,
      days,
    });
  },

  // ============================================
  // Incidents
  // ============================================

  /**
   * List incidents for a monitor
   */
  async listIncidents(
    uptimeMonitorId: string,
    limit?: number
  ): Promise<UptimeIncident[]> {
    return trpcQuery<UptimeIncident[]>("uptimeMonitor", "incident.list", {
      uptimeMonitorId,
      limit,
    });
  },

  /**
   * Get a single incident by ID
   */
  async getIncident(incidentId: string): Promise<UptimeIncident> {
    return trpcQuery<UptimeIncident>("uptimeMonitor", "incident.one", {
      incidentId,
    });
  },

  /**
   * Search incidents across all of the current user's monitors by monitor
   * name, url, or incident cause (powers the command palette).
   */
  async searchIncidents(query: string): Promise<IncidentSearchResult[]> {
    return trpcQuery<IncidentSearchResult[]>(
      "uptimeMonitor",
      "incident.search",
      { query }
    );
  },

  // ============================================
  // Email Providers
  // ============================================

  /**
   * List all email providers for the current user
   */
  async listEmailProviders(): Promise<UptimeEmailProvider[]> {
    return trpcQuery<UptimeEmailProvider[]>(
      "uptimeMonitor",
      "emailProvider.list"
    );
  },

  /**
   * Create a new email provider
   */
  async createEmailProvider(
    input: CreateUptimeEmailProviderInput
  ): Promise<UptimeEmailProvider> {
    return trpcMutation<UptimeEmailProvider>(
      "uptimeMonitor",
      "emailProvider.create",
      input
    );
  },

  /**
   * Update an existing email provider
   */
  async updateEmailProvider(
    input: UpdateUptimeEmailProviderInput
  ): Promise<UptimeEmailProvider> {
    return trpcMutation<UptimeEmailProvider>(
      "uptimeMonitor",
      "emailProvider.update",
      input
    );
  },

  /**
   * Delete an email provider
   */
  async deleteEmailProvider(emailProviderId: string): Promise<void> {
    return trpcMutation<undefined>("uptimeMonitor", "emailProvider.delete", {
      emailProviderId,
    });
  },

  /**
   * Send a test email using the provider to verify configuration
   */
  async testEmailProvider(emailProviderId: string): Promise<void> {
    return trpcMutation<undefined>("uptimeMonitor", "emailProvider.test", {
      emailProviderId,
    });
  },

  // ============================================
  // Notification Channels
  // ============================================

  /**
   * List notification channels for a monitor
   */
  async listChannels(
    uptimeMonitorId: string
  ): Promise<UptimeNotificationChannel[]> {
    return trpcQuery<UptimeNotificationChannel[]>(
      "uptimeMonitor",
      "channel.list",
      { uptimeMonitorId }
    );
  },

  /**
   * List account-level default notification channels (apply to all monitors)
   */
  async listDefaultChannels(): Promise<UptimeNotificationChannel[]> {
    return trpcQuery<UptimeNotificationChannel[]>(
      "uptimeMonitor",
      "channel.listDefaults"
    );
  },

  /**
   * Create an account-level default notification channel
   */
  async createDefaultChannel(
    input: CreateUptimeDefaultNotificationChannelInput
  ): Promise<UptimeNotificationChannel> {
    return trpcMutation<UptimeNotificationChannel>(
      "uptimeMonitor",
      "channel.createDefault",
      input
    );
  },

  /**
   * Create a new notification channel for a monitor
   */
  async createChannel(
    input: CreateUptimeNotificationChannelInput
  ): Promise<UptimeNotificationChannel> {
    return trpcMutation<UptimeNotificationChannel>(
      "uptimeMonitor",
      "channel.create",
      input
    );
  },

  /**
   * Update an existing notification channel
   */
  async updateChannel(
    input: UpdateUptimeNotificationChannelInput
  ): Promise<UptimeNotificationChannel> {
    return trpcMutation<UptimeNotificationChannel>(
      "uptimeMonitor",
      "channel.update",
      input
    );
  },

  /**
   * Delete a notification channel
   */
  async deleteChannel(channelId: string): Promise<void> {
    return trpcMutation<undefined>("uptimeMonitor", "channel.delete", {
      channelId,
    });
  },

  /**
   * Send a test notification through a channel to verify configuration
   */
  async testChannel(channelId: string): Promise<void> {
    return trpcMutation<undefined>("uptimeMonitor", "channel.test", {
      channelId,
    });
  },

  // ============================================
  // Dashboard
  // ============================================

  /**
   * Get aggregate dashboard summary across all monitors
   */
  async getDashboardSummary(): Promise<UptimeDashboardSummary> {
    return trpcQuery<UptimeDashboardSummary>(
      "uptimeMonitor",
      "dashboard.summary"
    );
  },

  // ============================================
  // Share Links
  // ============================================

  /**
   * Create an expiring share link for a set of monitors
   */
  async createShareLink(
    input: CreateUptimeShareLinkInput
  ): Promise<CreatedUptimeShareLink> {
    return trpcMutation<CreatedUptimeShareLink>(
      "uptimeMonitor",
      "share.create",
      input
    );
  },

  /**
   * List the current user's share links
   */
  async listShareLinks(): Promise<UptimeShareLink[]> {
    return trpcQuery<UptimeShareLink[]>("uptimeMonitor", "share.list");
  },

  /**
   * Revoke (delete) a share link
   */
  async revokeShareLink(shareLinkId: string): Promise<void> {
    return trpcMutation<undefined>("uptimeMonitor", "share.revoke", {
      shareLinkId,
    });
  },

  /**
   * Resolve a share link into cloneable monitor configs (no auth required)
   */
  async resolveShareLink(token: string): Promise<ResolvedShareLink> {
    return trpcQuery<ResolvedShareLink>("uptimeMonitor", "public.sharedLink", {
      token,
    });
  },

  /**
   * Clone the selected monitors from a share link into the current account
   */
  async cloneSharedMonitors(
    token: string,
    uptimeMonitorIds: string[]
  ): Promise<UptimeMonitor[]> {
    return trpcMutation<UptimeMonitor[]>("uptimeMonitor", "share.clone", {
      token,
      uptimeMonitorIds,
    });
  },

  // ============================================
  // Public Status Page
  // ============================================

  /**
   * Get public status page data for a user (no auth required)
   */
  async getPublicStatus(userId: string): Promise<PublicStatusPage> {
    return trpcQuery<PublicStatusPage>("uptimeMonitor", "public.status", {
      userId,
    });
  },

  // ============================================
  // SLA Reports (tier-gated)
  // ============================================

  /**
   * Get the on-demand SLA report model for a monitor over a rolling window.
   */
  async getSlaReport(
    uptimeMonitorId: string,
    days?: number
  ): Promise<SlaReport> {
    return trpcQuery<SlaReport>("uptimeMonitor", "slaReport.data", {
      uptimeMonitorId,
      ...(days === undefined ? {} : { days }),
    });
  },

  /**
   * Build the authenticated PDF download URL served by the Express route.
   * The browser session cookie authorizes the request.
   */
  slaReportPdfUrl(uptimeMonitorId: string, days = 30): string {
    return `${SERVER_URL}/api/reports/sla/${encodeURIComponent(
      uptimeMonitorId
    )}.pdf?days=${days}`;
  },

  /**
   * List the current user's monthly-email subscriptions.
   */
  async listSlaReportSubscriptions(): Promise<SlaReportSubscription[]> {
    return trpcQuery<SlaReportSubscription[]>(
      "uptimeMonitor",
      "slaReport.subscription.list"
    );
  },

  /**
   * Create or update a monthly-email subscription.
   */
  async upsertSlaReportSubscription(
    input: UpsertSlaReportSubscriptionInput
  ): Promise<SlaReportSubscription> {
    return trpcMutation<SlaReportSubscription>(
      "uptimeMonitor",
      "slaReport.subscription.upsert",
      input
    );
  },

  /**
   * Delete a monthly-email subscription.
   */
  async removeSlaReportSubscription(
    slaReportSubscriptionId: string
  ): Promise<{ success: boolean }> {
    return trpcMutation<{ success: boolean }>(
      "uptimeMonitor",
      "slaReport.subscription.remove",
      { slaReportSubscriptionId }
    );
  },

  /**
   * Trigger an immediate send for a subscription (testing the monthly flow).
   */
  async sendSlaReportNow(
    slaReportSubscriptionId: string
  ): Promise<{ skipped: boolean; monitorsReported: number; emailsSent: number }> {
    return trpcMutation(
      "uptimeMonitor",
      "slaReport.subscription.sendNow",
      { slaReportSubscriptionId }
    );
  },

  // ============================================
  // Status Pages
  // ============================================

  /** List the current user's status pages. */
  async listStatusPages(): Promise<StatusPage[]> {
    return trpcQuery<StatusPage[]>("uptimeMonitor", "statusPage.list");
  },

  /** Get one status page with its linked monitor ids. */
  async getStatusPage(statusPageId: string): Promise<StatusPageWithMonitors> {
    return trpcQuery<StatusPageWithMonitors>("uptimeMonitor", "statusPage.one", {
      statusPageId,
    });
  },

  /** Create a status page. */
  async createStatusPage(input: CreateStatusPageInput): Promise<StatusPage> {
    return trpcMutation<StatusPage>("uptimeMonitor", "statusPage.create", input);
  },

  /** Update a status page. */
  async updateStatusPage(input: UpdateStatusPageInput): Promise<StatusPage> {
    return trpcMutation<StatusPage>("uptimeMonitor", "statusPage.update", input);
  },

  /** Delete a status page. */
  async deleteStatusPage(
    statusPageId: string
  ): Promise<{ success: boolean }> {
    return trpcMutation("uptimeMonitor", "statusPage.delete", { statusPageId });
  },

  /** Replace a page's monitor set (empty array clears it). */
  async setStatusPageMonitors(
    statusPageId: string,
    uptimeMonitorIds: string[]
  ): Promise<{ success: boolean; count: number }> {
    return trpcMutation("uptimeMonitor", "statusPage.setMonitors", {
      statusPageId,
      uptimeMonitorIds,
    });
  },

  /** Attach a custom domain; returns the TXT record to publish. */
  async attachStatusPageDomain(
    statusPageId: string,
    customDomain: string
  ): Promise<AttachDomainResult> {
    return trpcMutation<AttachDomainResult>(
      "uptimeMonitor",
      "statusPage.attachDomain",
      { statusPageId, customDomain }
    );
  },

  /** Resolve the DNS TXT challenge for a page's custom domain. */
  async verifyStatusPageDomain(
    statusPageId: string
  ): Promise<StatusPageDomainState> {
    return trpcMutation<StatusPageDomainState>(
      "uptimeMonitor",
      "statusPage.verifyDomain",
      { statusPageId }
    );
  },

  /** Remove the custom domain from a page. */
  async detachStatusPageDomain(
    statusPageId: string
  ): Promise<{ success: boolean }> {
    return trpcMutation("uptimeMonitor", "statusPage.detachDomain", {
      statusPageId,
    });
  },

  /** Live integration status (ownership + routing + cert) for a page domain. */
  async getStatusPageDomainStatus(statusPageId: string): Promise<DomainStatus> {
    return trpcQuery<DomainStatus>(
      "uptimeMonitor",
      "statusPage.domainStatus",
      { statusPageId }
    );
  },

  /** Resolve a published page by per-user (userId, slug) — no auth. */
  async getStatusPageBySlug(
    userId: string,
    slug: string
  ): Promise<PublicStatusPage> {
    return trpcQuery<PublicStatusPage>(
      "uptimeMonitor",
      "public.statusPageBySlug",
      { userId, slug }
    );
  },

  /** Resolve a published page by verified custom-domain Host — no auth. */
  async getStatusPageByDomain(host: string): Promise<PublicStatusPage> {
    return trpcQuery<PublicStatusPage>(
      "uptimeMonitor",
      "public.statusPageByDomain",
      { host }
    );
  },
};
