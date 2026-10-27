import { beforeEach, describe, expect, it } from "vitest";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { formatApiError } from "../../validation-errors";
import { getTranslator, SUPPORTED_LANGUAGES } from "../../../lib/i18n";

// Channel input errors reach the browser as field errors keyed to `webhookUrl`
// (Telegram target / webhook URL), localized in all five
// languages and never echoing the submitted value.

useCleanDatabase();

let owner: Awaited<ReturnType<typeof createTestUser>>;
beforeEach(async () => {
	owner = await createTestUser();
});

const base = { notifyOnDown: true, notifyOnRecovery: true, notifyOnTlsExpiry: false, tlsExpiryThresholdDays: 14 };

describe("uptimeMonitor.channel.create — localized field errors per channel type", () => {
	it.each(SUPPORTED_LANGUAGES)("telegram, vendor webhook and generic webhook problems map to webhookUrl in %s", async language => {
		const monitor = await createTestMonitor(owner.id);
		const api = authedCaller({ id: owner.id, language }).uptimeMonitor.channel;
		const t = getTranslator(language);
		const cases = [
			{ channelType: "telegram", webhookUrl: "not-a-target-SECRET", expected: t("validation.telegramTarget") },
			{ channelType: "webhook", webhookUrl: "not a url SECRET", expected: t("validation.invalidField") },
			{ channelType: "slack", webhookUrl: "https://invalid.example/SECRET", expected: t("errors.slackDestination") },
			{ channelType: "discord", webhookUrl: "https://invalid.example/SECRET", expected: t("errors.discordDestination") },
		] as const;
		for (const { channelType, webhookUrl, expected } of cases) {
			const error = await api.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType, webhookUrl, ...base }).catch((caught: unknown) => caught);
			expect(error).toMatchObject({ code: "BAD_REQUEST" });
			const wire = formatApiError({ message: (error as Error).message, data: { code: "BAD_REQUEST" } }, error as never, t);
			expect(wire.data.validationErrors?.fieldErrors.webhookUrl).toEqual([expected]);
			expect(wire.message).toBe(t("validation.reviewFields"));
			expect(JSON.stringify(wire)).not.toContain("SECRET");
		}
	});

	it("localizes Telegram guidance differently from English", () => {
		for (const language of SUPPORTED_LANGUAGES.filter(code => code !== "en")) {
			expect(getTranslator(language)("validation.telegramTarget")).not.toBe(getTranslator("en")("validation.telegramTarget"));
		}
	});
});
