import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UptimeService } from "@/services/uptime/uptimeService";
import { createWrapper } from "@/test/query-wrapper";
import { useIncidentSearch } from "./useIncidentSearch";

vi.mock("@/services/uptime/uptimeService", () => ({
	UptimeService: {
		searchIncidents: vi.fn(),
	},
}));

const svc = vi.mocked(UptimeService);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("useIncidentSearch", () => {
	it("searches incidents with the trimmed query", async () => {
		svc.searchIncidents.mockResolvedValue([] as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useIncidentSearch("  api  "), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.searchIncidents).toHaveBeenCalledWith("api");
	});

	it("is idle for an empty query", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useIncidentSearch("   "), {
			wrapper: Wrapper,
		});
		expect(result.current.fetchStatus).toBe("idle");
		expect(svc.searchIncidents).not.toHaveBeenCalled();
	});

	it("is idle when explicitly disabled", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useIncidentSearch("api", { enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
		expect(svc.searchIncidents).not.toHaveBeenCalled();
	});
});
