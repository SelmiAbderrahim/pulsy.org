import { formattingLocale } from "@/lib/formatting-locale";
/**
 * Presentation helpers for the monitor list: health-aware sorting, response-time
 * color tone, and relative "last checked" formatting. Pure and locale-driven so
 * the dashboard and its tests stay in sync.
 *
 * @module lib/uptime/format
 */

import type { UptimeMonitor } from "@/types/uptime";
import i18next from "i18next";
import { formatCount } from "@/lib/count-format";
import { checkErrorCodeOf } from "@pulsy/db/check-error";

export type SortField = "status" | "name" | "response" | "uptime";
export type SortDir = "asc" | "desc";

/**
 * Health priority for the default sort — the worse the state, the higher it
 * pins. Unknown statuses fall into the "pending" state.
 */
const HEALTH_ORDER: Record<string, number> = {
	down: 0,
	degraded: 1,
	pending: 2,
	up: 3,
};

function healthRank(status: string): number {
	// Unknown statuses fall into the "pending" state (2).
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
 * last in both directions. Heartbeats have no response time (null, so last) and sort
 * by check success like every other type; their dates are never a sort key.
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
			// Unknown stays last in either direction; name/id make equal values stable.
			const nn = nullOrder(a.uptimePercentage, b.uptimePercentage);
			const metric = nn ?? ((a.uptimePercentage as number) - (b.uptimePercentage as number)) * mul;
			return metric || a.name.localeCompare(b.name) || a.uptimeMonitorId.localeCompare(b.uptimeMonitorId);
		}
	}
}

export type ResponseTone = "good" | "warn" | "bad";

/**
 * Latency worth showing for a check: failed HTTP checks that got no response
 * (time-to-failure, or legacy rows that stored it) have none.
 */
export function measuredLatency(check: { status: string; httpStatus: number | null; responseTime: number | null }, monitorType?: string): number | null {
  if (check.responseTime == null) return null;
  if (check.status === "down" && check.httpStatus == null && (!monitorType || monitorType === "http")) return null;
  return check.responseTime;
}

/**
 * Bucket a response time so slow responders stand out: < 300ms good, < 1000ms
 * warn, otherwise bad. `null` (no measurement yet) returns `null`. A Down
 * monitor is never "good", whatever its last timing.
 */
export function responseTimeTone(ms: number | null, status?: string): ResponseTone | null {
	if (status === "down") return "bad";
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

	const rtf = new Intl.RelativeTimeFormat(formattingLocale(locale), { numeric: "auto" });
	const diffSec = Math.min(0, Math.round((then - now) / 1000));

	if (Math.abs(diffSec) < 60) return rtf.format(diffSec, "second");
	const diffMin = Math.round(diffSec / 60);
	if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
	const diffHr = Math.round(diffSec / 3600);
	if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
	const diffDay = Math.round(diffSec / 86400);
	return rtf.format(diffDay, "day");
}

/** Context that fills taxonomy labels: the row's HTTP status and the monitor timeout. */
export interface CheckReasonContext { httpStatus?: number | null; timeoutMs?: number | null }
type ReasonTranslator = (key: string, options: { actual: string; threshold: string; metric?: string; seconds?: string; status?: string }) => string;

/**
 * One code → label mapping for stored check reasons (History, Incidents, alerts
 * preview, search): taxonomy codes from `@pulsy/db/check-error` (and legacy English
 * messages mapped to them), heartbeat codes, server-health reports and latency
 * causes are localized; other free text is returned unchanged. Never renders a raw enum.
 */
