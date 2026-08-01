import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiKeyService } from "@/services/apiKeys/apiKeyService";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { createWrapper } from "@/test/query-wrapper";

import {
	useApiKeys,
	useCreateApiKey,
	useRevokeApiKey,
} from "./useApiKeys";

vi.mock("@/services/apiKeys/apiKeyService", () => ({
	ApiKeyService: {
		listApiKeys: vi.fn(),
		createApiKey: vi.fn(),
		revokeApiKey: vi.fn(),
	},
}));

const svc = vi.mocked(ApiKeyService);

beforeEach(() => {
	vi.clearAllMocks();
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
