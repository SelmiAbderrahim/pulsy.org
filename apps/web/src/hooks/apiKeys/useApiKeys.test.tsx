import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiKeyService } from "@/services/apiKeys/apiKeyService";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { createWrapper } from "@/test/query-wrapper";

import {
	useApiKeys,
	useCreateApiKey,
	useRemoveApiKey,
	useRevokeApiKey,
} from "./useApiKeys";

vi.mock("@/services/apiKeys/apiKeyService", () => ({
	ApiKeyService: {
		listApiKeys: vi.fn(),
		createApiKey: vi.fn(),
		revokeApiKey: vi.fn(),
		removeApiKey: vi.fn(),
	},
}));

const svc = vi.mocked(ApiKeyService);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("optimistic API-key changes", () => {
	const keys = () => [{ apiKeyId: "k1", revokedAt: null }, { apiKeyId: "k2", revokedAt: null }];
	const read = (client: ReturnType<typeof createWrapper>["client"]) => client.getQueryData<ReturnType<typeof keys>>(uptimeKeys.apiKeys.lists());

	it("marks only the requested key revoked while the request is pending", async () => {
		let resolve!: (value: never) => void;
		svc.revokeApiKey.mockReturnValue(new Promise(done => { resolve = done; }));
		const { Wrapper, client } = createWrapper();
		client.setQueryData(uptimeKeys.apiKeys.lists(), keys());
		const { result } = renderHook(() => useRevokeApiKey(), { wrapper: Wrapper });
		const done = result.current.mutateAsync({ apiKeyId: "k1" });
		await waitFor(() => expect(read(client)?.[0]?.revokedAt).toEqual(expect.any(String)));
		expect(read(client)?.[1]?.revokedAt).toBeNull();
		resolve({ success: true } as never);
		await done;
	});

	it("restores the list and refetches after a failed revocation", async () => {
		svc.revokeApiKey.mockRejectedValue(new Error("unavailable"));
		const { Wrapper, client } = createWrapper();
		client.setQueryData(uptimeKeys.apiKeys.lists(), keys());
		const invalidate = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useRevokeApiKey(), { wrapper: Wrapper });
		await expect(result.current.mutateAsync({ apiKeyId: "k1" })).rejects.toThrow("unavailable");
		expect(read(client)).toEqual(keys());
		expect(invalidate).toHaveBeenCalledWith({ queryKey: uptimeKeys.apiKeys.lists() });
	});

	it("removes only the selected key before the server responds", async () => {
		let resolve!: (value: never) => void;
		svc.removeApiKey.mockReturnValue(new Promise(done => { resolve = done; }));
		const { Wrapper, client } = createWrapper();
		client.setQueryData(uptimeKeys.apiKeys.lists(), keys());
		const { result } = renderHook(() => useRemoveApiKey(), { wrapper: Wrapper });
		const done = result.current.mutateAsync("k1");
		await waitFor(() => expect(read(client)?.map(row => row.apiKeyId)).toEqual(["k2"]));
		resolve({ success: true } as never);
		await done;
		expect(read(client)?.map(row => row.apiKeyId)).toEqual(["k2"]);
	});

	it("restores removed keys and refetches after a failed removal", async () => {
		svc.removeApiKey.mockRejectedValue(new Error("unavailable"));
		const { Wrapper, client } = createWrapper();
		client.setQueryData(uptimeKeys.apiKeys.lists(), keys());
		const invalidate = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useRemoveApiKey(), { wrapper: Wrapper });
		await expect(result.current.mutateAsync("k1")).rejects.toThrow("unavailable");
		expect(read(client)?.map(row => row.apiKeyId).sort()).toEqual(["k1", "k2"]);
		expect(invalidate).toHaveBeenCalledWith({ queryKey: uptimeKeys.apiKeys.lists() });
	});
});

describe("useApiKeys", () => {
	it("fetches the key list", async () => {
		svc.listApiKeys.mockResolvedValue([{ apiKeyId: "k1" }] as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useApiKeys(), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual([{ apiKeyId: "k1" }]);
	});

	it("is disabled when enabled is false", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useApiKeys({ enabled: false }), {
			wrapper: Wrapper,
		});
		expect(result.current.fetchStatus).toBe("idle");
		expect(svc.listApiKeys).not.toHaveBeenCalled();
	});
});

describe("useCreateApiKey", () => {
	it("creates a key and invalidates the list", async () => {
		svc.createApiKey.mockResolvedValue({ plaintext: "pul_x" } as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useCreateApiKey(), {
			wrapper: Wrapper,
		});
		await result.current.mutateAsync({ name: "CI" });
		expect(svc.createApiKey).toHaveBeenCalledWith({ name: "CI" });
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.apiKeys.lists(),
		});
	});
});

describe("useRevokeApiKey", () => {
	it("revokes a key and invalidates the list", async () => {
		svc.revokeApiKey.mockResolvedValue({ success: true } as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useRevokeApiKey(), {
			wrapper: Wrapper,
		});
		await result.current.mutateAsync({ apiKeyId: "k1" });
		expect(svc.revokeApiKey).toHaveBeenCalledWith("k1");
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.apiKeys.lists(),
		});
	});
});
