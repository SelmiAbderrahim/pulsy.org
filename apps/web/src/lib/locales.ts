/**
 * Supported locales — a side-effect-free constant module.
 *
 * Kept separate from `@/i18n` (which initialises i18next with the HTTP backend)
 * so utility code can import the locale list without triggering runtime i18n
 * initialisation.
 *
 * @module lib/locales
 */

export const SUPPORTED_LANGUAGES = ["en", "ar", "fr", "de", "es"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Locales that render right-to-left. */
export const RTL_LANGUAGES: readonly SupportedLanguage[] = ["ar"];
