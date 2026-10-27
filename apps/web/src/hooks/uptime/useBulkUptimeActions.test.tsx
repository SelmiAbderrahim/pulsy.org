import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UptimeService } from "@/services/uptime/uptimeService";
import { createWrapper } from "@/test/query-wrapper";
import { uptimeKeys } from "./queryKeys";
import { useBulkUptimeActions } from "./useBulkUptimeActions";

vi.mock("@/services/uptime/uptimeService", () => ({
	UptimeService: {
		deleteMonitorsBulk: vi.fn(),
		toggleActive: vi.fn(),
	},
}));

const svc = vi.mocked(UptimeService);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("useBulkUptimeActions.deleteMultiple", () => {
	it("deletes all ids, returns successful results, and invalidates", async () => {
		svc.deleteMonitorsBulk.mockResolvedValue([{id:"a",status:"deleted"},{id:"b",status:"deleted"}]);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useBulkUptimeActions(), {
			wrapper: Wrapper,
		});
		let res!: Awaited<ReturnType<typeof result.current.deleteMultiple>>;
		await act(async () => {
			res = await result.current.deleteMultiple(["a", "b"]);
		});
		expect(svc.deleteMonitorsBulk).toHaveBeenCalledTimes(1);
		expect(svc.deleteMonitorsBulk).toHaveBeenCalledWith(["a","b"]);
		expect(res.successful).toEqual(["a", "b"]);
		expect(res.failed).toEqual([]);
		expect(result.current.isProcessing).toBe(false);
		expect(spy).toHaveBeenCalledTimes(2);
		expect(spy).toHaveBeenCalledWith({ queryKey: uptimeKeys.monitors.lists() });
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.dashboard.summary(),
		});
	});

	it("reports per-item rejections from one bulk request", async () => {
		const err = new Error("nope");
		svc.deleteMonitorsBulk.mockResolvedValue([{id:"a",status:"deleted"},{id:"b",status:"rejected",reason:err.message},{id:"c",status:"deleted"}]);
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

describe("useBulkUptimeActions optimistic deletion", () => {
	const row = (id: string) => ({ uptimeMonitorId: id, name: id, status: "up", active: true, responseTime: 10, uptimePercentage: 100 }) as never;
	function seeded() {
		const { Wrapper, client } = createWrapper();
		client.setQueryData(uptimeKeys.monitors.lists(), [row("a"), row("b"), row("c")]);
		client.setQueryData(uptimeKeys.dashboard.summary(), { totalMonitors: 3, monitorsUp: 3, monitorsDown: 0, monitorsDegraded: 0, monitorsPending: 0, monitorsPaused: 0, activeMonitors: 3, avgResponseTime: 10, avgUptimePercentage: 100, uptimeMonitorsWithData: 3 });
		return { Wrapper, client };
	}
	const ids = (client: ReturnType<typeof seeded>["client"]) => (client.getQueryData<{ uptimeMonitorId: string }[]>(uptimeKeys.monitors.lists()) ?? []).map(r => r.uptimeMonitorId).sort();

	it("removes the rows and updates Total before the request settles", async () => {
		let release!: (value: { id: string; status: "deleted" }[]) => void;
		svc.deleteMonitorsBulk.mockReturnValue(new Promise(resolve => { release = resolve as never; }));
		const { Wrapper, client } = seeded();
		const { result } = renderHook(() => useBulkUptimeActions(), { wrapper: Wrapper });
		let pending!: Promise<unknown>;
		await act(async () => { pending = result.current.deleteMultiple(["a", "b"]); await Promise.resolve(); });
		await waitFor(() => expect(ids(client)).toEqual(["c"]));
		expect(client.getQueryData<{ totalMonitors: number }>(uptimeKeys.dashboard.summary())?.totalMonitors).toBe(1);
		await act(async () => { release([{ id: "a", status: "deleted" }, { id: "b", status: "deleted" }]); await pending; });
		expect(ids(client)).toEqual(["c"]);
	});

	it("restores every row and the counters when the request fails", async () => {
		svc.deleteMonitorsBulk.mockRejectedValue(new Error("503"));
		const { Wrapper, client } = seeded();
		const { result } = renderHook(() => useBulkUptimeActions(), { wrapper: Wrapper });
		let res!: Awaited<ReturnType<typeof result.current.deleteMultiple>>;
		await act(async () => { res = await result.current.deleteMultiple(["a", "b"]); });
		expect(res.failed.map(item => item.id)).toEqual(["a", "b"]);
		expect(ids(client)).toEqual(["a", "b", "c"]);
		expect(client.getQueryData<{ totalMonitors: number }>(uptimeKeys.dashboard.summary())?.totalMonitors).toBe(3);
	});

	it("restores only the rows the server rejected", async () => {
		svc.deleteMonitorsBulk.mockResolvedValue([{ id: "a", status: "deleted" }, { id: "b", status: "rejected", reason: "busy" }] as never);
		const { Wrapper, client } = seeded();
		const { result } = renderHook(() => useBulkUptimeActions(), { wrapper: Wrapper });
		await act(async () => { await result.current.deleteMultiple(["a", "b"]); });
		expect(ids(client)).toEqual(["b", "c"]);
		expect(client.getQueryData<{ totalMonitors: number }>(uptimeKeys.dashboard.summary())?.totalMonitors).toBe(2);
	});
});
