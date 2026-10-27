import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UptimeService } from "@/services/uptime/uptimeService";
import { createWrapper } from "@/test/query-wrapper";
import { uptimeKeys } from "./queryKeys";
import {
	useBulkUpdateUptimeSettings,
	useCheckNow,
	useCreateUptimeMonitor,
	useCreateUptimeMonitorsBulk,
	useDeleteUptimeMonitor,
	useToggleUptimeMonitor,
	useUpdateUptimeMonitor,
	useUptimeMonitor,
	useUptimeMonitors,
} from "./useUptimeMonitors";

vi.mock("@/services/uptime/uptimeService", () => ({
	UptimeService: {
		listMonitors: vi.fn(),
		getMonitor: vi.fn(),
		createMonitor: vi.fn(),
		createMonitorsBulk: vi.fn(),
		updateMonitor: vi.fn(),
		updateMonitorsBulk: vi.fn(),
		deleteMonitor: vi.fn(),
		toggleActive: vi.fn(),
		checkNow: vi.fn(),
	},
}));

const svc = vi.mocked(UptimeService);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("useUptimeMonitors", () => {
	it("fetches the monitor list", async () => {
		svc.listMonitors.mockResolvedValue([{ uptimeMonitorId: "m1" }] as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeMonitors(), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.listMonitors).toHaveBeenCalledTimes(1);
		expect(result.current.data).toEqual([{ uptimeMonitorId: "m1" }]);
	});

	it("is disabled when enabled is false", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeMonitors({ enabled: false }), {
			wrapper: Wrapper,
		});
		expect(result.current.fetchStatus).toBe("idle");
		expect(svc.listMonitors).not.toHaveBeenCalled();
	});
});

describe("useUptimeMonitor", () => {
	it("fetches a single monitor by id", async () => {
		svc.getMonitor.mockResolvedValue({ uptimeMonitorId: "m1" } as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeMonitor("m1"), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.getMonitor).toHaveBeenCalledWith("m1");
	});

	it("is disabled when id is empty", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeMonitor(""), {
			wrapper: Wrapper,
		});
		expect(result.current.fetchStatus).toBe("idle");
		expect(svc.getMonitor).not.toHaveBeenCalled();
	});

	it("is disabled when enabled is false even with an id", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeMonitor("m1", { enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
		expect(svc.getMonitor).not.toHaveBeenCalled();
	});
});

describe("useCreateUptimeMonitor", () => {
	it("calls the service and invalidates list + dashboard on success", async () => {
		svc.createMonitor.mockResolvedValue({ uptimeMonitorId: "m1" } as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useCreateUptimeMonitor(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({ url: "https://x.com" } as never);
		});
		expect(svc.createMonitor).toHaveBeenCalledWith({ url: "https://x.com" });
		expect(spy).toHaveBeenCalledWith({ queryKey: uptimeKeys.monitors.lists() });
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.dashboard.summary(),
		});
	});
});

describe("useCreateUptimeMonitorsBulk", () => {
	it("calls the service and invalidates list + dashboard", async () => {
		svc.createMonitorsBulk.mockResolvedValue([] as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useCreateUptimeMonitorsBulk(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync([{ url: "https://x.com" }] as never);
		});
		expect(svc.createMonitorsBulk).toHaveBeenCalledWith([
			{ url: "https://x.com" },
		]);
		expect(spy).toHaveBeenCalledWith({ queryKey: uptimeKeys.monitors.lists() });
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.dashboard.summary(),
		});
	});
});

describe("useBulkUpdateUptimeSettings", () => {
	it("calls the service and invalidates list, details, and dashboard", async () => {
		svc.updateMonitorsBulk.mockResolvedValue({ updated: [], results: [] });
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useBulkUpdateUptimeSettings(), {
			wrapper: Wrapper,
		});
		const input = { monitorIds: ["m1"], patch: { timeout: 5000 } };
		await act(async () => {
			await result.current.mutateAsync(input as never);
		});
		expect(svc.updateMonitorsBulk).toHaveBeenCalledWith(input);
		expect(spy).toHaveBeenCalledWith({ queryKey: uptimeKeys.monitors.lists() });
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.monitors.detail("m1"),
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.dashboard.summary(),
		});
	});
});

