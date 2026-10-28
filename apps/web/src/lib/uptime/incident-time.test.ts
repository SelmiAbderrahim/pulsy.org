import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/date-format";
import { formatIncidentTimestamp } from "./incident-time";

describe("incident timestamps", () => {
  it.each(["en", "ar", "fr", "de", "es"])("formats the same source identically across incident surfaces in %s", locale => {
    const timestamp = "2026-10-14T08:21:37.000Z";
    const expected = formatDate(timestamp, locale, "Africa/Tunis", { dateStyle: "medium", timeStyle: "medium" });
    expect(formatIncidentTimestamp(timestamp, locale, "Africa/Tunis")).toBe(expected);
    expect(formatIncidentTimestamp(Date.parse(timestamp), locale, "Africa/Tunis")).toBe(expected);
    expect(formatIncidentTimestamp(new Date(timestamp), locale, "Africa/Tunis")).toBe(expected);
    expect(formatIncidentTimestamp("2026-10-14T08:20:37.000Z", locale, "Africa/Tunis")).not.toBe(expected);
  });
  it("keeps missing or malformed event times unavailable", () => {
    for (const value of [null, undefined, "not-a-date"]) expect(formatIncidentTimestamp(value, "en", "UTC")).toBe("—");
  });
});
