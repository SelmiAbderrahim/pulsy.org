import { describe, expect, it } from "vitest";
import {
	DEFAULT_LANGUAGE,
	DICTIONARIES,
	getEffectiveLanguage,
	getTranslator,
	parseAcceptLanguage,
	SUPPORTED_LANGUAGES,
	type SupportedLanguage,
} from "./i18n";

describe("SUPPORTED_LANGUAGES", () => {
	it("contains the five supported locales", () => {
		expect([...SUPPORTED_LANGUAGES]).toEqual(["en", "ar", "fr", "de", "es"]);
		expect(DEFAULT_LANGUAGE).toBe("en");
	});
});

describe("parseAcceptLanguage", () => {
	it("returns undefined for missing/empty input", () => {
		expect(parseAcceptLanguage(undefined)).toBeUndefined();
		expect(parseAcceptLanguage(null)).toBeUndefined();
		expect(parseAcceptLanguage("")).toBeUndefined();
	});

	it("picks the first supported language", () => {
		expect(parseAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
	});

	it("honours q-value ordering", () => {
		// de has the highest q-value despite appearing last.
		expect(parseAcceptLanguage("en;q=0.2,ar;q=0.5,de;q=0.9")).toBe("de");
	});

	it("skips unsupported languages and falls through to a supported one", () => {
		expect(parseAcceptLanguage("zh-CN,ja;q=0.9,es;q=0.5")).toBe("es");
	});

	it("returns undefined when no tag is supported", () => {
		expect(parseAcceptLanguage("zh-CN,ja;q=0.9")).toBeUndefined();
	});

	it("treats a malformed q-value as lowest priority", () => {
		// ar has q=NaN -> 0; en defaults to q=1 and wins.
		expect(parseAcceptLanguage("ar;q=abc,en")).toBe("en");
	});

	it("ignores empty segments", () => {
		expect(parseAcceptLanguage(",,fr,")).toBe("fr");
	});
});

describe("getEffectiveLanguage", () => {
	it("prefers a supported user preference", () => {
		expect(
			getEffectiveLanguage({ userPreference: "ar", acceptLanguage: "fr" }),
		).toBe("ar");
	});

	it("ignores an unsupported user preference and uses Accept-Language", () => {
		expect(
			getEffectiveLanguage({ userPreference: "xx", acceptLanguage: "fr" }),
		).toBe("fr");
	});

	it("falls back to the default when nothing matches", () => {
		expect(
			getEffectiveLanguage({ userPreference: null, acceptLanguage: null }),
		).toBe("en");
		expect(getEffectiveLanguage({})).toBe("en");
	});
});

describe("getTranslator", () => {
	it("translates a known key per locale", () => {
		expect(getTranslator("en")("errors.unauthorized")).toBe(
			"You must be signed in to do that",
		);
		expect(getTranslator("fr")("errors.unauthorized")).toBe(
			"Vous devez être connecté pour faire cela",
		);
	});

	it("interpolates variables", () => {
		expect(getTranslator("en")("errors.notFound", { resource: "Monitor" })).toBe(
			"Monitor not found",
		);
	});

	it("keeps the placeholder when a variable is missing", () => {
		expect(getTranslator("en")("errors.notFound", {})).toBe(
			"{{resource}} not found",
		);
	});

	it("returns the template unchanged when no vars are passed", () => {
		expect(getTranslator("en")("errors.internal")).toBe("Something went wrong");
	});

	it("returns the key itself for an unknown key", () => {
		expect(getTranslator("en")("errors.doesNotExist")).toBe(
			"errors.doesNotExist",
		);
	});

	it("falls back to the default dictionary for an unknown locale", () => {
		const t = getTranslator("zz" as SupportedLanguage);
		expect(t("errors.unauthorized")).toBe("You must be signed in to do that");
	});
});

// ---------------------------------------------------------------------------
// Organization key completeness
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

function placeholderSet(template: string): Set<string> {
	const vars = new Set<string>();
	for (const match of template.matchAll(PLACEHOLDER_RE)) {
		vars.add(match[1] as string);
	}
	return vars;
}

const ORG_VAR_SAMPLES: Record<string, string | number> = {
	email: "user@example.com",
	resource: "Monitor",
};

const ORG_KEYS = [
	"errors.notOrgMember",
	"errors.orgSlugTaken",
	"errors.orgOwnerCannotLeave",
	"errors.orgMemberAlreadyExists",
	"errors.orgInviteUserNotFound",
] as const;

describe("backend i18n — organization keys", () => {
	for (const key of ORG_KEYS) {
		describe(key, () => {
			it("exists in every supported locale", () => {
				for (const lang of SUPPORTED_LANGUAGES) {
					const template = DICTIONARIES[lang][key];
					expect(template, `missing key "${key}" in "${lang}"`).toBeTruthy();
				}
			});

			it("uses identical interpolation variables across locales", () => {
				const enVars = placeholderSet(DICTIONARIES.en[key] ?? "");
				for (const lang of SUPPORTED_LANGUAGES) {
					const langVars = placeholderSet(DICTIONARIES[lang][key] ?? "");
					expect(
						[...langVars].sort(),
						`placeholder mismatch in "${lang}" for "${key}"`,
					).toEqual([...enVars].sort());
				}
			});

			it("renders without leaving unresolved {{...}} placeholders", () => {
				for (const lang of SUPPORTED_LANGUAGES) {
					const rendered = getTranslator(lang)(key, ORG_VAR_SAMPLES);
					expect(
						rendered,
						`unresolved placeholder in "${lang}" for "${key}": "${rendered}"`,
					).not.toMatch(/\{\{|\}\}/);
					expect(rendered.length).toBeGreaterThan(0);
					expect(rendered).not.toBe(key);
				}
			});
		});
	}
});

// ---------------------------------------------------------------------------
// API-key / REST-API error key completeness
// ---------------------------------------------------------------------------

const API_KEY_VAR_SAMPLES: Record<string, string | number> = {
	required: "full",
	actual: "limited",
	retryAfter: 30,
};

const API_KEY_ERROR_KEYS = [
	"errors.apiKeyInvalid",
	"errors.apiKeyRevoked",
	"errors.apiKeyNotFound",
	"errors.rateLimited",
] as const;

describe("backend i18n — API-key / REST keys", () => {
	for (const key of API_KEY_ERROR_KEYS) {
		describe(key, () => {
			it("exists in every supported locale", () => {
				for (const lang of SUPPORTED_LANGUAGES) {
					expect(
						DICTIONARIES[lang][key],
						`missing key "${key}" in "${lang}"`,
					).toBeTruthy();
				}
			});

			it("uses identical interpolation variables across locales", () => {
				const enVars = placeholderSet(DICTIONARIES.en[key] ?? "");
				for (const lang of SUPPORTED_LANGUAGES) {
					const langVars = placeholderSet(DICTIONARIES[lang][key] ?? "");
					expect(
						[...langVars].sort(),
						`placeholder mismatch in "${lang}" for "${key}"`,
					).toEqual([...enVars].sort());
				}
			});

			it("renders without leaving unresolved {{...}} placeholders", () => {
				for (const lang of SUPPORTED_LANGUAGES) {
					const rendered = getTranslator(lang)(key, API_KEY_VAR_SAMPLES);
					expect(
						rendered,
						`unresolved placeholder in "${lang}" for "${key}"`,
					).not.toMatch(/\{\{|\}\}/);
					expect(rendered).not.toBe(key);
				}
			});
		});
	}
});

// ---------------------------------------------------------------------------
// SLA report key completeness (PDF + monthly email)
// ---------------------------------------------------------------------------

const SLA_VAR_SAMPLES: Record<string, string | number> = {
	monitor: "Example Monitor",
	period: "2026-05",
};

const SLA_REPORT_KEYS = [
	"slaReport.pdfTitle",
	"slaReport.monitor",
	"slaReport.url",
	"slaReport.period",
	"slaReport.uptime",
	"slaReport.totalChecks",
	"slaReport.successfulChecks",
	"slaReport.failedChecks",
	"slaReport.avgResponseTime",
	"slaReport.p95ResponseTime",
	"slaReport.incidents",
	"slaReport.noIncidents",
	"slaReport.incidentCount",
	"slaReport.totalDowntime",
	"slaReport.longestIncident",
	"slaReport.dailyUptime",
	"slaReport.noData",
	"slaReport.generatedAt",
	"slaReport.emailSubject",
	"slaReport.emailIntro",
	"slaReport.downloadPdf",
	"slaReport.footer",
] as const;

describe("backend i18n — SLA report keys", () => {
	for (const key of SLA_REPORT_KEYS) {
		describe(key, () => {
			it("exists in every supported locale", () => {
				for (const lang of SUPPORTED_LANGUAGES) {
					const template = DICTIONARIES[lang][key];
					expect(template, `missing key "${key}" in "${lang}"`).toBeTruthy();
				}
			});

			it("uses identical interpolation variables across locales", () => {
				const enVars = placeholderSet(DICTIONARIES.en[key] ?? "");
				for (const lang of SUPPORTED_LANGUAGES) {
					const langVars = placeholderSet(DICTIONARIES[lang][key] ?? "");
					expect(
						[...langVars].sort(),
						`placeholder mismatch in "${lang}" for "${key}"`,
					).toEqual([...enVars].sort());
				}
			});

			it("renders without leaving unresolved {{...}} placeholders", () => {
				for (const lang of SUPPORTED_LANGUAGES) {
					const rendered = getTranslator(lang)(key, SLA_VAR_SAMPLES);
					expect(
						rendered,
						`unresolved placeholder in "${lang}" for "${key}": "${rendered}"`,
					).not.toMatch(/\{\{|\}\}/);
					expect(rendered.length).toBeGreaterThan(0);
					expect(rendered).not.toBe(key);
				}
			});
		});
	}
});

// ---------------------------------------------------------------------------
// Status-page error key completeness (custom domains + slugs)
// ---------------------------------------------------------------------------

const STATUS_PAGE_KEYS = [
	"errors.statusPageSlugTaken",
	"errors.customDomainTaken",
	"errors.customDomainNotVerified",
] as const;

describe("backend i18n — status page keys", () => {
	for (const key of STATUS_PAGE_KEYS) {
		describe(key, () => {
			it("exists in every supported locale", () => {
				for (const lang of SUPPORTED_LANGUAGES) {
					const template = DICTIONARIES[lang][key];
					expect(template, `missing key "${key}" in "${lang}"`).toBeTruthy();
				}
			});

			it("uses identical interpolation variables across locales", () => {
				const enVars = placeholderSet(DICTIONARIES.en[key] ?? "");
				for (const lang of SUPPORTED_LANGUAGES) {
					const langVars = placeholderSet(DICTIONARIES[lang][key] ?? "");
					expect(
						[...langVars].sort(),
						`placeholder mismatch in "${lang}" for "${key}"`,
					).toEqual([...enVars].sort());
				}
			});

			it("renders without leaving unresolved {{...}} placeholders", () => {
				for (const lang of SUPPORTED_LANGUAGES) {
					const rendered = getTranslator(lang)(key, {});
					expect(
						rendered,
						`unresolved placeholder in "${lang}" for "${key}": "${rendered}"`,
					).not.toMatch(/\{\{|\}\}/);
					expect(rendered.length).toBeGreaterThan(0);
					expect(rendered).not.toBe(key);
				}
			});
		});
	}
});
