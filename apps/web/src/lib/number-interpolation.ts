import { formattingLocale } from "@/lib/formatting-locale";
import type { FormatterModule, InterpolationOptions } from "i18next";

/** Only quantities are localized automatically; identifiers and calendar years stay literal. */
const quantityKeys = new Set([
  "count", "days", "hours", "minutes", "seconds", "milliseconds", "attempts",
  "added", "removed", "existing", "total", "used", "max", "min", "minimum", "limit",
  "current", "resulting", "shown", "remaining", "failed", "failures", "success", "skipped",
  "valid", "up", "down", "degraded", "healthy", "resolved", "incidents", "monitors",
  "threshold", "latency", "cooldown", "recovery", "slow", "timeout", "requested",
]);

export const numberInterpolation: InterpolationOptions = { escapeValue: false, alwaysFormat: true };

export function formatInterpolatedValue(value: unknown, format?: string, language = "en", options?: { interpolationkey?: unknown }): string {
  const quantity = format === "number" || (!format && quantityKeys.has(typeof options?.interpolationkey === "string" ? options.interpolationkey : ""));
  return quantity && typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat(formattingLocale(language)).format(value)
    : String(value ?? "");
}

/** Install before interpolation is initialized; later wrappers miss its bound formatter. */
export const numberFormatting: FormatterModule = {
  type: "formatter",
  init() {},
  add(name, format) { additionalFormats.set(name, format); },
  addCached(name, factory) {
    additionalFormats.set(name, (value, language, options) => factory(language, options)(value));
  },
  format(value, format, language, options) {
    const extra = format ? additionalFormats.get(format) : undefined;
    return extra ? extra(value, language, options) : formatInterpolatedValue(value, format, language, { interpolationkey: options?.interpolationkey });
  },
};
const additionalFormats = new Map<string, Parameters<FormatterModule["add"]>[1]>();
