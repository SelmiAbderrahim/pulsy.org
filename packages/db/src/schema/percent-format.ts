/** Keep Arabic grammar and date names while choosing Latin digits explicitly. */
export function formattingLocale(locale?: string): string {
  const selected = new Intl.Locale(locale ?? Intl.NumberFormat().resolvedOptions().locale);
  return selected.language === "ar"
    ? new Intl.Locale(selected, { numberingSystem: "latn" }).toString()
    : selected.toString();
}

/**
 * Display a 0–100 percentage with exactly two decimal places, shared by the
 * browser and reports. Never turn imperfect/nonzero values into 100%/0%.
 * Missing or invalid measurements stay missing; raw API values stay numeric.
 */
export function formatPercent(value: number | null | undefined, locale: string): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return null;
  let shown = Math.round(value * 100) / 100;
  if (value < 100 && shown >= 100) shown = 99.99;
  if (value > 0 && shown <= 0) shown = 0.01;
  return new Intl.NumberFormat(formattingLocale(locale), {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(shown / 100);
}
