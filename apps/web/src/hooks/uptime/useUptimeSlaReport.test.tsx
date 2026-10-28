import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { retireSessionClient } from "@/lib/session-query-client";
import type { SlaReport } from "@/types/uptime";
import { UptimeService } from "@/services/uptime/uptimeService";
import { createWrapper } from "@/test/query-wrapper";
import { uptimeKeys } from "./queryKeys";
import {
	useRemoveUptimeSlaReportSubscription,
	useSendUptimeSlaReportNow,
	useUptimeSlaReport,
	useUptimeSlaReportSubscriptions,
	useUpsertUptimeSlaReportSubscription,
	useDownloadUptimeSlaReport,
} from "./useUptimeSlaReport";

vi.mock("@/services/uptime/uptimeService", () => ({
	UptimeService: {
		getSlaReport: vi.fn(),
		downloadSlaReport: vi.fn(),
		listSlaReportSubscriptions: vi.fn(),
		upsertSlaReportSubscription: vi.fn(),
		removeSlaReportSubscription: vi.fn(),
		sendSlaReportNow: vi.fn(),
	},
}));

const svc = vi.mocked(UptimeService);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("useUptimeSlaReport", () => {
	it("revalidates a cached report when returning after a completed check", async () => {
		const { Wrapper, client } = createWrapper();
		client.setQueryData(uptimeKeys.slaReports.detail("m1", 30), reportSnapshot(1));
		svc.getSlaReport.mockResolvedValue(reportSnapshot(3));
		const { result } = renderHook(() => useUptimeSlaReport("m1", 30), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.data?.stats.totalChecks).toBe(3));
		expect(result.current.data?.stats.failedChecks).toBe(2);
	});
	it("fetches the report for a monitor", async () => {
		svc.getSlaReport.mockResolvedValue({ uptimeMonitorId: "m1" } as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeSlaReport("m1", 30), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.getSlaReport).toHaveBeenCalledWith("m1", 30);
	});

	it("is disabled without a monitor id", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeSlaReport(""), {
			wrapper: Wrapper,
		});
		expect(result.current.fetchStatus).toBe("idle");
		expect(svc.getSlaReport).not.toHaveBeenCalled();
	});

	it("can be explicitly disabled via options", () => {
		const { Wrapper } = createWrapper();
		renderHook(() => useUptimeSlaReport("m1", 30, { enabled: false }), {
			wrapper: Wrapper,
		});
		expect(svc.getSlaReport).not.toHaveBeenCalled();
	});
});

function reportSnapshot(totalChecks: number): SlaReport {
	return {
		uptimeMonitorId: "m1", monitorName: "API", url: "https://example.test",
		windowFrom: "2026-09-01T00:00:00.000Z", windowTo: "2026-10-01T00:00:00.000Z",
		windowDays: 30, periodLabel: "September 2026", generatedAt: "2026-10-01T00:00:00.000Z",
		windowTimezone: "UTC", incidentList: [], dailyUptime: [],
		stats: { totalChecks, successfulChecks: totalChecks - Math.min(totalChecks, 2), degradedChecks: 0, failedChecks: Math.min(totalChecks, 2),
			avgResponseTime: null, minResponseTime: null, maxResponseTime: null, p95ResponseTime: null, uptimePercentage: null },
		incidents: { count: 0, totalDowntimeSeconds: 0, longestIncidentSeconds: 0 },
	};
}

