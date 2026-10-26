import { describe, expect, it } from "vitest";
import { isFutureUtcExpiry } from "./api-key-expiry";
describe("API key UTC date rule", () => {
  const now = Date.parse("2026-10-15T12:34:00Z");
  it("rejects past dates and all of today including its future end-of-day", () => {
    for (const value of ["invalid", "2026-10-14T23:59:59.999Z", "2026-10-15T23:59:59.999Z"]) expect(isFutureUtcExpiry(value, now)).toBe(false);
  });
  it("accepts tomorrow and evaluates timezone offsets by their UTC date", () => {
    expect(isFutureUtcExpiry("2026-10-16T23:59:59.999Z", now)).toBe(true);
    expect(isFutureUtcExpiry("2026-10-16T00:30:00+02:00", now)).toBe(false);
    expect(isFutureUtcExpiry("2026-10-15T23:30:00-02:00", now)).toBe(true);
  });
});
