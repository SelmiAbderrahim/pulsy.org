import { formattingLocale } from "@/lib/formatting-locale";
import i18next from "i18next";
import { describe, expect, it } from "vitest";
import { numberFormatting, numberInterpolation } from "./number-interpolation";

describe("quantity-aware interpolation", () => {
  it.each(["en", "ar", "fr", "de", "es"])("localizes quantities without changing years or numeric identifiers in %s", async locale => {
    const i18n = i18next.createInstance().use(numberFormatting);
    await i18n.init({ lng: locale, fallbackLng: false, resources: { [locale]: { test: { quantity: "{{count}}", identifier: "{{id}}", status: "{{status}}", year: "© {{year}} Pulsy", version: "Policy {{version}}", explicit: "{{value, number}}" } } }, interpolation: numberInterpolation });
    expect(i18n.t("test:year", { year: 2026 })).toContain("2026");
    expect(i18n.t("test:version", { version: 1234 })).toContain("1234");
    expect(i18n.t("test:identifier", { id: 1234 })).toBe("1234");
    expect(i18n.t("test:status", { status: 200 })).toBe("200");
    expect(i18n.t("test:quantity", { count: 1234 })).toBe(new Intl.NumberFormat(formattingLocale(locale)).format(1234));
    expect(i18n.t("test:explicit", { value: 1234 })).toBe(new Intl.NumberFormat(formattingLocale(locale)).format(1234));
  });
});