describe("report download snapshot", () => {
	let createObjectURL: Mock<(object: Blob | MediaSource) => string>;
	let revokeObjectURL: Mock<(url: string) => void>;
	let clicks: { href: string; download: string }[];
	beforeEach(() => {
		vi.useFakeTimers();
		createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(() => "blob:report");
		revokeObjectURL = vi.fn<(url: string) => void>();
		vi.stubGlobal("URL", class extends URL {
			static override createObjectURL = createObjectURL;
			static override revokeObjectURL = revokeObjectURL;
		});
		clicks = [];
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
			clicks.push({ href: this.href, download: this.download });
		});
	});
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("uses exactly the PDF snapshot as visible data and releases the downloadable PDF after consumption", async () => {
		const { Wrapper, client } = createWrapper();
		const report = reportSnapshot(7);
		client.setQueryData(uptimeKeys.slaReports.detail("m1", 30), reportSnapshot(1));
		svc.downloadSlaReport.mockResolvedValue({ report, pdf: btoa("%PDF-snapshot") });
		const { result } = renderHook(() => useDownloadUptimeSlaReport("m1", 30, "Europe/Berlin"), { wrapper: Wrapper });
		await act(async () => { await result.current.mutateAsync(); });
		expect(svc.downloadSlaReport).toHaveBeenCalledWith("m1", 30, "Europe/Berlin");
		expect(client.getQueryData(uptimeKeys.slaReports.detail("m1", 30))).toEqual(report);
		expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: "application/pdf", size: 13 }));
		expect(clicks).toEqual([{ href: "blob:report", download: "sla-report-September 2026.pdf" }]);
		expect(revokeObjectURL).not.toHaveBeenCalled();
		await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:report");
	});

	it("preserves the visible snapshot and produces no file when the download fails", async () => {
		const { Wrapper, client } = createWrapper();
		const report = reportSnapshot(3);
		client.setQueryData(uptimeKeys.slaReports.detail("m1", 30), report);
		svc.downloadSlaReport.mockRejectedValue(new Error("offline"));
		const { result } = renderHook(() => useDownloadUptimeSlaReport("m1", 30), { wrapper: Wrapper });
		await act(async () => { await expect(result.current.mutateAsync()).rejects.toThrow("offline"); });
		expect(client.getQueryData(uptimeKeys.slaReports.detail("m1", 30))).toEqual(report);
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(clicks).toEqual([]);
	});

	it("ignores a successful download from a retired session", async () => {
		const { Wrapper, client } = createWrapper();
		let resolve!: (value: Awaited<ReturnType<typeof UptimeService.downloadSlaReport>>) => void;
		svc.downloadSlaReport.mockReturnValue(new Promise(done => { resolve = done; }));
		const { result } = renderHook(() => useDownloadUptimeSlaReport("m1", 30), { wrapper: Wrapper });
		await act(async () => {
			const pending = result.current.mutateAsync();
			retireSessionClient(client);
			resolve({ report: reportSnapshot(7), pdf: btoa("%PDF-snapshot") });
			await pending;
		});
		expect(client.getQueryData(uptimeKeys.slaReports.detail("m1", 30))).toBeUndefined();
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(clicks).toEqual([]);
	});

	it("rechecks session retirement while waiting for an in-flight report read to cancel", async () => {
		const { Wrapper, client } = createWrapper();
		let finishCancel!: () => void;
		vi.spyOn(client, "cancelQueries").mockImplementation(() => new Promise(done => { finishCancel = done; }));
		svc.downloadSlaReport.mockResolvedValue({ report: reportSnapshot(7), pdf: btoa("%PDF-snapshot") });
		const { result } = renderHook(() => useDownloadUptimeSlaReport("m1", 30), { wrapper: Wrapper });
		let pending!: Promise<unknown>;
		await act(async () => { pending = result.current.mutateAsync(); });
		expect(finishCancel).toEqual(expect.any(Function));
		await act(async () => { retireSessionClient(client); finishCancel(); await pending; });
		expect(client.getQueryData(uptimeKeys.slaReports.detail("m1", 30))).toBeUndefined();
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(clicks).toEqual([]);
	});
});

describe("useUptimeSlaReportSubscriptions", () => {
	it("fetches subscriptions", async () => {
		svc.listSlaReportSubscriptions.mockResolvedValue([] as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useUptimeSlaReportSubscriptions(), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.listSlaReportSubscriptions).toHaveBeenCalledTimes(1);
	});

	it("can be disabled", () => {
		const { Wrapper } = createWrapper();
		renderHook(() => useUptimeSlaReportSubscriptions({ enabled: false }), {
			wrapper: Wrapper,
		});
		expect(svc.listSlaReportSubscriptions).not.toHaveBeenCalled();
	});
});

describe("SLA subscription mutations", () => {
	it("upsert invalidates the subscriptions list", async () => {
		svc.upsertSlaReportSubscription.mockResolvedValue({} as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(
			() => useUpsertUptimeSlaReportSubscription(),
			{ wrapper: Wrapper },
		);
		await act(async () => {
			await result.current.mutateAsync({
				recipientAddresses: ["a@x.test"],
				emailProviderId: "p1",
			});
		});
		expect(svc.upsertSlaReportSubscription).toHaveBeenCalled();
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.slaReports.subscriptions(),
		});
	});

	it("remove invalidates the subscriptions list", async () => {
		svc.removeSlaReportSubscription.mockResolvedValue({
			success: true,
		} as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(
			() => useRemoveUptimeSlaReportSubscription(),
			{ wrapper: Wrapper },
		);
		await act(async () => {
			await result.current.mutateAsync("sub1");
		});
		expect(svc.removeSlaReportSubscription).toHaveBeenCalledWith("sub1");
		expect(spy).toHaveBeenCalledWith({
			queryKey: uptimeKeys.slaReports.subscriptions(),
		});
	});

	it("sendNow calls the service", async () => {
		svc.sendSlaReportNow.mockResolvedValue({
			skipped: false,
			monitorsReported: 1,
			emailsSent: 1,
		} as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useSendUptimeSlaReportNow(), {
			wrapper: Wrapper,
		});
		await act(async () => {
			await result.current.mutateAsync("sub1");
		});
		expect(svc.sendSlaReportNow).toHaveBeenCalledWith("sub1");
	});
});
