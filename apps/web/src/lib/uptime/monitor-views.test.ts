import { describe, expect, it } from "vitest";
import { decodeViewTags, encodeViewTags, matchesViewTags, groupViewMonitors } from "./monitor-views";
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { carrySearch } from "./dashboard-search";
describe("saved-view tag and group semantics", () => {
  it("retains comma-containing and RTL tags across URL round-trips, while accepting old links", () => {
    const tags = ["Production", "client,one", "بيئة:اختبار"];
    expect(decodeViewTags(encodeViewTags(tags))).toEqual(tags);
    expect(decodeViewTags("Production,Production, staging ")).toEqual(["Production", "staging"]);
    expect(decodeViewTags({ unexpected: true })).toEqual([]);
    expect(decodeViewTags("x".repeat(4097))).toEqual([]);
  });
  it("makes any/all semantics explicit and preserves tag case", () => {
    const monitor = { tags: ["Production", "client:one"] };
    expect(matchesViewTags(monitor, ["Production", "missing"], "any")).toBe(true);
    expect(matchesViewTags(monitor, ["Production", "missing"], "all")).toBe(false);
    expect(matchesViewTags(monitor, ["production"], "any")).toBe(false);
    expect(matchesViewTags(monitor, [], "all")).toBe(true);
  });
  it("serializes native arrays exactly once and preserves punctuation, spaces and Unicode", () => {
    const tags = ["env:qa", "client,one", "two words", "بيئة:اختبار", "équipe", "a&b=c?#/+%", 'quote"slash\\'];
    const url = defaultStringifySearch({ tags: encodeViewTags([...tags, tags[0]!]) });
    expect(JSON.parse(new URLSearchParams(url).get("tags")!)).toEqual(tags);
    expect(carrySearch(defaultParseSearch(url)).tags).toEqual(tags);
    expect(carrySearch(carrySearch(defaultParseSearch(url)))).toEqual({ tags });
    expect(encodeViewTags([])).toBeUndefined();
    expect(encodeViewTags(["", " "])).toBeUndefined();
  });
  it("restores comma links, JSON arrays and the reported double-encoded URL", () => {
    const tags = ["env:qa", "qa-bug"];
    const reported = "?tags=%22%5B%5C%22env%3Aqa%5C%22%2C%5C%22qa-bug%5C%22%5D%22";
    for (const search of [reported, `?tags=${encodeURIComponent(JSON.stringify(tags))}`, "?tags=env%3Aqa%2Cqa-bug%2Cenv%3Aqa"]) {
      expect(carrySearch(defaultParseSearch(search)).tags).toEqual(tags);
    }
    expect(decodeViewTags(JSON.stringify(JSON.stringify(tags)))).toEqual(tags);
  });
  it("ignores malformed JSON and foreign shapes, bounds values and preserves unrelated filters", () => {
    for (const tags of ['["env:qa",', '"[broken]"', '{"unexpected":true}', 42, null, {}, true, "x".repeat(4097)]) {
      expect(carrySearch({ tags, q: "api", status: "down", group: "tag" })).toEqual({ q: "api", status: "down", group: "tag" });
    }
    expect(decodeViewTags(["env:qa", null, 42, "env:qa", " ", "x".repeat(65)])).toEqual(["env:qa"]);
    expect(decodeViewTags(Array.from({ length: 60 }, (_, i) => `tag:${i}`))).toHaveLength(50);
  });
  it("groups multi-tag membership without duplicates within a group or fake environment names", () => {
    const monitors = [{ uptimeMonitorId: "a", tags: ["client:one", "env:production", "env:production"] }, { uptimeMonitorId: "b", tags: ["client:one", "env:staging"] }, { uptimeMonitorId: "c", tags: [] }];
    const groups = groupViewMonitors(monitors, "tag");
    expect(groups.find(group => group.tag === "client:one")?.monitors).toHaveLength(2);
    expect(groups.find(group => group.tag === "env:production")?.monitors).toHaveLength(1);
    expect(groups.find(group => group.tag === null)?.monitors).toEqual([monitors[2]]);
    const environments = groupViewMonitors(monitors, "environment");
    expect(environments.map(group => group.tag)).toEqual(["env:production", "env:staging", null]);
    expect(groupViewMonitors(monitors, "none")).toEqual([{ tag: null, monitors }]);
  });
});

describe("persisted view equality", () => {
  it("does not mark the same filters dirty after JSON storage reorders fields or tags", async () => {
    const { sameViewFilters } = await import("./monitor-views");
    const filters = { search: "agency", tags: ["Production", "client,one"], tagMode: "all" as const, health: "down" as const, sort: "name" as const, direction: "asc" as const, density: "compact" as const, group: "tag" as const };
    const persisted = { group: filters.group, direction: filters.direction, density: filters.density, sort: filters.sort, tags: [...filters.tags].reverse(), health: filters.health, tagMode: filters.tagMode, search: filters.search };
    expect(sameViewFilters(persisted, filters)).toBe(true);
    expect(sameViewFilters(persisted, { ...filters, tagMode: "any" })).toBe(false);
  });
});
