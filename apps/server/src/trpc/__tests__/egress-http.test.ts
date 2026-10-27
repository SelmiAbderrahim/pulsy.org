import { createServer } from "node:http";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../test/db";
import { buildContext } from "../../../test/trpc-caller";
import { getTranslator, parseAcceptLanguage, SUPPORTED_LANGUAGES } from "../../lib/i18n";
import { appRouter } from "../router";

// The real HTTP boundary: a denied destination is a 400 whose field error is localized from the
// request's Accept-Language, keyed to the form field the web client links (`url`, `webhookUrl`),
// and the response never echoes the submitted address or any resolved address.
useCleanDatabase();
const ORIGINAL = process.env.MONITOR_ALLOW_PRIVATE_NETWORKS;
beforeEach(() => { process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = "false";  });
afterEach(() => { if (ORIGINAL === undefined) delete process.env.MONITOR_ALLOW_PRIVATE_NETWORKS; else process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = ORIGINAL; });

async function serve(run: (origin: string, monitorId: string) => Promise<void>) {
	const owner = await createTestUser();
	const monitor = await createTestMonitor(owner.id);
	const app = express();
	app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: ({ req }) => buildContext({ language: parseAcceptLanguage(req.headers["accept-language"]) ?? "en", user: { ...owner, emailVerified: true } as never, session: { id: "egress-fixture", userId: owner.id } as never }) }));
	const server = createServer(app);
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address");
	try { await run(`http://127.0.0.1:${address.port}/api/trpc`, monitor.uptimeMonitorId); }
	finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const post = (origin: string, procedure: string, input: unknown, language: string) => fetch(`${origin}/uptimeMonitor.${procedure}`, { method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": language }, body: JSON.stringify({ json: input }) });
const monitorInput = (url: string) => ({ name: "Probe", url, method: "GET", expectedStatus: 200, timeout: 10000, interval: 300, failureThreshold: 3, active: true, tags: [] });

describe("egress rejections over HTTP", () => {
	it("monitor.create: 400 with a localized `url` field error in every locale", async () => serve(async origin => {
		for (const language of SUPPORTED_LANGUAGES) {
			const response = await post(origin, "monitor.create", monitorInput("http://169.254.169.254/latest/meta-data/"), language);
			expect(response.status).toBe(400);
			const body = await response.json() as { error: { json: { message: string; data: { validationErrors?: { fieldErrors: Record<string, string[]> } } } } };
			const expected = getTranslator(language)("errors.targetBlocked");
			// The envelope message is the shared "review the highlighted fields" summary; the specific text is on the field.
			expect(body.error.json.message).toBe(getTranslator(language)("validation.reviewFields"));
			expect(body.error.json.data.validationErrors?.fieldErrors.url).toEqual([expected]);
			expect(JSON.stringify(body)).not.toContain("169.254");
		}
	}));

	it("monitor.createBulk reports the `urls` field", async () => serve(async origin => {
		const response = await post(origin, "monitor.createBulk", { monitors: [monitorInput("http://localhost")] }, "fr");
		expect(response.status).toBe(400);
		const body = await response.json() as { error: { json: { data: { validationErrors?: { fieldErrors: Record<string, string[]> } } } } };
		expect(body.error.json.data.validationErrors?.fieldErrors.urls).toEqual([getTranslator("fr")("errors.targetBlocked")]);
	}));

	it("channel.create: Slack and webhook destinations produce a localized `webhookUrl` field error", async () => serve(async (origin, monitorId) => {
		for (const [channelType, webhookUrl, key] of [["slack", "https://evil.example.com/services/T0/B0/X", "errors.slackDestination"], ["webhook", "http://10.0.0.1/hook", "errors.targetBlocked"]] as const) {
			for (const language of ["ar", "de", "es"] as const) {
				const response = await post(origin, "channel.create", { uptimeMonitorId: monitorId, channelType, webhookUrl }, language);
				expect(response.status).toBe(400);
				const body = await response.json() as { error: { json: { data: { validationErrors?: { fieldErrors: Record<string, string[]> } } } } };
				expect(body.error.json.data.validationErrors?.fieldErrors.webhookUrl).toEqual([getTranslator(language)(key)]);
				expect(JSON.stringify(body)).not.toContain("10.0.0.1");
			}
		}
	}));
});
