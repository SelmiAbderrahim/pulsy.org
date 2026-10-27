/**
 * Uptime Incident Search Hook - cross-monitor incident search for the
 * command palette.
 *
 * @module hooks/uptime/useIncidentSearch
 */

import { useQuery } from "@tanstack/react-query";
import { UptimeService } from "@/services/uptime/uptimeService";
import { uptimeKeys } from "./queryKeys";

/**
 * Search incidents across all of the current user's monitors. The query is
 * trimmed; the request is skipped (and cached results cleared) when empty.
 *
 * @param query - The (already debounced) search query
 * @param options - Optional `enabled` override
 */
export function useIncidentSearch(
	query: string,
	options?: { enabled?: boolean },
) {
	const trimmed = query.trim();
	return useQuery({
		queryKey: uptimeKeys.incidents.search(trimmed),
		// The signal lets the query cancel the request when the term changes or the palette closes.
		queryFn: ({ signal }) => UptimeService.searchIncidents(trimmed, signal),
		enabled: options?.enabled !== false && trimmed.length > 0,
		staleTime: 1000 * 30, // 30 seconds
	});
}
