import { describe, expect, it, vi } from "vitest";
import { browserTimezone, isValidTimezone, timezoneSchema } from "./timezone";
import { apiAnnouncementDraft } from "./validation-status-communication";

describe("announcement timezones", () => {
  it.each(["UTC", "Etc/UTC", "Europe/Berlin", "US/Eastern"])("accepts %s without supportedValuesOf", value => {
    expect(isValidTimezone(value)).toBe(true); expect(timezoneSchema.parse(value)).toBe(value);
  });
  it.each(["", "Mars/Base", " Europe/Berlin ", "x".repeat(101)])("rejects invalid zone %s at the timezone path", timezone => {
    const result = apiAnnouncementDraft.safeParse({ statusPageId: "page", title: "Issue", text: "Investigating", stage: "investigating", componentIds: ["component"], timezone });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.timezone).toHaveLength(1);
  });
  it("uses the browser timezone and falls back safely when Intl fails", () => {
    expect(browserTimezone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => { throw new RangeError(); });
    try { expect(browserTimezone()).toBe("UTC"); } finally { spy.mockRestore(); }
  });
});
