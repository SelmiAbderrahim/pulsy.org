import { formattingLocale } from "@/lib/formatting-locale";
import { describe, expect, it } from "vitest";
import { dateTimeFormat, formatDate, formatDateTimeInput, parseDateTimeInput } from "./date-format";

describe("account-zone datetime inputs", () => {
  it.each([
    ["UTC", "2026-07-01T12:34", "2026-07-01T12:34:00.000Z"],
    ["Europe/Berlin", "2026-07-01T12:34", "2026-07-01T10:34:00.000Z"],
    ["Europe/Berlin", "2026-01-01T12:34", "2026-01-01T11:34:00.000Z"],
    ["Asia/Kathmandu", "2026-07-01T12:34", "2026-07-01T06:49:00.000Z"],
    ["America/New_York", "2026-07-01T00:00", "2026-07-01T04:00:00.000Z"],
  ])("round-trips wall time in %s without the browser zone", (zone, local, instant) => {
    expect(parseDateTimeInput(local, zone)).toBe(instant);
    expect(formatDateTimeInput(instant, zone)).toBe(local);
  });
  it.each([
    ["Europe/Berlin", "2026-03-29T02:30"], // spring gap
    ["Europe/Berlin", "2026-10-25T02:30"], // autumn overlap
    ["Australia/Lord_Howe", "2026-10-04T02:15"], // half-hour gap
    ["Australia/Lord_Howe", "2026-04-05T01:45"], // half-hour overlap
    ["Pacific/Apia", "2011-12-30T12:00"], // skipped calendar date
    ["UTC", "2026-02-30T12:00"], ["UTC", "2026-01-01T24:00"], ["UTC", "invalid"], ["Invalid/Zone", "2026-01-01T12:00"],
  ])("rejects nonexistent or ambiguous %s wall time %s", (zone, local) => expect(parseDateTimeInput(local, zone)).toBeNull());
  it("accepts distinct minutes immediately around a Berlin transition", () => {
    expect(parseDateTimeInput("2026-03-29T01:59", "Europe/Berlin")).toBe("2026-03-29T00:59:00.000Z");
    expect(parseDateTimeInput("2026-03-29T03:00", "Europe/Berlin")).toBe("2026-03-29T01:00:00.000Z");
    expect(parseDateTimeInput("2026-10-25T03:00", "Europe/Berlin")).toBe("2026-10-25T02:00:00.000Z");
  });
});

describe("account timestamp formatting", () => {
  it.each(["en", "ar", "fr", "de", "es"])("uses the account zone and %s locale", locale => {
    const stamp = "2026-10-14T12:00:00Z";
    expect(formatDate(stamp, locale, "Africa/Tunis")).toBe(new Intl.DateTimeFormat(formattingLocale(locale), { dateStyle: "medium", timeStyle: "medium", timeZone: "Africa/Tunis" }).format(new Date(stamp)));
    expect(dateTimeFormat(locale, "Africa/Tunis").resolvedOptions().timeZone).toBe("Africa/Tunis");
  });
  it("handles invalid or missing data and invalid persisted zones safely", () => {
    expect(formatDate(null, "en")).toBe("—");
    expect(formatDate("invalid", "en")).toBe("—");
    expect(dateTimeFormat("en", "invalid/zone").resolvedOptions().timeZone).toBe("UTC");
  });
});

describe("timezone labels and exact ranges", () => {
  it.each([
    ["en", "Africa/Tunis (GMT+1)"], ["ar", `Africa/Tunis (غرينتش+${new Intl.NumberFormat(formattingLocale("ar")).format(1)})`],
    ["fr", "Africa/Tunis (UTC+1)"], ["de", "Africa/Tunis (GMT+1)"], ["es", "Africa/Tunis (GMT+1)"],
  ])("keeps the IANA zone and localized offset in %s", async (locale, expected) => {
    const { formatTimezone } = await import("./date-format");
    expect(formatTimezone("Africa/Tunis", locale!, new Date("2026-01-01"))).toBe(expected);
  });

  it("uses the offset at the supplied date, including DST and fractional zones", async () => {
    const { formatTimezone } = await import("./date-format");
    expect(formatTimezone("Europe/Berlin", "en", Date.parse("2026-01-01"))).toBe("Europe/Berlin (GMT+1)");
    expect(formatTimezone("Europe/Berlin", "en", Date.parse("2026-07-01"))).toBe("Europe/Berlin (GMT+2)");
    expect(formatTimezone("Asia/Kolkata", "en", Date.parse("2026-01-01"))).toBe("Asia/Kolkata (GMT+5:30)");
    expect(formatTimezone("invalid/zone", "en", Date.parse("2026-01-01"))).toMatch(/^UTC \(GMT(?:\+0)?\)$/);
  });

  it.each(["en", "ar", "fr", "de", "es"])("retains both full dates and clock times in a %s exact range", async locale => {
    const { formatDateRange } = await import("./date-format");
    const start = "2026-10-13T23:59:00Z", end = "2026-10-14T00:08:59Z";
    const formatter = new Intl.DateTimeFormat(formattingLocale(locale), { dateStyle: "full", timeStyle: "long", timeZone: "UTC" });
    expect(formatDateRange(start, end, locale, "UTC")).toBe(`${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`);
    expect(formatDateRange("invalid", end, locale, "UTC")).toBe("—");
  });
});
