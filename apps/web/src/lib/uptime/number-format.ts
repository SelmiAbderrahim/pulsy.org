import { formattingLocale } from "@/lib/formatting-locale";
/**
 * One place for how Pulsy prints percentages and timings, so the same underlying
 * value reads the same in every layout (percentages always have two decimal places).
 *
 * @module lib/uptime/number-format
 */

import { formatDateRange } from "@/lib/date-format";

export { formatPercent } from "@pulsy/db/percent-format";

/**
 * A quantity and its unit never wrap apart: ordinary spaces inside one
 * formatted measurement become no-break spaces. Applies to plain strings too
 * (titles, interpolations, chart labels), not only to `<Unit>` renders.
 */
export function keepTogether(text: string): string {
  return text.replace(/ /g, "\u00a0");
}

/** Rounded compound durations; exact units retain their readable long form. */
export function formatSeconds(value: number | null | undefined, locale: string): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  let remaining = Math.round(value);
  const parts: Array<{ unit: string; value: number }> = [];
  for (const [unit, size] of [["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]] as const) {
    const quantity = Math.floor(remaining / size);
    if (quantity || (unit === "second" && !parts.length)) parts.push({ unit, value: quantity });
    remaining %= size;
  }
  return parts.map(part => keepTogether(new Intl.NumberFormat(formattingLocale(locale), { style: "unit", unit: part.unit, unitDisplay: parts.length === 1 ? "long" : "short", maximumFractionDigits: 0 }).format(part.value))).join(" ");
}

/**
 * Format a millisecond timing as a grouped, localized quantity ("10,000 ms"). `null` when unusable.
 * Arabic uses the Latin technical symbol "ms" beside its Latin digits: the CLDR
 * abbreviation ("ملي ث") is two words and read as a broken unit in compact cells.
 */
export function formatMilliseconds(value: number | null | undefined, locale: string): string | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
	const formattingTag = formattingLocale(locale);
	if (new Intl.Locale(formattingTag).language === "ar") {
		return `${new Intl.NumberFormat(formattingTag, { maximumFractionDigits: 2 }).format(value)}\u00a0ms`;
	}
	return keepTogether(new Intl.NumberFormat(formattingTag, { style: "unit", unit: "millisecond", unitDisplay: "short", maximumFractionDigits: 2 }).format(value));
}

/** Localized compact units, rounded to the nearest second, for elapsed durations. */
export function formatCompactDuration(value: number | null | undefined, locale: string): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  let remaining = Math.round(value);
  const parts: string[] = [];
  for (const [unit, size] of [["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]] as const) {
    const quantity = Math.floor(remaining / size);
    if (quantity || (unit === "second" && !parts.length)) {
      parts.push(keepTogether(new Intl.NumberFormat(formattingLocale(locale), { style: "unit", unit, unitDisplay: "narrow", maximumFractionDigits: 0 }).format(quantity)));
    }
    remaining %= size;
  }
  return parts.join(" ");
}

/** Pair with a compact duration's title/tooltip; do not round away raw seconds. */
export function formatDurationExact(
  value: number | null | undefined,
  locale: string,
  range?: { start?: string | number | Date | null; end?: string | number | Date | null; timezone?: string },
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const formatter = new Intl.NumberFormat(formattingLocale(locale), { style: "unit", unit: "second", unitDisplay: "long", maximumFractionDigits: 20 });
  const parts = formatter.formatToParts(value);
  const units = parts.map(part => part.value).join("");
  // Arabic singular and dual long units can omit the numeral entirely. Exact
  // details must still expose the numeric value, independently of that grammar.
  const seconds = parts.some(part => part.type === "integer")
    ? units
    : `${new Intl.NumberFormat(formattingLocale(locale), { maximumFractionDigits: 20 }).format(value)} ${units}`;
  if (range?.start == null || range.end == null) return seconds;
  const dates = formatDateRange(range.start, range.end, locale, range.timezone);
  return dates === "—" ? seconds : `${seconds} · ${dates}`;
}

/** Full values for labels/tooltips; missing data stays missing. */
export function formatNumber(value: number | null | undefined, locale: string, options?: Intl.NumberFormatOptions): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat(formattingLocale(locale), options).format(value);
}

/** Chart ticks use locale-specific compact notation (English: 6k). */
export function formatNumberTick(value: number | null | undefined, locale: string): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const formatter = new Intl.NumberFormat(formattingLocale(locale), { notation: "compact", maximumFractionDigits: 1 });
  return formatter.formatToParts(value).map(part => part.type === "compact" && part.value === "K" ? "k" : part.value).join("");
}
