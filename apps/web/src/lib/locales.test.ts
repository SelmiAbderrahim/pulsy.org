import { describe, expect, it } from "vitest";
import { RTL_LANGUAGES, SUPPORTED_LANGUAGES } from "./locales";

describe("locales", () => {
	it("exposes the five supported languages in order", () => {
		expect(SUPPORTED_LANGUAGES).toEqual(["en", "ar", "fr", "de", "es"]);
	});

	it("marks Arabic as the only RTL language", () => {
		expect(RTL_LANGUAGES).toEqual(["ar"]);
		for (const lang of RTL_LANGUAGES) {
			expect(SUPPORTED_LANGUAGES).toContain(lang);
		}
	});
});
