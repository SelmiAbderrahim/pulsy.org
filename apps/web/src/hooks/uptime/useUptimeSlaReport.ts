/**
 * SLA report hooks — on-demand report data and monthly-email subscriptions.
 *
 * @module hooks/uptime/useUptimeSlaReport
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { UptimeService } from "@/services/uptime/uptimeService";
import type { UpsertSlaReportSubscriptionInput } from "@/types/uptime";

import { uptimeKeys } from "./queryKeys";

/**
 * Fetch the on-demand SLA report for a monitor over a rolling window.
 */
export function useUptimeSlaReport(
	monitorId: string,
	days = 30,
	options?: { enabled?: boolean },
) {
	return useQuery({
		queryKey: uptimeKeys.slaReports.detail(monitorId, days),
		queryFn: () => UptimeService.getSlaReport(monitorId, days),
		enabled: options?.enabled !== false && Boolean(monitorId),
		staleTime: 1000 * 60 * 5, // 5 minutes
	});
}

/**
 * List the current user's monthly-email SLA subscriptions.
 */
export function useUptimeSlaReportSubscriptions(options?: {
	enabled?: boolean;
}) {
	return useQuery({
		queryKey: uptimeKeys.slaReports.subscriptions(),
		queryFn: () => UptimeService.listSlaReportSubscriptions(),
		enabled: options?.enabled !== false,
		staleTime: 1000 * 30,
	});
}

/**
 * Create or update a monthly-email subscription.
 */
export function useUpsertUptimeSlaReportSubscription() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: UpsertSlaReportSubscriptionInput) =>
			UptimeService.upsertSlaReportSubscription(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: uptimeKeys.slaReports.subscriptions(),
			});
		},
	});
}

/**
 * Delete a monthly-email subscription.
 */
export function useRemoveUptimeSlaReportSubscription() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (slaReportSubscriptionId: string) =>
			UptimeService.removeSlaReportSubscription(slaReportSubscriptionId),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: uptimeKeys.slaReports.subscriptions(),
			});
		},
	});
}

/**
 * Trigger an immediate send for a subscription (tests the monthly flow).
 */
export function useSendUptimeSlaReportNow() {
	return useMutation({
		mutationFn: (slaReportSubscriptionId: string) =>
			UptimeService.sendSlaReportNow(slaReportSubscriptionId),
	});
}
