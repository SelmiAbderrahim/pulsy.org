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
 * name, url, or any of its tags. An empty/whitespace query returns the list
 * unchanged.
 */
export function filterMonitors(
	monitors: UptimeMonitor[],
	query: string,
): UptimeMonitor[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return monitors;

	return monitors.filter((m) => {
		if (m.name.toLowerCase().includes(needle)) return true;
		if (m.url.toLowerCase().includes(needle)) return true;
		return (m.tags ?? []).some((tag) => tag.toLowerCase().includes(needle));
	});
}
