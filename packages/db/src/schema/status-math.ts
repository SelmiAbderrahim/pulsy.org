/**
 * Public status math shared by the server projections and the browser.
 *
 * Availability answers "did the target answer correctly?": up and degraded
 * checks both count, because a degraded check is a correct but slow answer.
 * Slow share is the degraded fraction of the same denominator, so a degraded
 * monitor reads as ≈100% available with a separate slow-response indicator.
 * Check success (stats-service `checkSuccessPercent`) stays the stricter
 * "status === up" ratio used by owner dashboards and SLA reports.
 */

const percent = (part: number, total: number): number | null =>
  total > 0 ? Math.round((part / total) * 10000) / 100 : null;

/** (up + degraded) / checks with a result, 2 decimals; null without checks. */
export const availabilityPercent = (up: number, degraded: number, total: number): number | null =>
  percent(up + degraded, total);

/** degraded / checks with a result, 2 decimals; null without checks. */
export const slowSharePercent = (degraded: number, total: number): number | null =>
  percent(degraded, total);

export type OverallStatus = "operational" | "degraded" | "partial" | "outage" | "unknown";

interface OverallComponent { status: string; /** Per-component badge only; never affects the banner. */ maintenance?: boolean }

/**
 * One rule for every public surface (page banner, status.json, badge):
 * - no components or any pending component → unknown
 * - every component down → outage (major); components have no critical flag
 * - some but not all down → partial
 * - none down, some degraded → degraded
 * - otherwise → operational
 * Maintenance stays a per-component badge and does not change the banner.
 */
export function overallStatus(components: readonly OverallComponent[]): OverallStatus {
  if (components.length === 0) return "unknown";
  const down = components.filter(component => component.status === "down");
  if (down.length === components.length) return "outage";
  if (down.length > 0) return "partial";
  if (components.some(component => component.status === "degraded")) return "degraded";
  if (components.some(component => component.status === "pending")) return "unknown";
  return "operational";
}
