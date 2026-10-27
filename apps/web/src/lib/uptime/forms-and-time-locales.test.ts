import { formattingLocale } from "@/lib/formatting-locale";
import { createInstance } from "i18next";
import { formatCount } from "@/lib/count-format";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const locales = ["en", "ar", "fr", "de", "es"];
const keys = ["tags.duplicate", "heartbeat.never", "heartbeat.received", "heartbeat.lastEvaluated", "heartbeat.lastEvaluatedHint", "heartbeat.stateDown", "heartbeat.stateAwaitingSuccess", "metrics.averageBasis", "notifications.fields.webhookHeadersInvalid", "list.checkNowUnavailableHeartbeat", "list.checkNowUnavailableServer", "actions.checkNow", "actions.deleteMonitor", "actions.monitorType", "actions.otherWaysToAdd", "quickAdd.button", "bulkAdd.button", "templates.use", "detailUX.recoveryThresholdLabel", "detailUX.degradedThresholdLabel", "slaReport.successfulChecks", "slaReport.email.verifiedProviderRequired", "slaReport.email.savedInactiveProvider", "slaReport.email.setupProvider", "overview.uptimeBar.date"];
const dictionary = (locale: string) => JSON.parse(readFileSync(`public/locales/${locale}/uptimeMonitor.json`, "utf8"));
const value = (data: Record<string, unknown>, key: string): string => key.split(".").reduce<unknown>((entry, segment) => (entry as Record<string, unknown>)[segment], data) as string;
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort();

describe("monitor form and heartbeat time translations", () => {
  it("uses sentence case for the English monitor action menu", () => {
    const english = dictionary("en");
    expect(value(english, "actions.monitorType")).toBe("Monitor type");
    expect(value(english, "actions.otherWaysToAdd")).toBe("Other ways to add");
    expect(value(english, "quickAdd.button")).toBe("Quick add");
    expect(value(english, "bulkAdd.button")).toBe("Bulk add");
    expect(value(english, "templates.use")).toBe("Create from template");
  });
  it.each(locales)("has all feedback/state labels and matching interpolation keys in %s", locale => {
    const english = dictionary("en"); const translated = dictionary(locale);
    for (const key of keys) {
      const text = value(translated, key);
      expect(text, key).toEqual(expect.any(String));
      expect(text.trim(), key).not.toBe("");
      expect(text, key).not.toBe(key);
      expect(placeholders(text), key).toEqual(placeholders(value(english, key)));
    }
  });
});


it.each(locales)("has every recorded-check plural category in %s", locale => {
  const translated = dictionary(locale);
  for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
    const text = value(translated, `overview.uptimeBar.recordedChecks_${category}`);
    expect(text).toEqual(expect.any(String));
    expect(placeholders(text)).toEqual(["formattedCount"]);
  }
});


it.each(locales)("formats recorded-check counts with actual translations in %s", async locale => {
  const i18n = createInstance();
  const translation = dictionary(locale);
  await i18n.init({ lng: locale, resources: { [locale]: { translation } }, interpolation: { escapeValue: false } });
  for (const count of [0, 1, 2, 3, 11, 100, 170]) {
    const category = new Intl.PluralRules(locale).select(count);
    const numeral = new Intl.NumberFormat(formattingLocale(locale)).format(count);
    const formatted = formatCount(i18n.t.bind(i18n), "overview.uptimeBar.recordedChecks", count, locale);
    expect(formatted).toBe(value(translation, `overview.uptimeBar.recordedChecks_${category}`).replace("{{formattedCount}}", numeral));
    expect(formatted).not.toMatch(/\{\{|recordedChecks_/);
  }
});
