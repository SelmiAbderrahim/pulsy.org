import type { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { getTranslator, type Translator } from "../lib/i18n";

/** A service constraint tied to a field, with a server-owned translation key. */
export class FieldValidationError extends Error {
	constructor(readonly field: string, readonly translationKey: string) {
		super("Field validation failed");
	}
}

export interface StructuredValidationErrors {
  fieldErrors: Record<string, string[] | undefined>;
  formErrors: string[];
}

export function validationErrors(error: TRPCError, t: Translator): StructuredValidationErrors | null {
	if (error.cause instanceof FieldValidationError) {
		return { fieldErrors: { [error.cause.field]: [t(error.cause.translationKey)] }, formErrors: [] as string[] };
	}
	if (!(error.cause instanceof ZodError)) return null;
	// flatten preserves field/form mapping. Never copy issue.message: custom
	// refinements and enum/type issues can embed input values or credentials.
  return error.cause.flatten(issue => {
    if (issue.code === "custom" && ["validation.telegramTarget"].includes(issue.message)) return t(issue.message);
    if (issue.path[0] === "slug") return t("validation.statusPageSlug");
    if (issue.path[0] === "timezone") return t("validation.timezone");
    if (issue.code === "invalid_format" && issue.format === "email") return t("validation.email");
    if (issue.code === "too_small" && issue.origin === "string" && issue.minimum === 1) return t("validation.required");
    if (issue.code === "custom" && ["apiKey", "smtpHost", "smtpUsername", "smtpPassword", "smtpPort"].includes(String(issue.path[0]))) return t("validation.required");
    return t("validation.invalidField");
  });
}

export function formatApiError<T extends { message: string; data: { code: string; stack?: string } }>(
	shape: T, error: TRPCError, t: Translator = getTranslator("en"), requestId?: string,
) {
	const validation = validationErrors(error, t);
	const { stack: _stack, ...data } = shape.data;
	return {
		...shape,
		message: validation ? t("validation.reviewFields")
			: error.code === "INTERNAL_SERVER_ERROR" ? requestId ? t("errors.requestFailed", { requestId }) : t("errors.internal") : shape.message,
		data: { ...data, ...(requestId ? { requestId } : {}), validationErrors: validation },
	};
}
