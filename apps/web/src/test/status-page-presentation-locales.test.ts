import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const keys = ["statusPage.neutralTitle", "statusPage.notFound", "statusPage.unavailable", "statusPage.unavailableHelp", "statusPage.returnHome", "communication.retry", "communication.selectComponent", "statusUX.membershipCounts"];
function dictionary(locale: string) { return JSON.parse(readFileSync(`public/locales/${locale}/uptimeMonitor.json`, "utf8")); }
function value(data: Record<string, unknown>, key: string) { return key.split(".").reduce<unknown>((entry, segment) => (entry as Record<string, unknown>)[segment], data) as string; }
function placeholders(text: string) { return [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort(); }
it.each(["en", "ar", "fr", "de", "es"])("supplies neutral public headings and all affected presentation labels in %s", locale => {
  const english = dictionary("en"), translated = dictionary(locale);
  for (const key of keys) {
    const text = value(translated, key);
    expect(text, key).toEqual(expect.any(String));
    expect(text.trim(), key).not.toBe("");
    expect(placeholders(text), key).toEqual(placeholders(value(english, key)));
  }
  expect(translated.statusPage.neutralTitle).not.toBe(translated.statusPage.title);
});
