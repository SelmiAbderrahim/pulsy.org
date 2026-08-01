/**
 * Extract a user-friendly error message from any error shape.
 *
 * Returns a meaningful message from the error when available, otherwise the
 * provided fallback. tRPC v11 errors surface their message on `error.message`.
 *
 * @module lib/api/extractErrorMessage
 *
 * @example
 * ```typescript
 * try {
 *   await createMutation.mutateAsync(input);
 * } catch (error) {
 *   toast.error(extractErrorMessage(error, t("create.error")));
 * }
 * ```
 */
export function extractErrorMessage(
	error: unknown,
	fallbackMessage: string,
): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}

	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof (error as { message: unknown }).message === "string"
	) {
		const message = (error as { message: string }).message.trim();
		if (message.length > 0) return message;
	}

	return fallbackMessage;
}
