/**
 * API Key Hooks — React Query hooks for the public-API key manager.
 *
 * @module hooks/apiKeys/useApiKeys
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { ApiKeyService } from "@/services/apiKeys/apiKeyService";
import type { CreateApiKeyInput } from "@/types/apiKey";

/** List the current user's API keys. */
export function useApiKeys(options?: { enabled?: boolean }) {
	return useQuery({
		queryKey: uptimeKeys.apiKeys.lists(),
		queryFn: () => ApiKeyService.listApiKeys(),
		enabled: options?.enabled !== false,
		staleTime: 1000 * 30,
	});
}

/** Create a key. The returned `plaintext` is shown to the user exactly once. */
export function useCreateApiKey() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: CreateApiKeyInput) =>
			ApiKeyService.createApiKey(input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: uptimeKeys.apiKeys.lists() });
		},
	});
}

/** Revoke a key. */
export function useRevokeApiKey() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({ apiKeyId }: { apiKeyId: string }) =>
			ApiKeyService.revokeApiKey(apiKeyId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: uptimeKeys.apiKeys.lists() });
		},
	});
}
