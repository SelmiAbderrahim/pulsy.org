import { formattingLocale } from "@/lib/formatting-locale";
import { describe, expect, it } from "vitest";
import { formatMilliseconds, formatPercent, formatSeconds } from "./number-format";

describe("percentages", () => {
	it("prints equal values identically with fixed two-digit precision", () => {
		expect(formatPercent(99.1, "en")).toBe("99.10%");
		expect(formatPercent(99.10, "en")).toBe(formatPercent(99.1, "en"));
		expect(formatPercent(100, "en")).toBe("100.00%");
		expect(formatPercent(0, "en")).toBe("0.00%");
		expect(formatPercent(99.456, "en")).toBe("99.46%");
	});
	it("never rounds an imperfect value up to 100% or a non-zero value down to 0%", () => {
		expect(formatPercent(99.999, "en")).toBe("99.99%");
		expect(formatPercent(99.9951, "en")).toBe("99.99%");
		expect(formatPercent(0.001, "en")).toBe("0.01%");
	});
	it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 100.01])("rejects %s instead of fabricating a figure", (value) => {
		expect(formatPercent(value as number | null | undefined, "en")).toBeNull();
	});
	it.each(["en", "ar", "fr", "de", "es"])("uses the %s locale's separators and percent sign", (locale) => {
		const text = formatPercent(99.5, locale)!;
		expect(text).toBe(new Intl.NumberFormat(formattingLocale(locale), { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(0.995));
		expect(formatPercent(99.1, locale)).toBe(new Intl.NumberFormat(formattingLocale(locale), { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(0.991));
	});
});

describe("milliseconds", () => {
	it("groups large values and always carries one unit form", () => {
		expect(formatMilliseconds(10000, "en")).toBe("10,000\u00a0ms");
		expect(formatMilliseconds(0, "en")).toBe("0\u00a0ms");
		expect(formatMilliseconds(1, "en")).toBe("1\u00a0ms");
		expect(formatMilliseconds(10000, "de")).toBe(new Intl.NumberFormat(formattingLocale("de"), { style: "unit", unit: "millisecond", unitDisplay: "short" }).format(10000).replace(/ /g, "\u00a0"));
		expect(formatMilliseconds(10000, "ar")).toBe("10,000\u00a0ms");
		expect(formatMilliseconds(350, "ar")).not.toMatch(/ /);
	});
	it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -5])("returns null for %s", (value) => {
		expect(formatMilliseconds(value as number | null | undefined, "en")).toBeNull();
	});
});

describe("durations in seconds", () => {
	it("uses the largest exact unit and a localized long unit name", () => {
		expect(formatSeconds(300, "en")).toBe("5\u00a0minutes");
		expect(formatSeconds(60, "en")).toBe("1\u00a0minute");
		expect(formatSeconds(90, "en")).toBe("1\u00a0min 30\u00a0sec");
		expect(formatSeconds(598.816, "en")).toBe("9\u00a0min 59\u00a0sec");
		expect(formatSeconds(3600, "en")).toBe("1\u00a0hour");
		expect(formatSeconds(172800, "en")).toBe("2\u00a0days");
		expect(formatSeconds(0, "en")).toBe("0\u00a0seconds");
		expect(formatSeconds(300, "fr")).toBe("5\u00a0minutes");
	});
	it.each([null, undefined, Number.NaN, -1, Number.POSITIVE_INFINITY])("returns null for %s", (value) => {
		expect(formatSeconds(value as number | null | undefined, "en")).toBeNull();
	});
});

