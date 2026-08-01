import { vi } from "vitest";

/**
 * A `t()` implementation good enough for component tests.
 *
 * Components call `t(key)`, `t(key, defaultValue)`, or
 * `t(key, defaultValue, { count, type, ... })`. We resolve the human-readable
 * string from the default value when present (otherwise the key) and apply
 * `{{var}}` interpolation so assertions can match rendered text.
 */
export function translate(
	key: string,
	defaultOrOptions?: string | Record<string, unknown>,
	maybeOptions?: Record<string, unknown>,
): string {
	let template: string = key;
	let options: Record<string, unknown> | undefined;

	if (typeof defaultOrOptions === "string") {
		template = defaultOrOptions;
		options = maybeOptions;
	} else if (defaultOrOptions && typeof defaultOrOptions === "object") {
		options = defaultOrOptions;
	}

	// i18next supports passing `defaultValue` inside the options object; prefer it
	// over the raw key so component text matches the production fallback.
	if (
		options &&
		typeof options.defaultValue === "string" &&
		template === key
	) {
		template = options.defaultValue;
	}

	if (options) {
		template = template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
			name in options ? String(options[name]) : `{{${name}}}`,
		);
	}

	return template;
}

/**
 * Install the standard `react-i18next` mock. Call inside `vi.mock` factories.
 * (Explicit return type: vitest 4's `vi.fn()` otherwise leaks a non-portable
 * `@vitest/spy` path into the inferred type — TS2742.)
 */
export function reactI18nextMock(): Record<string, unknown> {
	return {
		useTranslation: () => ({
			t: translate,
			i18n: { language: "en", changeLanguage: vi.fn() },
		}),
		Trans: ({ children }: { children?: unknown }) => children ?? null,
		initReactI18next: { type: "3rdParty", init: vi.fn() },
	};
}
