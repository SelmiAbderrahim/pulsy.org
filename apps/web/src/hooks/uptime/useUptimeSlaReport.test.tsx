import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UptimeService } from "@/services/uptime/uptimeService";
import { createWrapper } from "@/test/query-wrapper";
import { uptimeKeys } from "./queryKeys";
import {
	useRemoveUptimeSlaReportSubscription,
	useSendUptimeSlaReportNow,
	useUptimeSlaReport,
	useUptimeSlaReportSubscriptions,
	useUpsertUptimeSlaReportSubscription,
} from "./useUptimeSlaReport";

vi.mock("@/services/uptime/uptimeService", () => ({
	UptimeService: {
		getSlaReport: vi.fn(),
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
