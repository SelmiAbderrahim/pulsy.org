import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const locales = ["en", "ar", "fr", "de", "es"] as const;
const keys = ["expectedAt", "graceEndsAt", "notifiedAt"] as const;
const workspace = (locale: string) => JSON.parse(readFileSync(`public/locales/${locale}/uptimeMonitor.json`, "utf8")).workspace as Record<string, string>;

// The heartbeat incident timeline labels expected, grace-end (incident start) and notified times separately.
describe("incident timeline labels", () => {
	it.each(locales)("%s labels expected, grace-end and notified times with distinct text", locale => {
		const labels = keys.map(key => workspace(locale)[key]);
		for (const label of labels) expect(label).toEqual(expect.any(String));
		expect(new Set(labels).size).toBe(keys.length);
	});

	it.each(locales.filter(locale => locale !== "en"))("%s differs from English for every timeline label", locale => {
		for (const key of keys) expect(workspace(locale)[key]).not.toBe(workspace("en")[key]);
	});
});
