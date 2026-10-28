import type { UptimeMonitor } from "@/types/uptime";
import { matchesViewTags } from "@/lib/uptime/monitor-views";
import { filterMonitors } from "@/lib/uptime/search";
import { monitorCounterState } from "@/lib/uptime/monitor-summary";

export type MonitorListFilter = { tags: string[]; tagMode: "any" | "all"; status?: string; search?: string };

/** One filter for the list rows and the dashboard result count, so they cannot disagree. */
export function filterMonitorList(monitors: UptimeMonitor[], { tags, tagMode, status, search }: MonitorListFilter): UptimeMonitor[] {
	const byTag = tags.length > 0 ? monitors.filter(monitor => matchesViewTags(monitor, tags, tagMode)) : monitors;
	const byStatus = status ? byTag.filter(monitor => monitorCounterState(monitor) === status) : byTag;
	return search ? filterMonitors(byStatus, search) : byStatus;
}
