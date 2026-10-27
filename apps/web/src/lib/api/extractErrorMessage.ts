import i18n from "i18next";

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function safeMessage(value: unknown): value is string {
	if (typeof value !== "string" || !value.trim() || value.length > 500) return false;
	// Also protect consumers talking to an older server with serialized Zod issues.
	return !/^\s*[[{]/.test(value) && !/\n\s*at\s|\b(?:ZodError|TRPCError)\b/.test(value);
}

/** Map only rendered fields. Unknown paths remain covered by the form summary. */
export function extractFieldErrors<K extends string>(error: unknown, fields: readonly K[]): Partial<Record<K, string>> {
	const validation = record(record(record(error)?.data)?.validationErrors);
	const fieldErrors = record(validation?.fieldErrors);
	const result: Partial<Record<K, string>> = {};
	for (const field of fields) {
		const messages = fieldErrors?.[field];
		if (Array.isArray(messages)) {
			const message = messages.find(safeMessage);
			if (message) result[field] = message;
		}
	}
	return result;
}

/** Validation uses a localized consumer fallback; useful domain errors survive. */
export function extractErrorMessage(error: unknown, fallbackMessage: string): string {
	const source = record(error);
	const data = record(source?.data);
	if (typeof data?.requestId === "string" && /^[a-f0-9-]{36}$/.test(data.requestId)) return i18n.t("common:states.serverProblemReference", {requestId:data.requestId});
	if (data?.code === "INTERNAL_SERVER_ERROR" || data?.code === "TIMEOUT" || (typeof data?.httpStatus === "number" && data.httpStatus >= 500)) return i18n.t("common:states.serverProblem");
	if (data?.validationErrors) return fallbackMessage;
	return safeMessage(source?.message) ? source.message : fallbackMessage;
}
