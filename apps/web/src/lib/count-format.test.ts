import { formattingLocale } from "@/lib/formatting-locale";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import { describe, expect, it } from "vitest";
import { formatCount } from "./count-format";

const units = ["monitor", "component", "check", "assertionRule", "overrideChannel", "selectedItem", "second", "minute", "hour", "day"];
async function translator(locale: string) {
  const instance = i18next.createInstance();
  const common = JSON.parse(readFileSync(`public/locales/${locale}/common.json`, "utf8"));
  await instance.init({ lng: locale, fallbackLng: false, resources: { [locale]: { common } }, defaultNS: "common", interpolation: { escapeValue: false } });
  return { t: instance.t.bind(instance), common };
}

describe("count formatting", () => {
  it.each(["en", "ar", "fr", "de", "es"])("resolves every count category and localizes numerals in %s", async locale => {
    const { t, common } = await translator(locale);
    for (const unit of units) {
      for (const count of [0, 1, 2, 3, 11, 100, 1000, 1_000_000]) {
        const text = formatCount(t, `format.${unit}`, count, locale);
        expect(text).not.toMatch(/format\.|\{\{/);
        expect(text).toContain(new Intl.NumberFormat(formattingLocale(locale)).format(count));
      }
      for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
        expect(common.format[`${unit}_${category}`]).toEqual(expect.any(String));
      }
    }
  });

  it("uses singular and plural nouns with the numeric count", async () => {
    const { t } = await translator("en");
    expect(formatCount(t, "format.monitor", 1, "en")).toBe("1 monitor");
    expect(formatCount(t, "format.monitor", 2, "en")).toBe("2 monitors");
    expect(formatCount(t, "format.monitor", 0, "en")).toBe("0 monitors");
  });

  it.each([
    [0, "مكوّن"], [1, "مكوّن"], [2, "مكوّنان"],
    [3, "مكوّنات"], [11, "مكوّنًا"], [100, "مكوّن"],
  ])("uses the Arabic category for %i", async (count, expected) => {
    const { t } = await translator("ar");
    expect(formatCount(t, "format.component", count as number, "ar")).toBe(`${new Intl.NumberFormat(formattingLocale("ar")).format(count as number)} ${expected}`);
  });

  it.each([NaN, Infinity, -1])("does not turn an unusable count %s into a statement", async count => {
    const { t } = await translator("en");
    expect(formatCount(t, "format.monitor", count, "en")).toBe("—");
  });
});
