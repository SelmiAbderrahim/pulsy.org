/**
 * Uptime Share Link Hooks - React Query hooks for monitor share links
 *
 * Covers the owner side (create/list/revoke) and the recipient side
 * (resolve a token publicly, clone the selected monitors).
 *
 * @module hooks/uptime/useUptimeShareLinks
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UptimeService } from "@/services/uptime/uptimeService";
import { uptimeKeys } from "./queryKeys";
import type { CreateUptimeShareLinkInput } from "@/types/uptime";

/**
 * Hook to list the current user's share links
 */
export function useUptimeShareLinks(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: uptimeKeys.shareLinks.lists(),
    queryFn: () => UptimeService.listShareLinks(),
    enabled: options?.enabled !== false,
    staleTime: 1000 * 30, // 30 seconds
  });
}

/**
 * Hook to create a new share link for a set of monitors
 */
export function useCreateUptimeShareLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateUptimeShareLinkInput) =>
      UptimeService.createShareLink(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.shareLinks.lists(),
      });
    },
  });
}

/**
 * Hook to revoke (delete) a share link
 */
export function useRevokeUptimeShareLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shareLinkId }: { shareLinkId: string }) =>
      UptimeService.revokeShareLink(shareLinkId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.shareLinks.lists(),
      });
    },
  });
}

/**
 * Hook to resolve a share token into cloneable monitor configs.
 * Public endpoint — works for recipients who just signed up.
 * Expired/revoked tokens are terminal states, so failures never retry.
 */
export function useResolveShareLink(
  token: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: uptimeKeys.shareLinks.resolve(token),
    queryFn: () => UptimeService.resolveShareLink(token),
    enabled: options?.enabled !== false && Boolean(token),
    retry: false,
    staleTime: 1000 * 30, // 30 seconds
  });
}

/**
 * Hook to clone selected monitors from a share link into the current account
 */
export function useCloneSharedMonitors() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      uptimeMonitorIds,
    }: {
      token: string;
      uptimeMonitorIds: string[];
    }) => UptimeService.cloneSharedMonitors(token, uptimeMonitorIds),
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
