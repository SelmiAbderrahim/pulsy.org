import { formattingLocale } from "@/lib/formatting-locale";
import { browserTimezone, isValidTimezone } from "@pulsy/db/timezone";

export function dateTimeFormat(locale: string, timezone = browserTimezone(), options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "medium" }) {
  return new Intl.DateTimeFormat(formattingLocale(locale), { ...options, timeZone: isValidTimezone(timezone) ? timezone : "UTC" });
}

export function formatDate(value: string | number | Date | null, locale: string, timezone?: string, options?: Intl.DateTimeFormatOptions): string {
  if (value == null) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateTimeFormat(locale, timezone, options).format(date) : "—";
}

/** IANA identity plus the localized UTC offset at the time being displayed. */
export function formatTimezone(timezone: string, locale: string, at: Date | number = Date.now()): string {
  const zone = isValidTimezone(timezone) ? timezone : "UTC";
  const offset = dateTimeFormat(locale, zone, { timeZoneName: "shortOffset" })
    .formatToParts(at).find(part => part.type === "timeZoneName")?.value;
  return `${zone} (${offset})`;
}

/** Keep both complete dates: compact Intl ranges can hide a date or timezone. */
export function formatDateRange(start: string | number | Date, end: string | number | Date, locale: string, timezone?: string): string {
  const from = formatDate(start, locale, timezone, { dateStyle: "full", timeStyle: "long" });
  const to = formatDate(end, locale, timezone, { dateStyle: "full", timeStyle: "long" });
  return from === "—" || to === "—" ? "—" : `${from} – ${to}`;
}

function inputParts(value: Date | number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, calendar: "iso8601", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === name)!.value;
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

/** Native datetime-local fields contain wall time in the explicitly named account zone. */
export function formatDateTimeInput(value: string | number | Date, timezone: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && isValidTimezone(timezone) ? inputParts(date, timezone).slice(0, 16) : "";
}

/** Reject nonexistent and repeated wall times rather than silently choosing an offset. */
export function parseDateTimeInput(value: string, timezone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !isValidTimezone(timezone)) return null;
  const wall = `${value}:00`;
  const nominal = Date.parse(`${wall}Z`);
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 19) !== wall) return null;
  // Sample the offsets on both sides of any nearby transition, including
  // fractional-hour changes and skipped calendar dates. Confirm every candidate
  // by formatting it back into the same zone; exactly one instant must match.
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = nominal + hours * 3_600_000;
    const local = Date.parse(`${inputParts(sample, timezone)}Z`);
    if (Number.isFinite(local)) offsets.add(local - sample);
  }
  const matches = [...offsets].map(offset => nominal - offset).filter(candidate => inputParts(candidate, timezone) === wall);
  return matches.length === 1 ? new Date(matches[0]!).toISOString() : null;
}
