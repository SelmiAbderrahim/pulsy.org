import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

	describe("validation and slug locale copy", () => {
	it.each(["en", "ar", "fr", "de", "es"])("provides matching interpolation keys in %s", locale => {
			const dictionary = JSON.parse(readFileSync(`public/locales/${locale}/uptimeMonitor.json`, "utf8"));
		for (const key of ["slugHint", "validationError"]) {
			const message = dictionary.statusUX[key];
			expect(typeof message).toBe("string"); expect(message.trim()).not.toBe("");
			expect(message.match(/\{\{\w+\}\}/g) ?? []).toEqual([]);
		}
	});
	it.each(["en", "ar", "fr", "de", "es"])("provides announcement lifecycle copy with matching interpolation in %s", locale => {
			const reference = JSON.parse(readFileSync("public/locales/en/uptimeMonitor.json", "utf8"));
			const dictionary = JSON.parse(readFileSync(`public/locales/${locale}/uptimeMonitor.json`, "utf8"));
		for (const key of ["timezoneError", "timezoneHint", "submitError", "affectedError", "editing", "activeDraft", "deleteDraft", "deleteConfirm", "deleteError", "deleting", "saving", "unsavedTitle", "discard", "chooseOccurrence"]) {
			expect(typeof dictionary.communication[key]).toBe("string");
			expect(dictionary.communication[key].trim()).not.toBe("");
			expect(dictionary.communication[key].match(/\{\{\w+\}\}/g) ?? []).toEqual(reference.communication[key].match(/\{\{\w+\}\}/g) ?? []);
		}
		expect(dictionary.notificationUX.testTitle.trim()).not.toBe("");
	});
});
