import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UptimeService } from "@/services/uptime/uptimeService";
import { createWrapper } from "@/test/query-wrapper";
import { uptimeKeys } from "./queryKeys";
import {
	useUptimeCheckLogs,
	useUptimeDailyUptime,
	useUptimeDashboardSummary,
	useUptimeIncident,
	useUptimeIncidents,
	useUptimeMonitorStats,
	useUptimeNotificationLogs,
	useUptimeStatusChanges,
} from "./useUptimeStats";

vi.mock("@/services/uptime/uptimeService", () => ({
	UptimeService: {
		getDashboardSummary: vi.fn(),
		getDailyUptime: vi.fn(),
		getCheckLogStats: vi.fn(),
		listCheckLogs: vi.fn(),
		listNotificationLogs: vi.fn(),
		listStatusChanges: vi.fn(),
		listIncidents: vi.fn(),
		getIncident: vi.fn(),
	},
}));

const svc = vi.mocked(UptimeService);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("useUptimeDashboardSummary", () => {
	it("fetches the dashboard summary", async () => {
		svc.getDashboardSummary.mockResolvedValue({ total: 1 } as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeDashboardSummary(), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.getDashboardSummary).toHaveBeenCalled();
	});

	it("is disabled when enabled is false", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeDashboardSummary({ enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
	});
});

describe("useUptimeMonitorStats", () => {
	it("fetches stats with days param", async () => {
		svc.getCheckLogStats.mockResolvedValue({} as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeMonitorStats("m1", 7), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.getCheckLogStats).toHaveBeenCalledWith("m1", 7);
	});

	it("is disabled with empty monitor id", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeMonitorStats(""), {
			wrapper: Wrapper,
		});
		expect(result.current.fetchStatus).toBe("idle");
	});

	it("is disabled when enabled is false", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeMonitorStats("m1", 7, { enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
	});
});

describe("useUptimeCheckLogs", () => {
	it("fetches logs with pagination options", async () => {
		svc.listCheckLogs.mockResolvedValue({ logs: [], total: 0 } as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeCheckLogs("m1", { limit: 5, offset: 10 }),
			{ wrapper: Wrapper },
		);
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.listCheckLogs).toHaveBeenCalledWith("m1", {
			limit: 5,
			offset: 10,
		});
	});

	it("fetches logs with no options object", async () => {
		svc.listCheckLogs.mockResolvedValue({ logs: [], total: 0 } as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeCheckLogs("m1"), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.listCheckLogs).toHaveBeenCalledWith("m1", {
			limit: undefined,
			offset: undefined,
		});
	});

	it("is disabled with empty monitor id", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeCheckLogs(""), {
			wrapper: Wrapper,
		});
		expect(result.current.fetchStatus).toBe("idle");
	});

	it("is disabled when enabled is false", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeCheckLogs("m1", { enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
	});
});

describe("useUptimeNotificationLogs", () => {
	it("fetches a monitor's delivery logs with pagination", async () => {
		svc.listNotificationLogs.mockResolvedValue({ data: [], total: 0 } as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeNotificationLogs("m1", { limit: 25, offset: 25 }),
			{ wrapper: Wrapper },
		);
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.listNotificationLogs).toHaveBeenCalledWith({
			uptimeMonitorId: "m1",
			limit: 25,
			offset: 25,
		});
	});

	it("fetches the account-wide history when no monitor id is given", async () => {
		svc.listNotificationLogs.mockResolvedValue({ data: [], total: 0 } as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeNotificationLogs(undefined), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.listNotificationLogs).toHaveBeenCalledWith({
			uptimeMonitorId: undefined,
			limit: undefined,
			offset: 0,
		});
	});

	it("is disabled when enabled is false", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeNotificationLogs("m1", { enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
	});
});

describe("useUptimeStatusChanges", () => {
	it("fetches status changes with a limit", async () => {
		svc.listStatusChanges.mockResolvedValue([] as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeStatusChanges("m1", 20), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.listStatusChanges).toHaveBeenCalledWith("m1", 20);
	});

	it("is disabled with empty monitor id", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeStatusChanges(""), {
			wrapper: Wrapper,
		});
		expect(result.current.fetchStatus).toBe("idle");
	});

	it("is disabled when enabled is false", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeStatusChanges("m1", 20, { enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
	});
});

