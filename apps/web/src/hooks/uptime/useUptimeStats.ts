/**
 * Uptime Stats Hooks - React Query hooks for uptime statistics and history
 *
 * Provides data fetching hooks for dashboard summary, check logs,
 * status changes, and incidents.
 *
 * @module hooks/uptime/useUptimeStats
 */

import { useQuery } from "@tanstack/react-query";
import { UptimeService } from "@/services/uptime/uptimeService";
import { uptimeKeys } from "./queryKeys";

/**
 * Hook to get the aggregate dashboard summary across all monitors
 */
export function useUptimeDashboardSummary(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: uptimeKeys.dashboard.summary(),
    queryFn: () => UptimeService.getDashboardSummary(),
    enabled: options?.enabled !== false,
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 1000 * 60, // Refetch every minute
  });
}

/**
 * Hook to get aggregate stats for a monitor's check logs over a period
 *
 * @param monitorId - The uptime monitor ID
 * @param days - Number of days to look back (default: server-side default)
 */
export function useUptimeMonitorStats(
  monitorId: string,
  days?: number,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: uptimeKeys.checkLogs.stats(monitorId),
    queryFn: () => UptimeService.getCheckLogStats(monitorId, days),
    enabled: options?.enabled !== false && Boolean(monitorId),
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook to list check logs for a monitor with optional pagination
 *
 * @param monitorId - The uptime monitor ID
 * @param options - Pagination and query options
 */
export function useUptimeCheckLogs(
  monitorId: string,
  options?: {
    limit?: number;
    offset?: number;
    enabled?: boolean;
    refetchInterval?: number;
  }
) {
  const { limit, offset, enabled, refetchInterval } = options ?? {};

  return useQuery({
    queryKey: uptimeKeys.checkLogs.list(monitorId),
    queryFn: () => UptimeService.listCheckLogs(monitorId, { limit, offset }),
    enabled: enabled !== false && Boolean(monitorId),
    staleTime: 1000 * 15, // 15 seconds
    refetchInterval,
  });
}

/**
 * Hook to list notification delivery-log rows. Omit `monitorId` for the
 * account-wide history; pass it to scope to one monitor.
 *
 * @param monitorId - The uptime monitor ID, or undefined for global history
 * @param options - Pagination and query options
 */
export function useUptimeNotificationLogs(
  monitorId: string | undefined,
  options?: { limit?: number; offset?: number; enabled?: boolean }
) {
  const { limit, offset = 0, enabled } = options ?? {};

  return useQuery({
    queryKey: uptimeKeys.notificationLogs.list(monitorId, offset),
    queryFn: () =>
      UptimeService.listNotificationLogs({
        uptimeMonitorId: monitorId,
        limit,
        offset,
      }),
    enabled: enabled !== false,
    staleTime: 1000 * 30, // 30 seconds
    placeholderData: (prev) => prev,
  });
}

/**
 * Hook to list status change events for a monitor
 *
 * @param monitorId - The uptime monitor ID
 * @param limit - Maximum number of status changes to return
 */
export function useUptimeStatusChanges(
  monitorId: string,
  limit?: number,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: uptimeKeys.statusChanges.list(monitorId),
    queryFn: () => UptimeService.listStatusChanges(monitorId, limit),
    enabled: options?.enabled !== false && Boolean(monitorId),
    staleTime: 1000 * 30, // 30 seconds
  });
}

/**
 * Hook to list incidents for a monitor
 *
 * @param monitorId - The uptime monitor ID
 * @param limit - Maximum number of incidents to return
 */
export function useUptimeIncidents(
  monitorId: string,
  limit?: number,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: uptimeKeys.incidents.list(monitorId),
    queryFn: () => UptimeService.listIncidents(monitorId, limit),
    enabled: options?.enabled !== false && Boolean(monitorId),
    staleTime: 1000 * 30, // 30 seconds
  });
}

/**
 * Hook to get a single incident by ID
 *
 * @param incidentId - The incident ID
 */
export function useUptimeIncident(
  incidentId: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: uptimeKeys.incidents.detail(incidentId),
    queryFn: () => UptimeService.getIncident(incidentId),
    enabled: options?.enabled !== false && Boolean(incidentId),
    staleTime: 1000 * 30, // 30 seconds
  });
}