describe("useUpdateUptimeMonitor", () => {
  it("keeps replacement request credentials out of the shared optimistic cache", async () => {
    let reject!: (error: Error) => void;
    svc.updateMonitor.mockImplementation(() => new Promise((_done, fail) => { reject = fail; }));
    const { Wrapper, client } = createWrapper();
    const previous = { uptimeMonitorId: "m1", name: "old", requestConfigured: true };
    client.setQueryData(uptimeKeys.monitors.detail("m1"), previous);
    const { result } = renderHook(() => useUpdateUptimeMonitor(), { wrapper: Wrapper });
    const requestConfig = { headers: [{ name: "Authorization", value: "private-header" }], auth: { type: "bearer" as const, token: "private-token" } };
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.mutateAsync({ uptimeMonitorId: "m1", name: "new", requestConfig }).catch(() => undefined);
    });
    await waitFor(() => expect(svc.updateMonitor).toHaveBeenCalledOnce());
    expect(client.getQueryData(uptimeKeys.monitors.detail("m1"))).toEqual({ ...previous, name: "new" });
    expect(JSON.stringify(client.getQueryData(uptimeKeys.monitors.detail("m1")))).not.toContain("private-");
    await act(async () => { reject(new Error("Rejected replacement")); await pending; });
    expect(client.getQueryData(uptimeKeys.monitors.detail("m1"))).toEqual(previous);
  });

	it("optimistically updates cached detail and settles invalidation", async () => {
		svc.updateMonitor.mockResolvedValue({ uptimeMonitorId: "m1" } as never);
		const { Wrapper, client } = createWrapper();
		client.setQueryData(uptimeKeys.monitors.detail("m1"), {
			uptimeMonitorId: "m1",
			name: "old",
		});
		const cancelSpy = vi.spyOn(client, "cancelQueries");
		const invalidateSpy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useUpdateUptimeMonitor(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({
				uptimeMonitorId: "m1",
				name: "new",
			} as never);
		});
		expect(cancelSpy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.monitors.detail("m1"),
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.monitors.detail("m1"),
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.monitors.lists(),
		});
	});

	it("rolls back the cache on error", async () => {
		svc.updateMonitor.mockRejectedValue(new Error("fail"));
		const { Wrapper, client } = createWrapper();
		const previous = { uptimeMonitorId: "m1", name: "old" };
		client.setQueryData(uptimeKeys.monitors.detail("m1"), previous);
		const { result } = renderHook(() => useUpdateUptimeMonitor(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current
				.mutateAsync({ uptimeMonitorId: "m1", name: "new" } as never)
				.catch(() => undefined);
		});
		expect(
			client.getQueryData(uptimeKeys.monitors.detail("m1")),
		).toEqual(previous);
	});

	it("handles update when there is no cached detail (no optimistic write)", async () => {
		svc.updateMonitor.mockResolvedValue({ uptimeMonitorId: "m2" } as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUpdateUptimeMonitor(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({
				uptimeMonitorId: "m2",
				name: "x",
			} as never);
		});
		expect(svc.updateMonitor).toHaveBeenCalled();
	});

	it("error path is a no-op when there is no previous cache", async () => {
		svc.updateMonitor.mockRejectedValue(new Error("fail"));
		const { Wrapper, client } = createWrapper();
		const { result } = renderHook(() => useUpdateUptimeMonitor(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current
				.mutateAsync({ uptimeMonitorId: "m3", name: "x" } as never)
				.catch(() => undefined);
		});
		expect(
			client.getQueryData(uptimeKeys.monitors.detail("m3")),
		).toBeUndefined();
	});
});

describe("useDeleteUptimeMonitor", () => {
	it("removes detail and invalidates list + dashboard on success", async () => {
		svc.deleteMonitor.mockResolvedValue(undefined as never);
		const { Wrapper, client } = createWrapper();
		const removeSpy = vi.spyOn(client, "removeQueries");
		const invalidateSpy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useDeleteUptimeMonitor(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({ uptimeMonitorId: "m1" });
		});
		expect(svc.deleteMonitor).toHaveBeenCalledWith("m1");
		expect(removeSpy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.monitors.detail("m1"),
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.monitors.lists(),
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.dashboard.summary(),
		});
	});
});

describe("useToggleUptimeMonitor", () => {
	it("optimistically flips active and settles", async () => {
		svc.toggleActive.mockResolvedValue({ uptimeMonitorId: "m1" } as never);
		const { Wrapper, client } = createWrapper();
		client.setQueryData(uptimeKeys.monitors.detail("m1"), {
			uptimeMonitorId: "m1",
			active: true,
		});
		const invalidateSpy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useToggleUptimeMonitor(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync({ uptimeMonitorId: "m1" });
		});
		expect(svc.toggleActive).toHaveBeenCalledWith("m1");
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.monitors.detail("m1"),
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.dashboard.summary(),
		});
	});

	it("rolls back on error", async () => {
		svc.toggleActive.mockRejectedValue(new Error("fail"));
		const { Wrapper, client } = createWrapper();
		const previous = { uptimeMonitorId: "m1", active: true };
		client.setQueryData(uptimeKeys.monitors.detail("m1"), previous);
		const { result } = renderHook(() => useToggleUptimeMonitor(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current
				.mutateAsync({ uptimeMonitorId: "m1" })
				.catch(() => undefined);
		});
		expect(client.getQueryData(uptimeKeys.monitors.detail("m1"))).toEqual(
			previous,
		);
	});

	it("no-op optimistic write and error when no cache present", async () => {
		svc.toggleActive.mockRejectedValue(new Error("fail"));
		const { Wrapper, client } = createWrapper();
		const { result } = renderHook(() => useToggleUptimeMonitor(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current
				.mutateAsync({ uptimeMonitorId: "m9" })
				.catch(() => undefined);
		});
		expect(
			client.getQueryData(uptimeKeys.monitors.detail("m9")),
		).toBeUndefined();
	});
});

describe("useCheckNow", () => {
	it("invalidates all relevant keys on success", async () => {
		svc.checkNow.mockResolvedValue(undefined as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useCheckNow(), { wrapper: Wrapper });
		await act(async () => {
			await result.current.mutateAsync({ uptimeMonitorId: "m1" });
		});
		expect(svc.checkNow).toHaveBeenCalledWith("m1");
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.monitors.detail("m1"),
		});
		expect(spy).toHaveBeenCalledWith({ queryKey: uptimeKeys.monitors.lists() });
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.checkLogs.list("m1"),
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.checkLogs.stats("m1"),
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.statusChanges.list("m1"),
		});
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.dashboard.summary(),
		});
	});
});
