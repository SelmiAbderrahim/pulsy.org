/**
 * Status Page Hooks - React Query hooks for named public status pages.
 *
 * Covers management (list/one/create/update/delete/setMonitors + custom-domain
 * attach/verify/detach) and the public resolve by slug / by custom domain.
 *
 * @module hooks/uptime/useStatusPages
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UptimeService } from "@/services/uptime/uptimeService";
import { uptimeKeys } from "./queryKeys";
import type {
  CreateStatusPageInput,
  UpdateStatusPageInput,
} from "@/types/uptime";

/** List the current user's status pages. */
export function useStatusPages(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: uptimeKeys.statusPages.lists(),
    queryFn: () => UptimeService.listStatusPages(),
    enabled: options?.enabled !== false,
    staleTime: 1000 * 30,
  });
}

/** Get one status page with its linked monitor ids. */
export function useStatusPage(
  statusPageId: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: uptimeKeys.statusPages.detail(statusPageId),
    queryFn: () => UptimeService.getStatusPage(statusPageId),
    enabled: options?.enabled !== false && Boolean(statusPageId),
    staleTime: 1000 * 30,
  });
}

/** Create a status page. */
export function useCreateStatusPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStatusPageInput) =>
      UptimeService.createStatusPage(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uptimeKeys.statusPages.lists() });
    },
  });
}

/** Update a status page. */
export function useUpdateStatusPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateStatusPageInput) =>
      UptimeService.updateStatusPage(input),
    onSuccess: (page) => {
      queryClient.invalidateQueries({ queryKey: uptimeKeys.statusPages.lists() });
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.statusPages.detail(page.statusPageId),
      });
    },
  });
}

/** Delete a status page. */
export function useDeleteStatusPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ statusPageId }: { statusPageId: string }) =>
      UptimeService.deleteStatusPage(statusPageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uptimeKeys.statusPages.lists() });
    },
  });
}

/** Replace a page's monitor set. */
export function useSetStatusPageMonitors() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      statusPageId,
      uptimeMonitorIds,
    }: {
      statusPageId: string;
      uptimeMonitorIds: string[];
    }) => UptimeService.setStatusPageMonitors(statusPageId, uptimeMonitorIds),
    onSuccess: (_res, { statusPageId }) => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.statusPages.detail(statusPageId),
      });
    },
  });
}

/** Attach a custom domain; returns the TXT record to publish. */
export function useAttachStatusPageDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      statusPageId,
      customDomain,
    }: {
      statusPageId: string;
      customDomain: string;
    }) => UptimeService.attachStatusPageDomain(statusPageId, customDomain),
    onSuccess: (_res, { statusPageId }) => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.statusPages.detail(statusPageId),
      });
      queryClient.invalidateQueries({ queryKey: uptimeKeys.statusPages.lists() });
    },
  });
}

/** Resolve the DNS TXT challenge for a page's custom domain. */
export function useVerifyStatusPageDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ statusPageId }: { statusPageId: string }) =>
      UptimeService.verifyStatusPageDomain(statusPageId),
    onSuccess: (_res, { statusPageId }) => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.statusPages.detail(statusPageId),
      });
      queryClient.invalidateQueries({ queryKey: uptimeKeys.statusPages.lists() });
    },
  });
}

/**
 * Live integration status (ownership + routing + cert) for a page's custom
 * domain. Polls while provisioning is not yet `active` so the dashboard reflects
 * the daemon's progress without a manual refresh; `refetch` backs the Re-check
 * button. Only enabled when the page actually has a custom domain.
 */
export function useStatusPageDomainStatus(
  statusPageId: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: uptimeKeys.statusPages.domainStatus(statusPageId),
    queryFn: () => UptimeService.getStatusPageDomainStatus(statusPageId),
    enabled: options?.enabled !== false && Boolean(statusPageId),
    staleTime: 1000 * 10,
    // Keep polling until the domain is live (or failed terminally); stop once
    // active to avoid needless DNS lookups.
    refetchInterval: (query) =>
      query.state.data?.provisionStatus === "active" ? false : 1000 * 15,
  });
}

/** Remove the custom domain from a page. */
export function useDetachStatusPageDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ statusPageId }: { statusPageId: string }) =>
      UptimeService.detachStatusPageDomain(statusPageId),
    onSuccess: (_res, { statusPageId }) => {
      queryClient.invalidateQueries({
        queryKey: uptimeKeys.statusPages.detail(statusPageId),
      });
      queryClient.invalidateQueries({ queryKey: uptimeKeys.statusPages.lists() });
    },
  });
}

/** Resolve a published page publicly by per-user (userId, slug). */
export function usePublicStatusPageBySlug(
  userId: string,
  slug: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: uptimeKeys.public.bySlug(userId, slug),
    queryFn: () => UptimeService.getStatusPageBySlug(userId, slug),
    enabled: options?.enabled !== false && Boolean(userId) && Boolean(slug),
    retry: false,
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
  });
}

/** Resolve a published page publicly by verified custom-domain Host. */
export function usePublicStatusPageByDomain(
  host: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: uptimeKeys.public.byDomain(host),
    queryFn: () => UptimeService.getStatusPageByDomain(host),
    enabled: options?.enabled !== false && Boolean(host),
    retry: false,
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
  });
}
