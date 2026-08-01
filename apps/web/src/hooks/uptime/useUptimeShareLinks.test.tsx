import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UptimeService } from "@/services/uptime/uptimeService";
import { createWrapper } from "@/test/query-wrapper";
import { uptimeKeys } from "./queryKeys";
import {
	useCloneSharedMonitors,
	useCreateUptimeShareLink,
	useResolveShareLink,
	useRevokeUptimeShareLink,
	useUptimeShareLinks,
} from "./useUptimeShareLinks";

vi.mock("@/services/uptime/uptimeService", () => ({
	UptimeService: {
		createShareLink: vi.fn(),
		listShareLinks: vi.fn(),
		revokeShareLink: vi.fn(),
		resolveShareLink: vi.fn(),
		cloneSharedMonitors: vi.fn(),
	},
}));

const svc = vi.mocked(UptimeService);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("useUptimeShareLinks", () => {
	it("fetches the share link list", async () => {
		svc.listShareLinks.mockResolvedValue([{ shareLinkId: "s1" }] as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeShareLinks(), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.listShareLinks).toHaveBeenCalledTimes(1);
		expect(result.current.data).toEqual([{ shareLinkId: "s1" }]);
	});

	it("is disabled when enabled is false", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeShareLinks({ enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
		expect(svc.listShareLinks).not.toHaveBeenCalled();
	});
});

describe("useCreateUptimeShareLink", () => {
	it("calls the service and invalidates the share link list", async () => {
		svc.createShareLink.mockResolvedValue({ token: "tok" } as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useCreateUptimeShareLink(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({ uptimeMonitorIds: ["m1"] });
		});
		expect(svc.createShareLink).toHaveBeenCalledWith({
			uptimeMonitorIds: ["m1"],
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.shareLinks.lists(),
		});
	});

	it("surfaces service errors", async () => {
		svc.createShareLink.mockRejectedValue(new Error("boom"));
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useCreateUptimeShareLink(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await expect(
				result.current.mutateAsync({ uptimeMonitorIds: ["m1"] }),
			).rejects.toThrow("boom");
		});
	});
});

describe("useRevokeUptimeShareLink", () => {
	it("calls the service and invalidates the share link list", async () => {
		svc.revokeShareLink.mockResolvedValue(undefined as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useRevokeUptimeShareLink(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({ shareLinkId: "s1" });
		});
		expect(svc.revokeShareLink).toHaveBeenCalledWith("s1");
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.shareLinks.lists(),
		});
	});
});

describe("useResolveShareLink", () => {
	it("resolves a token", async () => {
		svc.resolveShareLink.mockResolvedValue({ monitors: [] } as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useResolveShareLink("tok1"), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.resolveShareLink).toHaveBeenCalledWith("tok1");
	});

	it("is disabled when the token is empty", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useResolveShareLink(""), {
			wrapper: Wrapper,
		});
		expect(result.current.fetchStatus).toBe("idle");
		expect(svc.resolveShareLink).not.toHaveBeenCalled();
	});

	it("is disabled when enabled is false even with a token", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useResolveShareLink("tok1", { enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
		expect(svc.resolveShareLink).not.toHaveBeenCalled();
	});

	it("reports errors without retrying", async () => {
		svc.resolveShareLink.mockRejectedValue(new Error("expired"));
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useResolveShareLink("tok1"), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isError).toBe(true));
		expect(svc.resolveShareLink).toHaveBeenCalledTimes(1);
	});
});

describe("useCloneSharedMonitors", () => {
	it("calls the service and invalidates monitors + dashboard", async () => {
		svc.cloneSharedMonitors.mockResolvedValue([] as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useCloneSharedMonitors(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({
				token: "tok1",
				uptimeMonitorIds: ["m1"],
			});
		});
		expect(svc.cloneSharedMonitors).toHaveBeenCalledWith("tok1", ["m1"]);
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.monitors.lists(),
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.dashboard.summary(),
		});
	});
});
