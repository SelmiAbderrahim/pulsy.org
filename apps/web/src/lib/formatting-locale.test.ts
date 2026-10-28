import { describe, expect, it } from "vitest";
import { formatDate } from "./date-format";
import { formatNumber, formatPercent, formatMilliseconds } from "./uptime/number-format";
import { formatRelativeTime } from "./uptime/format";
import { formatInterpolatedValue } from "./number-interpolation";

describe("consistent numeric presentation", () => {
  it.each(["en", "ar", "ar-EG", "ar-u-nu-arab", "fr", "de", "es"])("formats numbers and dates with Latin digits in %s", locale => {
    const values = [formatNumber(1234, locale), formatPercent(91.25, locale), formatMilliseconds(350, locale), formatDate("2026-10-14T12:34:00Z", locale, "UTC"), formatRelativeTime("2026-10-14T12:00:00Z", locale, Date.parse("2026-10-14T12:34:00Z")), formatInterpolatedValue(1234, "number", locale, {})];
    for (const value of values) {
      expect(value).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9]/);
      expect(value).toMatch(/[0-9]/);
    }
  });
});
