import { formatCount } from "./count-format";
import { numberFormatting, numberInterpolation } from "./number-interpolation";
import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import en from "../../public/locales/en/uptimeMonitor.json";
import ar from "../../public/locales/ar/uptimeMonitor.json";
import fr from "../../public/locales/fr/uptimeMonitor.json";
import de from "../../public/locales/de/uptimeMonitor.json";
import es from "../../public/locales/es/uptimeMonitor.json";

describe("maintenance selection plurals", () => {
	it.each(Object.entries({ en, ar, fr, de, es }))("resolves each %s plural category without a fallback key", async (lng, strings) => {
		const i18n = createInstance().use(numberFormatting);
		await i18n.init({ lng, resources: { [lng]: { translation: strings } }, initAsync: false, interpolation: numberInterpolation });
		for (const count of [0, 1, 2, 3, 11, 100, 1_000_000]) {
			const category = new Intl.PluralRules(lng).select(count);
			expect(strings.maintenance).toHaveProperty(`selected_${category}`);
			expect(i18n.t("maintenance.selected", { count })).not.toMatch(/maintenance\.|\{\{/);
			for (const key of ["bulk.pauseSuccess", "bulk.resumeSuccess", "bulk.deleteSuccess", "bulk.edit.description", "bulk.edit.submit", "bulk.edit.success", "bulkAdd.submit", "bulkAdd.success", "widget.monitors", "share.dialog.title", "share.manage.monitors", "share.claim.add", "share.claim.success", "maintenance.cancelConfirm", "pageSelection.description", "communication.groupCount"]) {
				expect(i18n.exists(`${key}_${category}`)).toBe(true);
				expect(formatCount((pluralKey, options) => i18n.t(pluralKey, { ...options, name: "Release" }), key, count, lng)).not.toMatch(/\{\{/);
			}

		}
		if (lng === "en") expect(i18n.t("maintenance.selected", { count: 1 })).toBe("1 selected monitor");
	});
});
