import { formattingLocale } from "@/lib/formatting-locale";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import { describe, expect, it } from "vitest";
import { numberFormatting, numberInterpolation } from "../number-interpolation";

const LANGS = ["en", "ar", "fr", "de", "es"] as const;
const COUNTS = [0, 1, 2, 3, 11, 100, 1_000_000];
const KEYS = ["bulkAdd.submit", "statusUX.componentCount", "incidentUX.selectedPreview", "workspace.groupSelected", "maintenanceUX.editScope", "reliability.causeSummary", "bulkUX.lines", "detailUX.chartBasis", "latency.summary", "latency.quietRecovery"];
const OPTIONS = { value: "99%", timezone: "UTC", threshold: 500, current: 1 };

async function translator(lang: (typeof LANGS)[number]) {
	const instance = i18next.createInstance().use(numberFormatting);
	const resource = JSON.parse(readFileSync(`public/locales/${lang}/uptimeMonitor.json`, "utf8"));
	await instance.init({ lng: lang, fallbackLng: false, ns: ["uptimeMonitor"], defaultNS: "uptimeMonitor", resources: { [lang]: { uptimeMonitor: resource } }, interpolation: numberInterpolation });
	return instance.t.bind(instance);
}

describe("plural categories exist for every counted phrase in every locale", () => {
	it.each(LANGS)("%s resolves 0/1/2/3/11/100/1,000,000 without leaking keys or placeholders", async (lang) => {
		const t = await translator(lang);
		for (const key of KEYS) {
			for (const count of COUNTS) {
				const text = t(key, { count, formattedCount: new Intl.NumberFormat(formattingLocale(lang)).format(count), ...OPTIONS }) as string;
				expect(text, `${lang} ${key} ${count}`).not.toBe(key);
				expect(text, `${lang} ${key} ${count}`).not.toMatch(/\{\{|_one|_other/);
				expect(text.length).toBeGreaterThan(3);
			}
		}
	});

	it("English uses the singular noun for exactly one and the plural otherwise", async () => {
		const t = await translator("en");
		expect(t("bulkAdd.submit", { count: 1, formattedCount: "1" })).toBe("Add 1 monitor");
		expect(t("bulkAdd.submit", { count: 2, formattedCount: "2" })).toBe("Add 2 monitors");
		expect(t("bulkAdd.submit", { count: 0, formattedCount: "0" })).toBe("Add 0 monitors");
		expect(t("statusUX.componentCount", { count: 1 })).toBe("1 component");
		expect(t("statusUX.componentCount", { count: 0 })).toBe("0 components");
		expect(t("statusUX.componentCount", { count: 1000 })).toBe("1,000 components");
		expect(t("bulkUX.lines", { count: 1 })).toBe("1 input line");
	});

	it("Arabic distinguishes one, two, few (3–10), many (11–99) and other", async () => {
		const t = await translator("ar");
		const forms = new Set([0, 1, 2, 3, 11, 100].map((count) => t("statusUX.componentCount", { count }) as string));
		expect(forms.size).toBe(6);
		expect(t("statusUX.componentCount", { count: 1 })).toBe(`${new Intl.NumberFormat(formattingLocale("ar")).format(1)} مكوّن`);
		expect(t("statusUX.componentCount", { count: 2 })).toBe(`مكوّنان (${new Intl.NumberFormat(formattingLocale("ar")).format(2)})`);
	});

	it("French and German treat 0/1 and 2+ the way their grammar does", async () => {
		const fr = await translator("fr"), de = await translator("de");
		expect(fr("statusUX.componentCount", { count: 1 })).toBe("1 composant");
		expect(fr("statusUX.componentCount", { count: 2 })).toBe("2 composants");
		expect(de("statusUX.componentCount", { count: 1 })).toBe("1 Komponente");
		expect(de("statusUX.componentCount", { count: 5 })).toBe("5 Komponenten");
	});
});
