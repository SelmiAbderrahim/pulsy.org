import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const keys = ["unknown", "partial", "legend", "viewData", "dateUTC", "success", "checks", "loading", "error", "retry", "basis"];
describe("daily uptime explanations", () => {
  it.each(["en", "ar", "fr", "de", "es"])("has all required daily history labels in %s", locale => {
    const resources = JSON.parse(readFileSync(`public/locales/${locale}/uptimeMonitor.json`, "utf8"));
    for (const key of keys) expect(resources.overview.uptimeBar[key]).toEqual(expect.any(String));
    expect(resources.overview.uptimeBar.basis).toContain("UTC");
  });
});
