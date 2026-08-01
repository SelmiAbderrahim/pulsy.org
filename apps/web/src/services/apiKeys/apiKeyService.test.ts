import { beforeEach, describe, expect, it, vi } from "vitest";

import { trpcMutation, trpcQuery } from "@/lib/api/trpc";

import { ApiKeyService } from "./apiKeyService";

vi.mock("@/lib/api/trpc", () => ({
	trpcQuery: vi.fn(),
	trpcMutation: vi.fn(),
}));

const mockQuery = vi.mocked(trpcQuery);
const mockMutation = vi.mocked(trpcMutation);

beforeEach(() => {
	vi.clearAllMocks();
	mockQuery.mockResolvedValue(undefined as never);
	mockMutation.mockResolvedValue(undefined as never);
});

describe("ApiKeyService", () => {
	it("listApiKeys queries apiKey.list", async () => {
		await ApiKeyService.listApiKeys();
		expect(mockQuery).toHaveBeenCalledWith("apiKey", "list");
	});

	it("createApiKey mutates apiKey.create with the input", async () => {
		await ApiKeyService.createApiKey({ name: "CI" });
		expect(mockMutation).toHaveBeenCalledWith("apiKey", "create", {
			name: "CI",
		});
	});

	it("revokeApiKey mutates apiKey.revoke with the id", async () => {
		await ApiKeyService.revokeApiKey("k1");
		expect(mockMutation).toHaveBeenCalledWith("apiKey", "revoke", {
			apiKeyId: "k1",
		});
	});
});
