import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECK_ERROR_CODES } from "@pulsy/db/check-error";

const locales = ["en", "ar", "fr", "de", "es"] as const;
const resources = (locale: string) => JSON.parse(readFileSync(`public/locales/${locale}/uptimeMonitor.json`, "utf8"));
// Mirrors `formatLatencyReason`: heartbeat and blocked-target codes live outside `checkErrors`.
function load(locale: string): Record<string, string> {
	const r = resources(locale);
	return Object.fromEntries(CHECK_ERROR_CODES.map(code => [code, code.startsWith("heartbeat_") ? r.heartbeat?.[code] : code === "blocked_target" ? r.egress?.checkBlocked : r.checkErrors?.[code]]));
}

// QA-008/QA-013: every taxonomy code renders a localized label, never a raw enum string.
describe("check error taxonomy translations", () => {
	it.each(locales)("%s has a label for every taxonomy code", locale => {
		const labels = load(locale);
		for (const code of CHECK_ERROR_CODES) {
			expect(labels[code], `${locale} checkErrors.${code}`).toEqual(expect.any(String));
			expect(labels[code]).not.toBe(code);
			expect(labels[code]).not.toMatch(/^[a-z]+(_[a-z]+)+$/);
		}
	});

	it.each(locales.filter(locale => locale !== "en"))("%s keeps the same interpolation variables as English", locale => {
		const en = load("en");
		const labels = load(locale);
		const vars = (value: string) => [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map(match => match[1]).sort();
		for (const code of CHECK_ERROR_CODES) expect(vars(labels[code]!), `${locale} ${code}`).toEqual(vars(en[code]!));
	});
});
