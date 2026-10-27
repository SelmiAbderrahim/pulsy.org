import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trpcQuery } from "@/lib/api/trpc";
import { createWrapper } from "@/test/query-wrapper";
import { useConfig } from "./useConfig";
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "config-owner" } } }) }));

vi.mock("@/lib/api/trpc", () => ({
	trpcQuery: vi.fn(),
}));

const mockQuery = vi.mocked(trpcQuery);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("useConfig", () => {
	it("queries config.get and returns the policy", async () => {
		mockQuery.mockResolvedValue({ requireEmailVerification: true });
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useConfig(), { wrapper: Wrapper });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mockQuery).toHaveBeenCalledWith("config", "get");
		expect(result.current.data).toEqual({ requireEmailVerification: true });
	});
});
