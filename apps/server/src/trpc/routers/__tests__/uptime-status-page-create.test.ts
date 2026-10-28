import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it } from "vitest";
import { db, uptimeStatusPage } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { formatApiError } from "../../validation-errors";
import { getTranslator, SUPPORTED_LANGUAGES } from "../../../lib/i18n";

// QA-015: statusPage.create must never surface a 500 for valid input. Duplicate
// slugs are a CONFLICT with a localized field error; a double submit (same
// payload twice, concurrently) creates exactly one page.

useCleanDatabase();

let owner: Awaited<ReturnType<typeof createTestUser>>;
beforeEach(async () => {
	owner = await createTestUser();
});

const pages = () => db.select().from(uptimeStatusPage).where(eq(uptimeStatusPage.userId, owner.id));
const input = { slug: "double", title: "Double submit", isPublished: false } as const;

describe("uptimeMonitor.statusPage.create — reliability", () => {
	it("a concurrent double submit of the same payload creates one page and returns it to both callers", async () => {
		const api = authedCaller(owner).uptimeMonitor.statusPage;
		const results = await Promise.allSettled([api.create({ ...input }), api.create({ ...input })]);
		expect(results.every(result => result.status === "fulfilled")).toBe(true);
		const ids = results.map(result => (result as PromiseFulfilledResult<{ statusPageId: string }>).value.statusPageId);
		expect(ids[0]).toBe(ids[1]);
		expect(await pages()).toHaveLength(1);
	});

	it("a concurrent submit of two different pages for one slug yields one page and a CONFLICT, never a 500", async () => {
		const api = authedCaller(owner).uptimeMonitor.statusPage;
		const results = await Promise.allSettled([api.create({ ...input, title: "First" }), api.create({ ...input, title: "Second" })]);
		const fulfilled = results.filter(result => result.status === "fulfilled");
		const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]?.reason).toMatchObject({ code: "CONFLICT" });
		expect(await pages()).toHaveLength(1);
	});

	it.each(SUPPORTED_LANGUAGES)("maps a duplicate slug to a localized slug field error in %s", async language => {
		const api = authedCaller({ id: owner.id, language }).uptimeMonitor.statusPage;
		await api.create({ ...input });
		const error = await api.create({ ...input, title: "Other title" }).catch((caught: unknown) => caught);
		expect(error).toMatchObject({ code: "CONFLICT" });
		const t = getTranslator(language);
		if (!(error instanceof TRPCError)) throw new Error("Expected a typed tRPC conflict");
		const wire = formatApiError({ message: error.message, data: { code: "CONFLICT" } }, error, t);
		expect(wire.data.validationErrors?.fieldErrors).toEqual({ slug: [t("errors.statusPageSlugTaken")] });
		expect(wire.message).toBe(t("validation.reviewFields"));
	});
});
