import { describe, expect, it } from "vitest";
import { canonicalMonitorTab, monitorTabSearch, monitorTabs } from "./monitor-tabs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("canonical monitor tabs", () => {
  it.each(monitorTabs)("retains %s", tab => expect(canonicalMonitorTab(tab)).toBe(tab));
  it("aliases Reports and defaults missing, explicit Overview and invalid values", () => {
    expect(canonicalMonitorTab("notifications")).toBe("alerts");
    expect(canonicalMonitorTab("slaReport")).toBe("reports");
    for (const value of [undefined, "overview", "unknown", "", null, {}, "constructor", "toString", "__proto__"]) expect(canonicalMonitorTab(value)).toBe("overview");
    expect(monitorTabSearch({tab:"reports",lng:"ar",returnTo:"/dashboard?q=api"})).toEqual({tab:"reports",lng:"ar",returnTo:"/dashboard?q=api"});
  });
  it.each(["en","ar","fr","de","es"])("every tab title exists without fallback in %s", locale => {
    const translations = JSON.parse(readFileSync(resolve(`public/locales/${locale}/uptimeMonitor.json`),"utf8"));
    for (const tab of monitorTabs) expect(translations.tabs[tab]).toEqual(expect.any(String));
    expect(`QA — ${translations.tabs[canonicalMonitorTab(undefined)]} | Pulsy`).toBe(`QA — ${translations.tabs.overview} | Pulsy`);
  });
});
