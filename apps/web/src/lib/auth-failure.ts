/**
 * Which message an auth failure deserves. A rate-limited response (HTTP 429) is neither a wrong password nor a
 * broken request: say so, so a person is not left re-typing credentials that were fine.
 */
export function authFailureKey(error: unknown, fallback: string): string {
	const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : 0;
	return status === 429 ? "auth:ux.rateLimited" : fallback;
}
