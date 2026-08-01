/**
 * Bulk Uptime Actions Hook
 *
 * Provides bulk delete and pause/resume operations for uptime monitors.
 *
 * @module hooks/uptime/useBulkUptimeActions
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { uptimeKeys } from "./queryKeys";
import { UptimeService } from "@/services/uptime/uptimeService";

interface BulkActiveItem {
	uptimeMonitorId: string;
	active: boolean;
}

export function useBulkUptimeActions() {
	const queryClient = useQueryClient();
	const [isProcessing, setIsProcessing] = useState(false);

	const deleteMultiple = useCallback(
		async (ids: string[]) => {
			setIsProcessing(true);
			const results = {
				successful: [] as string[],
				failed: [] as { id: string; error: unknown }[],
			};

			for (const id of ids) {
				try {
					await UptimeService.deleteMonitor(id);
					results.successful.push(id);
				} catch (error) {
					results.failed.push({ id, error });
				}
			}

			queryClient.invalidateQueries({
				queryKey: uptimeKeys.monitors.lists(),
			});
			queryClient.invalidateQueries({
				queryKey: uptimeKeys.dashboard.summary(),
			});
			setIsProcessing(false);
			return results;
		},
		[queryClient],
	);

	const setActiveMultiple = useCallback(
		async (items: BulkActiveItem[], active: boolean) => {
			setIsProcessing(true);
			const results = {
				successful: [] as string[],
				failed: [] as { id: string; error: unknown }[],
			};

			for (const item of items) {
				try {
					if (item.active !== active) {
						await UptimeService.toggleActive(item.uptimeMonitorId);
					}
					results.successful.push(item.uptimeMonitorId);
				} catch (error) {
					results.failed.push({ id: item.uptimeMonitorId, error });
				}
			}

			queryClient.invalidateQueries({
				queryKey: uptimeKeys.monitors.lists(),
			});
			queryClient.invalidateQueries({
				queryKey: uptimeKeys.dashboard.summary(),
			});
			setIsProcessing(false);
			return results;
		},
		[queryClient],
	);

	return { deleteMultiple, setActiveMultiple, isProcessing };
}
