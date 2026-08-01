/**
 * Presentation helpers for the monitor list: health-aware sorting, response-time
 * color tone, and relative "last checked" formatting. Pure and locale-driven so
 * the dashboard and its tests stay in sync.
 *
 * @module lib/uptime/format
 */

import type { UptimeMonitor } from "@/types/uptime";

export type SortField = "status" | "name" | "response" | "uptime";
export type SortDir = "asc" | "desc";

/**
 * Health priority for the default sort — the worse the state, the higher it
 * pins. Unknown statuses fall into the "pending" tier.
 */
const HEALTH_ORDER: Record<string, number> = {
	down: 0,
	degraded: 1,
	pending: 2,
	up: 3,
};

function healthRank(status: string): number {
	// Unknown statuses fall into the "pending" tier (2).
	return HEALTH_ORDER[status] ?? 2;
}

/**
 * Order two nullable numbers so `null` always sorts last regardless of
 * direction. Returns the comparison when either side is null, or `null` when
 * both are present (the caller applies the direction-aware numeric compare).
 */
function nullOrder(a: number | null, b: number | null): number | null {
	if (a == null && b == null) return 0;
	if (a == null) return 1;
	if (b == null) return -1;
	return null;
}

/**
 * Comparator for the monitor table.
 *
 * With no `sort` field it applies the default health sort (down → degraded →
 * pending → up, tie-broken by name) so problems pin to the top. With a `sort`
 * field it sorts by that column honoring `dir`, keeping `null` metric values
 * last in both directions.
 */
export function compareMonitors(
	a: UptimeMonitor,
	b: UptimeMonitor,
	sort?: SortField,
	dir: SortDir = "asc",
): number {
	if (!sort) {
		const byHealth = healthRank(a.status) - healthRank(b.status);
		return byHealth !== 0 ? byHealth : a.name.localeCompare(b.name);
	}

	const mul = dir === "desc" ? -1 : 1;

	switch (sort) {
		case "name":
			return a.name.localeCompare(b.name) * mul;
		case "status":
			return (healthRank(a.status) - healthRank(b.status)) * mul;
		case "response": {
			const nn = nullOrder(a.responseTime, b.responseTime);
			if (nn !== null) return nn;
			return ((a.responseTime as number) - (b.responseTime as number)) * mul;
		}
		default: {
			// "uptime"
			const nn = nullOrder(a.uptimePercentage, b.uptimePercentage);
			if (nn !== null) return nn;
			return (
				((a.uptimePercentage as number) - (b.uptimePercentage as number)) * mul
			);
		}
	}
}

export type ResponseTone = "good" | "warn" | "bad";

/**
 * Bucket a response time so slow responders stand out: < 300ms good, < 1000ms
 * warn, otherwise bad. `null` (no measurement yet) returns `null`.
 */
export function responseTimeTone(ms: number | null): ResponseTone | null {
	if (ms == null) return null;
	if (ms < 300) return "good";
	if (ms < 1000) return "warn";
	return "bad";
}

/**
 * Format an ISO timestamp as a locale-aware relative time (e.g. "5 seconds
 * ago"). Returns "—" for null/invalid input. `now` is injectable for tests.
 */
export function formatRelativeTime(
	iso: string | null,
	locale: string,
	now: number = Date.now(),
): string {
	if (!iso) return "—";
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "—";

	const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	const diffSec = Math.round((then - now) / 1000);

	if (Math.abs(diffSec) < 60) return rtf.format(diffSec, "second");
	const diffMin = Math.round(diffSec / 60);
	if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
	const diffHr = Math.round(diffSec / 3600);
	if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
	const diffDay = Math.round(diffSec / 86400);
	return rtf.format(diffDay, "day");
}
