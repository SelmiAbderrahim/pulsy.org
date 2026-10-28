import { formattingLocale } from "@/lib/formatting-locale";
import { readFileSync } from "node:fs";
import { createInstance } from "i18next";
import { expect, it } from "vitest";
import { formatCount } from "@/lib/count-format";
it.each(["en", "ar", "fr", "de", "es"])("provides complete, localized panel count plurals in %s", async locale => {
  const translation = JSON.parse(readFileSync(`public/locales/${locale}/uptimeMonitor.json`, "utf8"));
  const i18n = createInstance(); await i18n.init({ lng: locale, resources: { [locale]: { translation } } });
  for (const path of ["notificationUX.overrideCount", "templates.rulesCount"]) {
    const [group, key] = path.split(".");
    for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) expect(translation[group!][`${key}_${category}`]).toContain("{{formattedCount}}");
    for (const count of [0, 1, 2, 3, 11, 100]) {
      const value = formatCount(i18n.t.bind(i18n), path, count, locale);
      expect(value).toContain(new Intl.NumberFormat(formattingLocale(locale)).format(count));
      expect(value).not.toMatch(/\{\{|overrideCount|rulesCount/);
    }
  }
  if (locale === "en") {
    expect(i18n.t("notificationSettings.title")).toBe("Notification settings");
    expect(i18n.t("notificationSettings.defaults.title")).toBe("Default channels");
    expect(i18n.t("emailProviders.title")).toBe("Email providers");
    expect(i18n.t("notificationUX.overrides")).toBe("Monitor overrides");
    expect(i18n.t("apiKeys.title")).toBe("API keys");
    expect(formatCount(i18n.t.bind(i18n), "notificationUX.overrideCount", 1, locale)).toBe("1 override channel");
    expect(formatCount(i18n.t.bind(i18n), "templates.rulesCount", 0, locale)).toBe("0 assertion rules");
  }
});