export function formatLatencyReason(reason: string | null, t: ReasonTranslator, context: CheckReasonContext = {}): string {
  if (reason?.startsWith("server_health:")) {
    const options = { actual: "", threshold: "" };
    try {
      const report: unknown = JSON.parse(reason.slice(14));
      if (typeof report !== "object" || !report) return t("server.pressure", options);
      const value = report as { status?: unknown; conditions?: unknown };
      if (value.status === "down") return t("server.missing", options);
      if (value.status === "up") return t("server.healthy", options);
      if (!Array.isArray(value.conditions)) return t("server.pressure", options);
      const lines = value.conditions.slice(0, 4).flatMap((condition: unknown) => {
        if (typeof condition !== "object" || !condition) return [];
        const c = condition as { key?: unknown; value?: unknown; threshold?: unknown };
        if (typeof c.key !== "string" || c.key.length > 520 || typeof c.threshold !== "number" || !Number.isFinite(c.threshold)) return [];
        const metric = c.key.startsWith("disk:") ? c.key.slice(5) : t(c.key === "cpu" ? "server.cpu" : "server.memory", options);
        return [t("server.condition", { metric, actual: typeof c.value === "number" && Number.isFinite(c.value) ? String(Math.round(c.value * 10) / 10) : t("server.unavailable", options), threshold: String(c.threshold) })];
      });
      return lines.join("; ") || t("server.pressure", options);
    } catch { return t("server.pressure", options); }
  }
  const code = checkErrorCodeOf(reason);
  const none = { actual: "", threshold: "" };
  if (code?.startsWith("heartbeat_")) return t(`heartbeat.${code}`, none);
  if (code === "blocked_target") return t("egress.checkBlocked", none);
  if (code === "response_timeout") return context.timeoutMs && context.timeoutMs > 0 ? t("checkErrors.response_timeout", { ...none, seconds: String(Math.round(context.timeoutMs / 100) / 10) }) : t("checkErrors.response_timeout_unknown", none);
  if (code === "unexpected_status" && context.httpStatus) return t("checkErrors.unexpected_status_code", { ...none, status: String(context.httpStatus) });
  if (code) return t(`checkErrors.${code}`, none);
  const match = reason?.match(/^Response time ([0-9]{1,8}(?:\.[0-9]{1,6})?) ms exceeds ([0-9]{1,5}) ms$/);
  return match ? t("latency.cause", { actual: match[1]!, threshold: match[2]! }) : reason ?? "—";
}

/** Active probe monitor whose first check is queued or running (shown as "Checking…", not Pending). */
export function isAwaitingFirstCheck(monitor: Pick<UptimeMonitor, "active" | "status" | "lastCheckedAt" | "monitorType">): boolean {
  return monitor.active && monitor.status === "pending" && !monitor.lastCheckedAt && monitor.monitorType !== "heartbeat" && monitor.monitorType !== "server";
}

/** Same stored-observation window as the private Prometheus representation.
 * A stale observation is context, never a change to measured health.
 */
export function isStaleObservation(monitor: UptimeMonitor, now = Date.now()): boolean {
  if (!monitor.active || monitor.status === "pending" || !monitor.lastCheckedAt) return false;
  // Heartbeats also evaluate on cadence; a late deadline needs attention even
  // before the general stale window (two intervals) elapses.
  if (monitor.monitorType === "heartbeat" && monitor.nextCheckAt != null && now > Date.parse(monitor.nextCheckAt) + 10_000) return true;
  const last = Date.parse(monitor.lastCheckedAt);
  if (!Number.isFinite(last)) return true;
  const recent = Math.max(0, now - last) <= monitor.interval * 2_000 + monitor.timeout;
  return !recent;
}


type IntervalTranslator = (key: string, options: { count: number; formattedCount: string; defaultValue: string }) => string;

/** One interval label for list/cards/detail, with localized digits and grammar. */
export function formatInterval(seconds: number, t: IntervalTranslator, locale = i18next.resolvedLanguage ?? i18next.language ?? "en"): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const [unit, size]: readonly [string, number] = seconds > 0
    ? ([["day", 86400], ["hour", 3600], ["minute", 60]] as const).find(([, scale]) => seconds % scale === 0) ?? ["second", 1]
    : ["second", 1];
  const count = seconds / size;
  const fallback = new Intl.NumberFormat(formattingLocale(locale), { style: "unit", unit, unitDisplay: "long", maximumFractionDigits: 20 }).format(count);
  return formatCount((key, options) => t(key, { ...options, defaultValue: fallback }), `intervals.${unit}`, count, locale);
}
