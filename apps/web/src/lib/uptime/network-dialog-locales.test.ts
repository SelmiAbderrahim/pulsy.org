import { formattingLocale } from "@/lib/formatting-locale";
import { readFileSync } from "node:fs";
import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import { formatCount } from "@/lib/count-format";
const locales = ["en", "ar", "fr", "de", "es"];
const load = (locale: string, namespace = "uptimeMonitor") => JSON.parse(readFileSync(`public/locales/${locale}/${namespace}.json`, "utf8"));
const value = (data: Record<string, unknown>, path: string): string => path.split(".").reduce<unknown>((entry, part) => (entry as Record<string, unknown>)[part], data) as string;

describe("create-dialog translations", () => {
  it.each(locales)("uses a single interpolated timeout maximum and complete count plurals in %s", async locale => {
    const translation = load(locale);
    expect(value(translation, "network.timeoutHelp")).toContain("{{max}}");
    expect(value(translation, "bulkAdd.submitEmpty")).toBeTruthy();
    expect(value(translation, "httpStatuses.examplesLabel")).toBeTruthy();
    for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) expect(value(translation, `bulkAdd.submit_${category}`)).toContain("{{formattedCount}}");
    const i18n = createInstance();
    await i18n.init({ lng: locale, resources: { [locale]: { translation } } });
    for (const count of [0, 1, 2, 3, 11, 100]) {
      const label = formatCount(i18n.t.bind(i18n), "bulkAdd.submit", count, locale);
      expect(label).toContain(new Intl.NumberFormat(formattingLocale(locale)).format(count));
      expect(label).not.toMatch(/\{\{|bulkAdd.submit/);
    }
  });
  it.each(locales)("uses localized Example placeholders for create/edit fields in %s", locale => {
    const translation = load(locale);
    const prefix = value(translation, "formUX.example").replace("{{value}}", "").trim();
    for (const key of ["create.fields.namePlaceholder", "create.fields.urlPlaceholder", "quickAdd.namePlaceholder", "tags.placeholder", "bulkAdd.urlsPlaceholder", "notifications.fields.telegramTargetPlaceholder", "emailProviders.test.emailPlaceholder", "apiKeys.create.namePlaceholder"]) expect(value(translation, key).startsWith(prefix), key).toBe(true);
  });
});
