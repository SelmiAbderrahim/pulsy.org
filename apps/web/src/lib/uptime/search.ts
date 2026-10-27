/**
 * Client-side monitor matching shared by the dashboard inline filter and the
 * command palette so both surfaces behave identically. Monitors are already
 * fully loaded client-side, so matching is done in memory (no network).
 *
 * @module lib/uptime/search
 */

import type { UptimeMonitor } from "@/types/uptime";

/**
 * Filter monitors by a case-insensitive substring match against the monitor
 * name, URL, network hostname/port/record type, or tags. An empty/whitespace
 * query returns the list unchanged.
 */
export function filterMonitors(
	monitors: UptimeMonitor[],
	query: string,
): UptimeMonitor[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return monitors;

	return monitors.filter((m) => {
		const network = m.networkConfig;
		const networkFields = network
			? [network.hostname, network.type === "tcp" ? String(network.port) : network.recordType,
				network.type === "tcp" ? `${network.hostname}:${network.port}` : ""]
			: [];
		return [m.name, m.url, ...networkFields, ...(m.tags ?? [])]
			.some(field => field.toLowerCase().includes(needle));
	});
}
