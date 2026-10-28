/**
 * Uptime Notification Channel Hooks - React Query hooks for channel management
 *
 * Provides CRUD and test hooks for uptime monitor notification channels.
 *
 * @module hooks/uptime/useUptimeNotificationChannels
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UptimeService } from "@/services/uptime/uptimeService";
import { uptimeKeys } from "./queryKeys";
import type {
  CreateUptimeNotificationChannelInput,
  CreateUptimeDefaultNotificationChannelInput,
  UpdateUptimeNotificationChannelInput,
} from "@/types/uptime";

/**
 * Hook to list notification channels for a specific monitor
 *
 * @param monitorId - The uptime monitor ID
 */
export function useUptimeNotificationChannels(
  monitorId: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: uptimeKeys.channels.list(monitorId),
    queryFn: () => UptimeService.listChannels(monitorId),
    enabled: options?.enabled !== false && Boolean(monitorId),
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook to list the user's account-level default notification channels
 */
export function useUptimeDefaultChannels(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: uptimeKeys.channels.defaults(),
    queryFn: () => UptimeService.listDefaultChannels(),
    enabled: options?.enabled !== false,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook to create an account-level default notification channel
 */
export function useCreateUptimeDefaultChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateUptimeDefaultNotificationChannelInput) =>
      UptimeService.createDefaultChannel(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.channels.defaults(),
      });
    },
  });
}

/**
 * Hook to create a new notification channel for a monitor
 */
export function useCreateUptimeNotificationChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateUptimeNotificationChannelInput) =>
      UptimeService.createChannel(input),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.channels.list(
          input.uptimeMonitorId
        ),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.detail(
          input.uptimeMonitorId
        ),
      });
    },
  });
}

/**
 * Hook to update an existing notification channel
 */
export function useUpdateUptimeNotificationChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      input: UpdateUptimeNotificationChannelInput & {
        /** null for an account-level default channel */
        uptimeMonitorId: string | null;
      }
    ) => UptimeService.updateChannel(input),
    onSettled: (_data, _error, input) => {
      if (input.uptimeMonitorId === null) {
        queryClient.invalidateQueries({
          queryKey: uptimeKeys.channels.defaults(),
        });
        return;
      }
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.channels.list(
          input.uptimeMonitorId
        ),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.detail(
          input.uptimeMonitorId
        ),
      });
    },
  });
}

/**
 * Hook to delete a notification channel
 */
export function useDeleteUptimeNotificationChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      channelId: string;
      /** null for an account-level default channel */
      uptimeMonitorId: string | null;
    }) => UptimeService.deleteChannel(params.channelId),
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: uptimeKeys.monitors.all() });
      queryClient.invalidateQueries({ queryKey: uptimeKeys.incidents.all() });
      queryClient.invalidateQueries({ queryKey: [...uptimeKeys.all(), "templateChannels"] });
      if (params.uptimeMonitorId === null) {
        queryClient.invalidateQueries({
          queryKey: uptimeKeys.channels.defaults(),
        });
        return;
      }
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.channels.list(
          params.uptimeMonitorId
        ),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.monitors.detail(
          params.uptimeMonitorId
        ),
      });
    },
  });
}

/**
 * Hook to test a notification channel by sending a test notification
 */
export function useTestUptimeNotificationChannel() {
  return useMutation({
    mutationFn: (channelId: string) => UptimeService.testChannel(channelId),
  });
}
