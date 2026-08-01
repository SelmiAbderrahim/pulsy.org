/**
 * Uptime Monitor Hooks - React Query hooks for monitor CRUD
 *
 * Provides data fetching and mutation hooks for uptime monitors.
 *
 * @module hooks/uptime/useUptimeMonitors
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UptimeService } from "@/services/uptime/uptimeService";
import { uptimeKeys } from "./queryKeys";
import type {
  UptimeMonitor,
  CreateUptimeMonitorInput,
  UpdateUptimeMonitorInput,
  BulkUpdateUptimeMonitorsInput,
} from "@/types/uptime";

/**
 * Hook to list all uptime monitors
 */
export function useUptimeMonitors(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: uptimeKeys.monitors.lists(),
    queryFn: () => UptimeService.listMonitors(),
    enabled: options?.enabled !== false,
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 1000 * 60, // Refetch every minute for status updates
  });
}

/**
 * Hook to get a single uptime monitor by ID (includes relations)
 */
export function useUptimeMonitor(
  uptimeMonitorId: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: uptimeKeys.monitors.detail(uptimeMonitorId),
    queryFn: () => UptimeService.getMonitor(uptimeMonitorId),
    enabled: options?.enabled !== false && Boolean(uptimeMonitorId),
    staleTime: 1000 * 15, // 15 seconds
    refetchInterval: 1000 * 30, // Refetch every 30 seconds for live status
  });
}

/**
 * Hook to create a new uptime monitor
 */
export function useCreateUptimeMonitor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateUptimeMonitorInput) =>
      UptimeService.createMonitor(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.dashboard.summary(),
      });
    },
  });
}

/**
 * Hook to create multiple uptime monitors at once (bulk add)
 */
export function useCreateUptimeMonitorsBulk() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (monitors: CreateUptimeMonitorInput[]) =>
      UptimeService.createMonitorsBulk(monitors),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.dashboard.summary(),
      });
    },
  });
}

/**
 * Hook to update an existing uptime monitor
 */
export function useUpdateUptimeMonitor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateUptimeMonitorInput) =>
      UptimeService.updateMonitor(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: uptimeKeys.monitors.detail(
          input.uptimeMonitorId
        ),
      });

      const previousData = queryClient.getQueryData<UptimeMonitor>(
        uptimeKeys.monitors.detail(input.uptimeMonitorId)
      );

      if (previousData) {
        queryClient.setQueryData(
          uptimeKeys.monitors.detail(input.uptimeMonitorId),
          { ...previousData, ...input }
        );
      }

      return { previousData };
    },
    onError: (_error, input, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(
          uptimeKeys.monitors.detail(input.uptimeMonitorId),
          context.previousData
        );
      }
    },
    onSettled: (_data, _error, input) => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.detail(
          input.uptimeMonitorId
        ),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.lists(),
      });
    },
  });
}

/**
 * Hook to apply the same config patch to many monitors at once (bulk edit).
 * Single server call — invalidates the list, details, and dashboard summary.
 */
export function useBulkUpdateUptimeSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: BulkUpdateUptimeMonitorsInput) =>
      UptimeService.updateMonitorsBulk(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.details(),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.dashboard.summary(),
      });
    },
  });
}

/**
 * Hook to delete an uptime monitor
 */
export function useDeleteUptimeMonitor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ uptimeMonitorId }: { uptimeMonitorId: string }) =>
      UptimeService.deleteMonitor(uptimeMonitorId),
    onSuccess: (_data, { uptimeMonitorId }) => {
      queryClient.removeQueries({
        queryKey: uptimeKeys.monitors.detail(uptimeMonitorId),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.dashboard.summary(),
      });
    },
  });
}

/**
 * Hook to toggle a monitor's active state
 */
export function useToggleUptimeMonitor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ uptimeMonitorId }: { uptimeMonitorId: string }) =>
      UptimeService.toggleActive(uptimeMonitorId),
    onMutate: async ({ uptimeMonitorId }) => {
      await queryClient.cancelQueries({
        queryKey: uptimeKeys.monitors.detail(uptimeMonitorId),
      });

      const previousData = queryClient.getQueryData<UptimeMonitor>(
        uptimeKeys.monitors.detail(uptimeMonitorId)
      );

      if (previousData) {
        queryClient.setQueryData(
          uptimeKeys.monitors.detail(uptimeMonitorId),
          { ...previousData, active: !previousData.active }
        );
      }

      return { previousData };
    },
    onError: (_error, { uptimeMonitorId }, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(
          uptimeKeys.monitors.detail(uptimeMonitorId),
          context.previousData
        );
      }
    },
    onSettled: (_data, _error, { uptimeMonitorId }) => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.detail(uptimeMonitorId),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.dashboard.summary(),
      });
    },
  });
}

/**
 * Hook to trigger an immediate check for a monitor
 */
export function useCheckNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ uptimeMonitorId }: { uptimeMonitorId: string }) =>
      UptimeService.checkNow(uptimeMonitorId),
    onSuccess: (_data, { uptimeMonitorId }) => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.detail(uptimeMonitorId),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.checkLogs.list(uptimeMonitorId),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.checkLogs.stats(uptimeMonitorId),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.statusChanges.list(uptimeMonitorId),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.dashboard.summary(),
      });
    },
  });
}