describe("useUptimeIncidents", () => {
	it("revalidates a cached empty list when returning after an external check", async () => {
		const { Wrapper, client } = createWrapper();
		client.setQueryData(uptimeKeys.incidents.list("m1"), []);
		svc.listIncidents.mockResolvedValue([{ incidentId: "new-incident", status: "ongoing" }] as never);
		const { result } = renderHook(() => useUptimeIncidents("m1", 50), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.data?.[0]?.incidentId).toBe("new-incident"));
		expect(svc.listIncidents).toHaveBeenCalledWith("m1", 50);
	});
	it("fetches incidents with a limit", async () => {
		svc.listIncidents.mockResolvedValue([] as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeIncidents("m1", 5), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.listIncidents).toHaveBeenCalledWith("m1", 5);
	});

	it("is disabled with empty monitor id", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeIncidents(""), {
			wrapper: Wrapper,
		});
		expect(result.current.fetchStatus).toBe("idle");
	});

	it("is disabled when enabled is false", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeIncidents("m1", 5, { enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
	});
});

describe("useUptimeIncident", () => {
	it("fetches a single incident", async () => {
		svc.getIncident.mockResolvedValue({ incidentId: "i1" } as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeIncident("i1"), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.getIncident).toHaveBeenCalledWith("i1");
	});

	it("is disabled with empty incident id", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeIncident(""), {
			wrapper: Wrapper,
		});
		expect(result.current.fetchStatus).toBe("idle");
	});

	it("is disabled when enabled is false", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(
			() => useUptimeIncident("i1", { enabled: false }),
			{ wrapper: Wrapper },
		);
		expect(result.current.fetchStatus).toBe("idle");
	});
});


describe("useUptimeDailyUptime", () => {
  it("does not fetch for an empty monitor identity", () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUptimeDailyUptime(""), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(svc.getDailyUptime).not.toHaveBeenCalled();
  });

  it("isolates monitor and day-window caches and clears old identity while pending", async () => {
    svc.getDailyUptime.mockResolvedValue([{ date: "2026-10-09", status: "down", uptimePercent: 0, totalChecks: 4 }]);
    const { Wrapper, client } = createWrapper();
    const { result, rerender } = renderHook(({ id, days }) => useUptimeDailyUptime(id, days),
      { wrapper: Wrapper, initialProps: { id: "m1", days: 90 } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    svc.getDailyUptime.mockImplementation(() => new Promise(() => {}));
    rerender({ id: "m2", days: 90 });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
    rerender({ id: "m1", days: 7 });
    expect(result.current.data).toBeUndefined();
    expect(client.getQueryCache().getAll()).toHaveLength(3);
  });

  it("exposes fetch failure and recovers through explicit retry", async () => {
    svc.getDailyUptime.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUptimeDailyUptime("m1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(svc.getDailyUptime).toHaveBeenCalledTimes(1);
    await result.current.refetch();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});


describe("statistics window identity", () => {
  it("refetches a changed window without reusing another window's value", async () => {
    svc.getCheckLogStats.mockImplementation(async (_id,days) => ({uptimePercentage:days===7?0:100} as never));
    const {Wrapper}=createWrapper();
    const {result,rerender}=renderHook(({days})=>useUptimeMonitorStats("m1",days),{wrapper:Wrapper,initialProps:{days:30}});
    await waitFor(()=>expect(result.current.data?.uptimePercentage).toBe(100));
    rerender({days:7});
    expect(result.current.data).toBeUndefined();
    await waitFor(()=>expect(result.current.data?.uptimePercentage).toBe(0));
    expect(svc.getCheckLogStats).toHaveBeenCalledWith("m1",7);
  });
});

it("separates check-log pages in the cache while keeping their invalidation prefix", async () => {
  svc.listCheckLogs.mockImplementation(async (_id, options) => ({ data: [{ checkLogId: `page-${options?.offset ?? 0}` }], total: 201 }) as never);
  const { Wrapper, client } = createWrapper();
  const { result, rerender } = renderHook(({ offset }) => useUptimeCheckLogs("m1", { limit: 100, offset }), { initialProps: { offset: 0 }, wrapper: Wrapper });
  await waitFor(() => expect(result.current.data?.data[0]?.checkLogId).toBe("page-0"));
  rerender({ offset: 100 });
  await waitFor(() => expect(result.current.data?.data[0]?.checkLogId).toBe("page-100"));
  expect(client.getQueriesData({ queryKey: uptimeKeys.checkLogs.list("m1") })).toHaveLength(2);
  rerender({ offset: 0 });
  await waitFor(() => expect(result.current.data?.data[0]?.checkLogId).toBe("page-0"));
});
