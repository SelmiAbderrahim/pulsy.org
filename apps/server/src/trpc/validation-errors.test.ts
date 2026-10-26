import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { formatApiError, FieldValidationError } from "./validation-errors";
import { DICTIONARIES, getTranslator, SUPPORTED_LANGUAGES } from "../lib/i18n";

const shape = { message: "raw failure", code: -32600, data: { code: "BAD_REQUEST", stack: "private stack", httpStatus: 400 } };

describe("safe structured validation errors", () => {
	it.each(SUPPORTED_LANGUAGES)("localizes field/form errors in %s without copying issue messages", lang => {
		const t = getTranslator(lang);
		const parsed = z.unknown().superRefine((_value, context) => {
			context.addIssue({ code: "custom", path: ["slug"], message: "Bad Slug--!! private input" });
			context.addIssue({ code: "custom", path: ["requestConfig", "headers", 0], message: "Authorization: secret" });
			context.addIssue({ code: "custom", path: [], message: "SQL private failure" });
		}).safeParse(null);
		if (parsed.success) throw new Error("Fixture must fail");
		const cause = parsed.error;
		const result = formatApiError(shape, new TRPCError({ code: "BAD_REQUEST", cause }), t);
		expect(result.message).toBe(t("validation.reviewFields"));
		expect(result.data.validationErrors).toEqual({ fieldErrors: { slug: [t("validation.statusPageSlug")], requestConfig: [t("validation.invalidField")] }, formErrors: [t("validation.invalidField")] });
		expect(result.data).not.toHaveProperty("stack");
		for (const secret of ["private", "Authorization", "secret", "SQL", "Bad Slug"]) expect(JSON.stringify(result)).not.toContain(secret);
		for (const key of ["validation.reviewFields", "validation.statusPageSlug", "validation.invalidField"]) expect(DICTIONARIES[lang][key]).toBeTruthy();
	});
	it("maps nested Zod problems to the top-level control", () => {
		const parsed = z.object({ config: z.object({ count: z.number() }) }).safeParse({ config: { count: "secret" } });
		if (parsed.success) throw new Error("Fixture must fail");
		expect(formatApiError(shape, new TRPCError({ code: "BAD_REQUEST", cause: parsed.error })).data.validationErrors?.fieldErrors).toEqual({ config: [getTranslator("en")("validation.invalidField")] });
	});
	it("maps duplicate slugs without exposing the submitted value", () => {
		const result = formatApiError(shape, new TRPCError({ code: "CONFLICT", cause: new FieldValidationError("slug", "errors.statusPageSlugTaken") }));
		expect(result.data.validationErrors?.fieldErrors.slug).toEqual([getTranslator("en")("errors.statusPageSlugTaken")]);
	});
	it("preserves useful domain errors and masks internal errors", () => {
		expect(formatApiError({ ...shape, message: "Page changed. Reload before saving." }, new TRPCError({ code: "CONFLICT" })).message).toBe("Page changed. Reload before saving.");
		const result = formatApiError(shape, new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database password" }));
		expect(result.message).toBe(getTranslator("en")("errors.internal"));
		expect(result.data.validationErrors).toBeNull();
		expect(result.data).not.toHaveProperty("stack");
	});
});
