import { createServer } from "node:http";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createTestUser, useCleanDatabase } from "../../../test/db";
import { buildContext } from "../../../test/trpc-caller";
import { getTranslator, parseAcceptLanguage, SUPPORTED_LANGUAGES } from "../../lib/i18n";
import { appRouter } from "../router";

useCleanDatabase();
const errorEnvelope = z.object({ error: z.object({ json: z.object({ message: z.string(), data: z.object({ code: z.string(), validationErrors: z.object({ fieldErrors: z.record(z.string(), z.array(z.string())), formErrors: z.array(z.string()) }) }).passthrough() }) }) });
const pageEnvelope = z.object({ result: z.object({ data: z.object({ json: z.object({ statusPageId: z.string(), slug: z.string(), userId: z.string() }).passthrough() }) }) });

async function serve(run: (origin: string, userId: string) => Promise<void>) {
	const owner = await createTestUser();
	const app = express();
	app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: ({ req }) => {
		const language = parseAcceptLanguage(req.headers["accept-language"]) ?? "en";
		// Controlled test identity; no QA account, live cookies or notifications.
		return buildContext({ language, user: { ...owner, emailVerified: true } as never, session: { id: "validation-fixture", userId: owner.id } as never });
	} }));
	const server = createServer(app);
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address");
	try { await run(`http://127.0.0.1:${address.port}/api/trpc`, owner.id); }
	finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function mutate(origin: string, procedure: string, input: unknown, language = "en") {
	return fetch(`${origin}/uptimeMonitor.${procedure}`, { method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": language }, body: JSON.stringify({ json: input }) });
}

describe("validation at the real tRPC HTTP boundary", () => {
	it("rejects invalid announcement timezone directly over HTTP in every locale", async () => serve(async origin => {
		for (const lang of SUPPORTED_LANGUAGES) {
			const response = await mutate(origin, "statusPage.communication.draft", { statusPageId: "page", title: "Issue", text: "Investigating", stage: "investigating", componentIds: ["component"], timezone: "Mars/Base" }, lang);
			expect(response.status).toBe(400);
			const result = errorEnvelope.parse(await response.json()).error.json;
			expect(result.data.validationErrors.fieldErrors.timezone).toEqual([getTranslator(lang)("validation.timezone")]);
			expect(result.message).toBe(getTranslator(lang)("validation.reviewFields"));
			expect(JSON.stringify(result)).not.toContain("Mars/Base");
		}
	}));
	it("normalizes create/update, maps duplicate slugs, and keeps existing public URLs working", async () => serve(async (origin, userId) => {
		const created = await mutate(origin, "statusPage.create", { title: "Validation fixture", slug: "  FiXtUrE-Link  ", isPublished: true, confirmEmptyPublication: true });
		expect(created.status).toBe(200);
		const page = pageEnvelope.parse(await created.json()).result.data.json;
		expect(page.slug).toBe("fixture-link"); expect(page.userId).toBe(userId);
		const duplicate = await mutate(origin, "statusPage.create", { title: "Duplicate", slug: " FIXTURE-LINK " });
		expect(duplicate.status).toBe(409);
		expect(errorEnvelope.parse(await duplicate.json()).error.json.data.validationErrors.fieldErrors.slug).toEqual([getTranslator("en")("errors.statusPageSlugTaken")]);
		const updated = await mutate(origin, "statusPage.update", { statusPageId: page.statusPageId, slug: " FIXTURE-LINK ", title: "Updated" });
		expect(updated.status).toBe(200); expect(pageEnvelope.parse(await updated.json()).result.data.json.slug).toBe(page.slug);
		const input = encodeURIComponent(JSON.stringify({ json: { userId, slug: page.slug } }));
		expect((await fetch(`${origin}/uptimeMonitor.public.statusPageBySlug?input=${input}`)).status).toBe(200);
	}));
	it("rejects direct invalid/empty input with localized accessible field data, never a raw Zod array", async () => serve(async origin => {
		const fixture = pageEnvelope.parse(await (await mutate(origin, "statusPage.create", { title: "Existing fixture", slug: "existing" })).json()).result.data.json;
		for (const lang of SUPPORTED_LANGUAGES) {
			for (const slug of ["Bad Slug--!!", "has space", ""]) {
				for (const procedure of ["statusPage.create", "statusPage.update"]) {
					const response = await mutate(origin, procedure, { ...(procedure.endsWith("update") ? { statusPageId: fixture.statusPageId } : {}), title: "Invalid fixture", slug }, lang);
					expect(response.status).toBe(400);
					const json = await response.json(); const result = errorEnvelope.parse(json).error.json;
					expect(result.message).toBe(getTranslator(lang)("validation.reviewFields"));
					expect(result.data.validationErrors.fieldErrors.slug).toContain(getTranslator(lang)("validation.statusPageSlug"));
					expect(result.data).not.toHaveProperty("stack");
					expect(JSON.stringify(json)).not.toContain("Bad Slug--!!");
				}
			}
		}
		const response = await mutate(origin, "monitor.create", { name: "Monitor", url: "not a URL" });
		expect(response.status).toBe(400);
		expect(errorEnvelope.parse(await response.json()).error.json.data.validationErrors.fieldErrors.url).toContain(getTranslator("en")("validation.invalidField"));
	}));
});
