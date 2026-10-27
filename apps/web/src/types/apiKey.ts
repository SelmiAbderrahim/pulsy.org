/**
 * API key types — mirror the server `apiKey.*` tRPC procedures.
 *
 * @module types/apiKey
 */

/** A masked API key row (never includes the secret hash or plaintext). */
export interface ApiKey {
	apiKeyId: string;
	name: string;
  scope: "read" | "full";
	/** First ~8 chars of the plaintext, shown so the user can identify a key. */
	keyPrefix: string;
	lastUsedAt: string | null;
	expiresAt: string | null;
	revokedAt: string | null;
	createdAt: string;
}

/** Create response: the masked row plus the plaintext, returned exactly once. */
export interface CreatedApiKey extends ApiKey {
	/** Full plaintext key (`pul_…`) — shown once, never returned again. */
	plaintext: string;
}

/** Input for `apiKey.create`. */
export interface CreateApiKeyInput {
	name: string;
  scope?: "read" | "full";
  expiresAt?: string | null;
}
