import { TRPCError } from "@trpc/server";
import type { Translator } from "./i18n";

/**
 * Per-account ceilings so one account cannot grow a table without bound
 * (storage, list payloads, and — for API keys — a multiplied rate limit).
 * count-then-insert, so a concurrent burst can overshoot by a few rows;
 * an atomic cap needs an owner-row transaction lock.
 */
export const ACCOUNT_CAPS = {
	shareLinks: { max: 200, messageKey: "errors.shareLinkLimit" },
	notificationChannels: { max: 2000, messageKey: "errors.channelLimit" },
	emailProviders: { max: 20, messageKey: "errors.emailProviderLimit" },
	slaSubscriptions: { max: 200, messageKey: "errors.slaSubscriptionLimit" },
	apiKeys: { max: 20, messageKey: "errors.apiKeyLimit" },
} as const;

export function assertBelowCap(current: number, cap: keyof typeof ACCOUNT_CAPS, t: Translator): void {
	const { max, messageKey } = ACCOUNT_CAPS[cap];
	if (current >= max) throw new TRPCError({ code: "BAD_REQUEST", message: t(messageKey, { max }) });
}
