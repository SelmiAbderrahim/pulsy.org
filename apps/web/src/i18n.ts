/**
 * i18next initialization.
 *
 * Loads JSON namespaces over HTTP from `/locales/{{lng}}/{{ns}}.json`, detects
 * the user language from the URL (`?lng=`), localStorage, and the browser, and
 * keeps the document `dir`/`lang` attributes in sync (RTL for Arabic).
 *
 * @module i18n
 */

import i18n from "i18next";
import HttpBackend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { numberFormatting, numberInterpolation } from "@/lib/number-interpolation";

import {
	RTL_LANGUAGES,
	SUPPORTED_LANGUAGES,
	type SupportedLanguage,
} from "@/lib/locales";

export { SUPPORTED_LANGUAGES };
export type { SupportedLanguage };

export const NAMESPACES = [
	"uptimeMonitor",
	"common",
	"auth",
	"admin",
	"apiDocs",
] as const;

function applyDirection(lng: string): void {
	if (typeof document === "undefined") return;
	const base = (lng.split("-")[0] ?? lng) as SupportedLanguage;
	const dir = RTL_LANGUAGES.includes(base) ? "rtl" : "ltr";
	document.documentElement.dir = dir;
	document.documentElement.lang = base;
}

export const i18nReady = i18n
	.use(numberFormatting)
	.use(HttpBackend)
	.use(LanguageDetector)
	.use(initReactI18next)
	.init({
		lng: typeof document === "undefined" ? undefined : document.documentElement.dataset.initialLocale,
		fallbackLng: "en",
		supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
		ns: NAMESPACES as unknown as string[],
		defaultNS: "common",
		interpolation: numberInterpolation,
		backend: {
			loadPath: "/locales/{{lng}}/{{ns}}.json",
		},
		detection: {
			// `querystring` first so shareable `?lng=fr` links resolve to the
			// right locale on first load.
			order: ["querystring", "localStorage", "navigator", "htmlTag"],
			lookupQuerystring: "lng",
			caches: ["localStorage"],
		},
		react: {
			useSuspense: true,
		},
	});

applyDirection((typeof document !== "undefined" && document.documentElement.dataset.initialLocale) || i18n.language || "en");
i18n.on("languageChanged", applyDirection);

export default i18n;