describe("compact durations with exact details", () => {
  it("keeps seconds at short durations, carries rounding, and supports multi-day incidents", async () => {
    const { formatCompactDuration, formatDurationExact } = await import("./number-format");
    expect(formatCompactDuration(598.816, "en")).toBe("9m 59s");
    expect(formatCompactDuration(2092, "en")).toBe("34m 52s");
    expect(formatCompactDuration(325380, "en")).toBe("3d 18h 23m");
    expect(formatCompactDuration(59.9, "en")).toBe("1m");
    expect(formatCompactDuration(0, "en")).toBe("0s");
    expect(formatDurationExact(598.816, "en")).toBe("598.816 seconds");
    const details = formatDurationExact(599, "en", { start: "2026-10-13T23:59:00Z", end: "2026-10-14T00:08:59Z", timezone: "UTC" });
    expect(details).toContain("599 seconds");
    expect(details).toContain("Tuesday, October 13, 2026");
    expect(details).toContain("Wednesday, October 14, 2026");
    expect(details).toContain("11:59:00 PM UTC");
    expect(details).toContain("12:08:59 AM UTC");
  });

  it.each(["en", "ar", "fr", "de", "es"])("localizes compact units and exact seconds in %s", async locale => {
    const { formatCompactDuration, formatDurationExact } = await import("./number-format");
    const minutes = new Intl.NumberFormat(formattingLocale(locale), { style: "unit", unit: "minute", unitDisplay: "narrow" }).format(9);
    const seconds = new Intl.NumberFormat(formattingLocale(locale), { style: "unit", unit: "second", unitDisplay: "narrow" }).format(59);
    expect(formatCompactDuration(599, locale)).toBe(`${minutes.replace(/ /g, "\u00a0")} ${seconds.replace(/ /g, "\u00a0")}`);
    expect(formatDurationExact(599.123456, locale)).toBe(new Intl.NumberFormat(formattingLocale(locale), { style: "unit", unit: "second", unitDisplay: "long", maximumFractionDigits: 20 }).format(599.123456));
  });

  it.each([null, undefined, NaN, Infinity, -1])("does not invent durations for %s", async value => {
    const { formatCompactDuration, formatDurationExact } = await import("./number-format");
    expect(formatCompactDuration(value, "en")).toBeNull();
    expect(formatDurationExact(value, "en")).toBeNull();
  });
});

describe("localized numbers and chart ticks", () => {
  it("prints compact English ticks and full grouped tooltip values", async () => {
    const { formatNumber, formatNumberTick } = await import("./number-format");
    expect(formatNumberTick(6000, "en")).toBe("6k");
    expect(formatNumberTick(12300, "en")).toBe("12.3k");
    expect(formatNumber(6000, "en")).toBe("6,000");
    expect(formatNumber(0, "en")).toBe("0");
    expect(formatNumber(-6000, "en")).toBe("-6,000");
  });
  it.each(["en", "ar", "fr", "de", "es"])("uses locale separators and compact scales for %s", async locale => {
    const { formatNumber, formatNumberTick } = await import("./number-format");
    expect(formatNumber(6000.25, locale)).toBe(new Intl.NumberFormat(formattingLocale(locale)).format(6000.25));
    expect(formatNumberTick(6000, locale)).toBe(new Intl.NumberFormat(formattingLocale(locale), { notation: "compact", maximumFractionDigits: 1 }).format(6000).replace("K", "k"));
  });
  it.each([null, undefined, NaN, Infinity])("preserves unavailable numbers for %s", async value => {
    const { formatNumber, formatNumberTick } = await import("./number-format");
    expect(formatNumber(value, "en")).toBeNull();
    expect(formatNumberTick(value, "en")).toBeNull();
  });
});

it.each(["en", "ar", "fr", "de", "es"])("exact durations always expose raw numerals, including singular/dual in %s", async locale => {
  const { formatDurationExact } = await import("./number-format");
  for (const value of [0, 1, 2]) {
    expect(formatDurationExact(value, locale)).toContain(new Intl.NumberFormat(formattingLocale(locale)).format(value));
  }
});

describe("one numbering system per locale (QA-026)", () => {
	const ARABIC_INDIC = /[٠-٩۰-۹]/;
	it.each(["en", "ar", "fr", "de", "es"])("never prints Arabic-Indic digits for %s", async locale => {
		const { formatCompactDuration, formatDurationExact, formatNumber, formatNumberTick, formatPercent, formatMilliseconds, formatSeconds } = await import("./number-format");
		const samples = [
			formatPercent(99.95, locale), formatPercent(0.5, locale), formatMilliseconds(1234, locale), formatSeconds(12.5, locale),
			formatCompactDuration(3725, locale), formatDurationExact(3725, locale), formatNumber(1234567.89, locale), formatNumberTick(6500, locale),
		];
		for (const sample of samples) {
			expect(sample).not.toBeNull();
			expect(sample).not.toMatch(ARABIC_INDIC);
			expect(sample).toMatch(/[0-9]/);
		}
	});

	it("keeps Arabic measurement units in Latin letters without a wrapping space", async () => {
		const { formatMilliseconds, keepTogether } = await import("./number-format");
		const text = formatMilliseconds(350, "ar")!;
		expect(text).toBe("350 ms");
		expect(text).not.toContain(" ");
		expect(keepTogether("350 ms")).not.toContain(" ");
	});
});
