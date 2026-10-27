/**
 * API Key Service — operations for the public-API key management UI.
 *
 * The dashboard manages keys over the session-authenticated `apiKey.*` tRPC
 * router (the keys themselves authenticate the separate `/api/v1` REST API).
 *
 * @module services/apiKeys/apiKeyService
 */

import { trpcMutation, trpcQuery } from "@/lib/api/trpc";
import type { ApiKey, CreateApiKeyInput, CreatedApiKey } from "@/types/apiKey";

export const ApiKeyService = {
  async removeApiKey(apiKeyId: string): Promise<{ success: boolean }> {
    return trpcMutation("apiKey", "remove", { apiKeyId });
  },
	/** List the current user's API keys (masked). */
	async listApiKeys(): Promise<ApiKey[]> {
		return trpcQuery<ApiKey[]>("apiKey", "list");
	},

	/** Create a key; the response carries the plaintext exactly once. */
	async createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
		return trpcMutation<CreatedApiKey>("apiKey", "create", input);
	},

	/** Revoke a key the user owns. */
	async revokeApiKey(apiKeyId: string): Promise<{ success: boolean }> {
		return trpcMutation<{ success: boolean }>("apiKey", "revoke", {
			apiKeyId,
		});
	},
};
