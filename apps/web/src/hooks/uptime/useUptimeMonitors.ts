import { addCachedMonitors, changeCachedMonitors } from "./optimistic-cache";
/**
 * Uptime Monitor Hooks - React Query hooks for monitor CRUD
 *
 * Provides data fetching and mutation hooks for uptime monitors.
 *
 * @module hooks/uptime/useUptimeMonitors
 */

import { useIsFetching, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UptimeService } from "@/services/uptime/uptimeService";
import { uptimeKeys } from "./queryKeys";
import type {
  UptimeMonitor,
  CreateUptimeMonitorInput,
  UpdateUptimeMonitorInput,
  BulkUpdateUptimeMonitorsInput,
} from "@/types/uptime";
import { isAwaitingFirstCheck } from "@/lib/uptime/format";

/**
 * Hook to list all uptime monitors
 */
export function useUptimeMonitors(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: uptimeKeys.monitors.lists(),
    queryFn: () => UptimeService.listMonitors(),
    enabled: options?.enabled !== false,
    staleTime: 1000 * 30, // 30 seconds
    retry: false,
    // Poll briefly while a first check runs so "Checking…" turns into a result within seconds.
    refetchInterval: query => query.state.data?.some(isAwaitingFirstCheck) ? 3000 : 1000 * 60,
  });
}

/**
 * True while an invalidated monitor list (after a write) is being refetched.
 * Routine polling does not count, so the counters only say "Updating…" when
 * a mutation has made the current snapshot provisional.
 */
export function useMonitorListUpdating() {
  return useIsFetching({ queryKey: uptimeKeys.monitors.lists(), predicate: query => query.state.isInvalidated }) > 0;
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
    refetchInterval: query => query.state.data && isAwaitingFirstCheck(query.state.data) ? 3000 : 1000 * 30,
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
    onSuccess: (created) => {
      addCachedMonitors(queryClient, [created]);
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
    onSuccess: (created) => {
      addCachedMonitors(queryClient, created);
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
        // Private replacements belong only to this form/request, never the shared cache.
        const optimistic = { ...input };
        delete optimistic.requestConfig;
        queryClient.setQueryData(
          uptimeKeys.monitors.detail(input.uptimeMonitorId),
          { ...previousData, ...optimistic }
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
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.lists(),
      });
      for (const id of input.monitorIds) queryClient.invalidateQueries({queryKey:uptimeKeys.monitors.detail(id)});
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
    onMutate: ({uptimeMonitorId}) => changeCachedMonitors(queryClient,[uptimeMonitorId],()=>null),
    onError: (_error,_input,rollback) => rollback?.(),
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
    onMutate: ({uptimeMonitorId}) => changeCachedMonitors(queryClient,[uptimeMonitorId],row=>({...row,active:!row.active})),
    onError: (_error,_input,rollback) => rollback?.(),
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
      queryClient.invalidateQueries({ queryKey: uptimeKeys.slaReports.details(uptimeMonitorId) });
      queryClient.invalidateQueries({ queryKey: uptimeKeys.incidents.list(uptimeMonitorId) });
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
        queryKey: uptimeKeys.checkLogs.daily(uptimeMonitorId),
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
