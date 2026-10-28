/**
 * API Key Hooks — React Query hooks for the public-API key manager.
 *
 * @module hooks/apiKeys/useApiKeys
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { removeCachedRows } from "@/hooks/uptime/optimistic-cache";
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
		onMutate: async ({ apiKeyId }) => {
			const key = uptimeKeys.apiKeys.lists();
			await queryClient.cancelQueries({ queryKey: key });
			type Keys = Awaited<ReturnType<typeof ApiKeyService.listApiKeys>>;
			const previous = queryClient.getQueryData<Keys>(key)?.find(row => row.apiKeyId === apiKeyId);
			queryClient.setQueryData<Keys>(key, rows => rows?.map(row => row.apiKeyId === apiKeyId ? { ...row, revokedAt: new Date().toISOString() } : row));
			return () => {
				if (previous) queryClient.setQueryData<Keys>(key, rows => rows?.map(row => row.apiKeyId === apiKeyId ? previous : row));
			};
		},
		onError: (_error, _input, rollback) => rollback?.(),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: uptimeKeys.apiKeys.lists() });
		},
	});
}

/** Remove an already revoked key from the owner's list. */
export function useRemoveApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (apiKeyId: string) => ApiKeyService.removeApiKey(apiKeyId),
    onMutate: apiKeyId => removeCachedRows<Awaited<ReturnType<typeof ApiKeyService.listApiKeys>>[number]>(client, uptimeKeys.apiKeys.lists(), row => row.apiKeyId === apiKeyId),
    onError: (_error, _id, rollback) => rollback?.(),
    onSettled: () => client.invalidateQueries({ queryKey: uptimeKeys.apiKeys.lists() }),
  });
}
