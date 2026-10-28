import { formattingLocale } from "@/lib/formatting-locale";
type CountTranslator = (key: string, options: { count: number; formattedCount: string }) => string;

/**
 * Select a complete i18n plural family while keeping localized digits separate
 * from the numeric value used for grammatical selection. New families use
 * {{formattedCount}} so this also works outside the app's interpolation setup.
 */
export function formatCount(t: CountTranslator, key: string, count: number, locale: string): string {
  if (!Number.isFinite(count) || count < 0) return "—";
  const category = new Intl.PluralRules(locale).select(count);
  return t(`${key}_${category}`, { count, formattedCount: new Intl.NumberFormat(formattingLocale(locale)).format(count) });
}
