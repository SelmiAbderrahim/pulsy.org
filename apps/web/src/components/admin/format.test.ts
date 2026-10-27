import { describe, expect, it } from "vitest";
import { formattingLocale } from "@/lib/formatting-locale";
import { formatDate } from "./format";

describe("admin date formatting", () => {
	it.each(["en", "ar", "fr", "de", "es"])("uses the selected %s locale with Latin digits", (locale) => {
		const value = new Date("2026-10-14T12:00:00Z");
		const expected = new Intl.DateTimeFormat(formattingLocale(locale), { dateStyle: "medium" }).format(value);
		expect(formatDate(value, locale)).toBe(expected);
		expect(formatDate(value.toISOString(), locale)).toBe(expected);
		expect(formatDate(value, locale)).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9]/);
	});

	it("retains the missing and invalid date fallback", () => {
		for (const value of [null, undefined, "", "invalid", new Date(Number.NaN)]) {
			expect(formatDate(value, "fr")).toBe("—");
		}
	});
});
