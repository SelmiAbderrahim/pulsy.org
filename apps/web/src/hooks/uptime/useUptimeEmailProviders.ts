/**
 * Uptime Email Provider Hooks - React Query hooks for email provider management
 *
 * Provides CRUD and test hooks for uptime notification email providers.
 *
 * @module hooks/uptime/useUptimeEmailProviders
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UptimeService } from "@/services/uptime/uptimeService";
import { uptimeKeys } from "./queryKeys";
import type {
  CreateUptimeEmailProviderInput,
  UpdateUptimeEmailProviderInput,
} from "@/types/uptime";

/**
 * Hook to list all email providers for the current user
 */
export function useUptimeEmailProviders(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: uptimeKeys.emailProviders.lists(),
    queryFn: () => UptimeService.listEmailProviders(),
    enabled: options?.enabled !== false,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook to create a new email provider
 */
export function useCreateUptimeEmailProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateUptimeEmailProviderInput) =>
      UptimeService.createEmailProvider(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.emailProviders.lists(),
      });
    },
  });
}

/**
 * Hook to update an existing email provider
 */
export function useUpdateUptimeEmailProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateUptimeEmailProviderInput) =>
      UptimeService.updateEmailProvider(input),
    onSettled: (_data, _error, input) => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.emailProviders.detail(
          input.emailProviderId
        ),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.emailProviders.lists(),
      });
    },
  });
}

/**
 * Hook to delete an email provider
 */
export function useDeleteUptimeEmailProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (emailProviderId: string) =>
      UptimeService.deleteEmailProvider(emailProviderId),
    onSuccess: (_data, emailProviderId) => {
      queryClient.removeQueries({
        queryKey: uptimeKeys.emailProviders.detail(emailProviderId),
      });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.emailProviders.lists(),
      });
    },
  });
}

/**
 * Hook to test an email provider's configuration by sending a test email
 */
export function useTestUptimeEmailProvider() {
  return useMutation({
    mutationFn: (emailProviderId: string) =>
      UptimeService.testEmailProvider(emailProviderId),
  });
}
