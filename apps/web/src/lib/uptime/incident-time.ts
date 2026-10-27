import { formatDate } from "@/lib/date-format";

/** One absolute presentation for a stored event time, including seconds.
 * Callers pass the event's own timestamp; schedule deadlines and observations
 * remain distinct even when they describe the same incident.
 */
export function formatIncidentTimestamp(value: string | number | Date | null | undefined, locale: string, timezone?: string): string {
  return formatDate(value ?? null, locale, timezone, { dateStyle: "medium", timeStyle: "medium" });
}
