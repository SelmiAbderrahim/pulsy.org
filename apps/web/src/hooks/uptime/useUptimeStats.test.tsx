import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UptimeService } from "@/services/uptime/uptimeService";
import { createWrapper } from "@/test/query-wrapper";
import {
	useUptimeCheckLogs,
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
