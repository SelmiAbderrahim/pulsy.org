/**
 * Produce a diagnostic label without logging an exception message, stack, or
 * arbitrary thrown value. Those fields can contain credentials, request
 * bodies, provider responses, URLs, or other user-controlled data.
 */
export function safeErrorSummary(value: unknown): string {
	if (!(value instanceof Error)) {
		return "Unknown error";
	}

	const name = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value.name)
		? value.name
		: "Error";
	const code = (value as NodeJS.ErrnoException).code;
	if (typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code)) {
		return `${name} (${code})`;
	}

	return name;
}
