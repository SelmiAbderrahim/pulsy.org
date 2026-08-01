import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UptimeService } from "@/services/uptime/uptimeService";
import { createWrapper } from "@/test/query-wrapper";
import { uptimeKeys } from "./queryKeys";
import { useBulkUptimeActions } from "./useBulkUptimeActions";

vi.mock("@/services/uptime/uptimeService", () => ({
	UptimeService: {
		deleteMonitor: vi.fn(),
		toggleActive: vi.fn(),
	},
}));

const svc = vi.mocked(UptimeService);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("useBulkUptimeActions.deleteMultiple", () => {
	it("deletes all ids, returns successful results, and invalidates", async () => {
		svc.deleteMonitor.mockResolvedValue(undefined as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useBulkUptimeActions(), {
			wrapper: Wrapper,
		});
		let res!: Awaited<ReturnType<typeof result.current.deleteMultiple>>;
		await act(async () => {
			res = await result.current.deleteMultiple(["a", "b"]);
		});
		expect(svc.deleteMonitor).toHaveBeenCalledTimes(2);
		expect(res.successful).toEqual(["a", "b"]);
		expect(res.failed).toEqual([]);
		expect(result.current.isProcessing).toBe(false);
		expect(spy).toHaveBeenCalledWith({ queryKey: uptimeKeys.monitors.lists() });
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.dashboard.summary(),
		});
	});

	it("collects failures without aborting the loop", async () => {
		const err = new Error("nope");
		svc.deleteMonitor
			.mockResolvedValueOnce(undefined as never)
			.mockRejectedValueOnce(err)
			.mockResolvedValueOnce(undefined as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useBulkUptimeActions(), {
			wrapper: Wrapper,
		});
		let res!: Awaited<ReturnType<typeof result.current.deleteMultiple>>;
		await act(async () => {
			res = await result.current.deleteMultiple(["a", "b", "c"]);
		});
		expect(res.successful).toEqual(["a", "c"]);
		expect(res.failed).toEqual([{ id: "b", error: err }]);
	});
});

describe("useBulkUptimeActions.setActiveMultiple", () => {
	it("toggles only monitors that do not match the target active state and invalidates", async () => {
		svc.toggleActive.mockResolvedValue(undefined as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useBulkUptimeActions(), {
			wrapper: Wrapper,
		});
		let res!: Awaited<ReturnType<typeof result.current.setActiveMultiple>>;
		await act(async () => {
			res = await result.current.setActiveMultiple(
				[
					{ uptimeMonitorId: "a", active: true },
					{ uptimeMonitorId: "b", active: false },
				],
				false,
			);
		});
		expect(svc.toggleActive).toHaveBeenCalledTimes(1);
		expect(svc.toggleActive).toHaveBeenCalledWith("a");
		expect(res.successful).toEqual(["a", "b"]);
		expect(spy).toHaveBeenCalledWith({ queryKey: uptimeKeys.monitors.lists() });
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.dashboard.summary(),
		});
	});

	it("collects toggle failures", async () => {
		const err = new Error("nope");
		svc.toggleActive.mockRejectedValueOnce(err).mockResolvedValueOnce(
			undefined as never,
		);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useBulkUptimeActions(), {
			wrapper: Wrapper,
		});
		let res!: Awaited<ReturnType<typeof result.current.setActiveMultiple>>;
		await act(async () => {
			res = await result.current.setActiveMultiple(
				[
					{ uptimeMonitorId: "a", active: true },
					{ uptimeMonitorId: "b", active: true },
				],
				false,
			);
		});
		expect(res.failed).toEqual([{ id: "a", error: err }]);
		expect(res.successful).toEqual(["b"]);
	});
});
