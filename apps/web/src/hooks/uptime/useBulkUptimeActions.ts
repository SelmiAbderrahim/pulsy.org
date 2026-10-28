import { changeCachedMonitors } from "./optimistic-cache";
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

      const rollback = await changeCachedMonitors(queryClient, ids, () => null);
      try {
        const response = await UptimeService.deleteMonitorsBulk(ids);
        for(const item of response) {
          if(item.status === "deleted") {
            results.successful.push(item.id);
            queryClient.removeQueries({queryKey:uptimeKeys.monitors.detail(item.id)});
          } else results.failed.push({id:item.id,error:new Error(item.reason)});
        }
        rollback(results.failed.map(item=>item.id));
      } catch(error) {
        rollback();
        results.failed = ids.map(id=>({id,error}));
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

      const rollback = await changeCachedMonitors(queryClient, items.map(item=>item.uptimeMonitorId), row=>({...row,active}));
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

      rollback(results.failed.map(item=>item.id));
      for (const id of results.successful) void queryClient.invalidateQueries({queryKey:uptimeKeys.monitors.detail(id)});

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
