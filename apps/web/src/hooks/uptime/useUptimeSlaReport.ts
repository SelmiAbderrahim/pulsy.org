/**
 * SLA report hooks — on-demand report data and monthly-email subscriptions.
 *
 * @module hooks/uptime/useUptimeSlaReport
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { UptimeService } from "@/services/uptime/uptimeService";
import type { UpsertSlaReportSubscriptionInput } from "@/types/uptime";

import { uptimeKeys } from "./queryKeys";
import { isSessionClientActive } from "@/lib/session-query-client";

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
		// Workers do not push completion events to the browser. Poll only while
		// this report is mounted, and revalidate when returning to it.
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: true,
		refetchInterval: 30_000,
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

/** Download and display exactly the server-produced snapshot, without client totals. */
export function useDownloadUptimeSlaReport(monitorId: string, days: number, timezone?: string) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: () => UptimeService.downloadSlaReport(monitorId, days, timezone),
		onSuccess: async ({ report, pdf }) => {
			if (!isSessionClientActive(client)) return;
			const queryKey = uptimeKeys.slaReports.detail(monitorId, days);
			await client.cancelQueries({ queryKey });
			if (!isSessionClientActive(client)) return;
			client.setQueryData(queryKey, report);
			const bytes = Uint8Array.from(atob(pdf), character => character.charCodeAt(0));
			const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `sla-report-${report.periodLabel}.pdf`;
			anchor.click();
			// Let the browser consume the blob before releasing it.
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
		},
	});
}
