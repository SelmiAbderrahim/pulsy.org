import { describe, expect, it } from "vitest";
import { formatPercent, formattingLocale } from "./percent-format";

describe("shared percentage presentation", () => {
  it.each([
    [0, "0.00%"], [100, "100.00%"], [99.1, "99.10%"],
    [99.456, "99.46%"], [99.999, "99.99%"], [0.001, "0.01%"],
  ])("keeps precision and honest boundaries for %s", (value, expected) => {
    expect(formatPercent(value, "en")).toBe(expected);
  });
  it.each([null, undefined, NaN, Infinity, -Infinity, -1, 100.01])("does not manufacture a value for %s", value => {
    expect(formatPercent(value, "en")).toBeNull();
  });
  it.each(["fr", "de", "es"])("uses decimal commas and fixed precision in %s", locale => {
    expect(formatPercent(99.1, locale)).toBe("99,10\u00a0%");
    expect(formatPercent(0, locale)).toBe("0,00\u00a0%");
  });
  it("uses Latin digits even for an explicitly Arabic numbering system", () => {
    expect(formatPercent(99.1, "ar-u-nu-arab")).toBe("99.10\u200e%\u200e");
    expect(formattingLocale("ar-u-nu-arab")).toBe("ar-u-nu-latn");
    expect(formattingLocale("fr")).toBe("fr");
  });
});
