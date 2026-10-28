import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { formatLatencyReason } from "./uptime/format";
const load = (locale: string) => JSON.parse(readFileSync(path.resolve(__dirname, `../../public/locales/${locale}/uptimeMonitor.json`), "utf8")) as { server: Record<string, string>; portability: { warning: { serverToken: string }; field: { thresholds: string; excludedFilesystems: string } } };
const en = load("en");
describe("server-health localization", () => {
  it.each(["en", "ar", "fr", "de", "es"])("ships complete UI and interpolation values in %s", locale => {
    const translated = load(locale);
    const family = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, "");
    expect([...new Set(Object.keys(translated.server).map(family))].sort()).toEqual([...new Set(Object.keys(en.server).map(family))].sort());
    if (locale === "ar") for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) expect(translated.server[`hours_${category}`]).toBeTruthy();
    for (const [key, value] of Object.entries(translated.server)) {
      expect(value.trim()).not.toBe(""); expect(value.match(/\{\{\w+\}\}/g)?.sort() ?? []).toEqual((en.server[key] ?? en.server[`${family(key)}_other`])?.match(/\{\{\w+\}\}/g)?.sort() ?? []);
    }
    expect(translated.portability.warning.serverToken).toBeTruthy(); expect(translated.portability.field.thresholds).toBeTruthy(); expect(translated.portability.field.excludedFilesystems).toBeTruthy();
    const t = (key: string, options: Record<string, string | undefined>) => (translated.server[key.replace("server.", "")] ?? key).replace(/\{\{(\w+)\}\}/g, (_, field: string) => options[field] ?? "");
    const text = formatLatencyReason('server_health:{"status":"degraded","conditions":[{"key":"disk:/data","value":95,"threshold":90}]}', t);
    expect(text).toContain("/data"); expect(text).toContain("95"); expect(text).toContain("90"); expect(text).not.toContain("server_health");
    expect(formatLatencyReason("server_health:invalid", t)).toBe(translated.server.pressure);
  });
});
