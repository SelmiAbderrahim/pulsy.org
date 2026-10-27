import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Activity is Pause / Resume in every locale, never enabled/disabled (QA-052).
const expected = {
	en: { enableSuccess: "Monitor resumed", disableSuccess: "Monitor paused" },
	ar: { enableSuccess: "تم استئناف المراقب", disableSuccess: "تم إيقاف المراقب مؤقتًا" },
	fr: { enableSuccess: "Moniteur repris", disableSuccess: "Moniteur mis en pause" },
	de: { enableSuccess: "Monitor fortgesetzt", disableSuccess: "Monitor pausiert" },
	es: { enableSuccess: "Monitor reanudado", disableSuccess: "Monitor en pausa" },
} as const;

describe("pause and resume wording", () => {
	it.each(Object.keys(expected) as (keyof typeof expected)[])("uses the same pause/resume vocabulary for the toggle toasts in %s", locale => {
		const resources = JSON.parse(readFileSync(`public/locales/${locale}/uptimeMonitor.json`, "utf8"));
		expect(resources.toggle.enableSuccess).toBe(expected[locale].enableSuccess);
		expect(resources.toggle.disableSuccess).toBe(expected[locale].disableSuccess);
		expect(resources.toggle.enableSuccess).not.toBe(resources.toggle.disableSuccess);
	});

	it.each(Object.keys(expected) as (keyof typeof expected)[])("keeps the bulk pause/resume results in the same vocabulary in %s", locale => {
		const bulk = JSON.parse(readFileSync(`public/locales/${locale}/uptimeMonitor.json`, "utf8")).bulk;
		const en = JSON.parse(readFileSync("public/locales/en/uptimeMonitor.json", "utf8")).bulk;
		for (const key of Object.keys(en).filter(name => /^(pause|resume)Success/.test(name))) {
			expect(bulk[key], `${locale} bulk.${key}`).toEqual(expect.any(String));
			expect(bulk[key], `${locale} bulk.${key}`).not.toMatch(/enabled|disabled/i);
		}
	});
});
