import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeMonitor } from "@/types/uptime";
import { OverviewTab } from "./overview-tab";

vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a href="/dashboard/uptime/m1?tab=settings">{children}</a> }));
vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });

// Stub the charts so we focus on OverviewTab's own logic (covered separately).
vi.mock("../../charts/uptime-bar-chart", () => ({
	UptimeBarChart: ({ data }: { data: unknown[] }) => (
		<div data-testid="uptime-bar" data-len={data.length} data-points={JSON.stringify(data)} />
	),
}));
vi.mock("../../charts/response-time-chart", () => ({
	ResponseTimeChart: ({ checkLogs }: { checkLogs: unknown[] }) => (
		<div data-testid="response-time" data-len={checkLogs.length} />
	),
}));

const useUptimeMonitorStats = vi.fn();
const useUptimeCheckLogs = vi.fn();
const useUptimeDailyUptime = vi.fn();
vi.mock("@/hooks/uptime", () => ({
	useUptimeDailyUptime: (id: string, days: number) => useUptimeDailyUptime(id, days),
	useUptimeMonitorStats: (id: string, days: number) =>
		useUptimeMonitorStats(id, days),
	useUptimeCheckLogs: (id: string, opts: unknown) =>
		useUptimeCheckLogs(id, opts),
}));

function monitor(overrides: Partial<UptimeMonitor> = {}): UptimeMonitor {
	return {
		uptimeMonitorId: "m1",
		method: "GET",
		interval: 300,
		timeout: 10000,
		failureThreshold: 3,
		uptimePercentage: 99.5,
		tlsExpiresInDays: null,
		...overrides,
	} as UptimeMonitor;
}

beforeEach(() => {
	vi.clearAllMocks();
	useUptimeMonitorStats.mockReturnValue({ data: undefined, isPending:true, error:null, refetch:vi.fn() });
	useUptimeCheckLogs.mockReturnValue({ data: undefined });
	useUptimeDailyUptime.mockReturnValue({ data: undefined, isPending: true, error: null, refetch: vi.fn() });
});

describe("OverviewTab", () => {
	it("renders fallbacks when stats and logs are missing", () => {
		render(<OverviewTab monitor={monitor()} />);
		expect(useUptimeMonitorStats).toHaveBeenCalledWith("m1", 30);
		expect(useUptimeCheckLogs).toHaveBeenCalledWith("m1", { limit: 100 });
		// Unsettled checks must not be reported as measured zero.
		expect(screen.queryByText("0")).not.toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent("Loading statistics");
		expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
		// No fabricated history while the daily aggregate is pending.
		expect(screen.getByTestId("uptime-bar")).toHaveAttribute("data-len", "0");
	});

	it("reconciles degraded checks with up and down so a missed heartbeat is not a mystery 0%", () => {
		useUptimeMonitorStats.mockReturnValue({
			data: { totalChecks: 2, upChecks: 0, degradedChecks: 1, downChecks: 1, uptimePercentage: 0, avgResponseTime: null },
			isPending: false,
			error: null,
			refetch: vi.fn(),
		});
		render(<OverviewTab monitor={monitor()} />);
		expect(screen.getByText("Check success (30d)")).toBeInTheDocument();
		expect(screen.getByText("0 up · 1 degraded · 1 down")).toBeInTheDocument();
		expect(screen.getByText("0.00%")).toBeInTheDocument();
	});

	it("formats populated stats and a present TLS expiry", () => {
		const today = new Date().toISOString().split("T")[0];
		useUptimeMonitorStats.mockReturnValue({
			data: {
				totalChecks: 42,
				uptimePercentage: 98.7,
				avgResponseTime: 123.4,
			},
		});
		const yesterday = new Date(Date.now() - 86400000)
			.toISOString()
			.split("T")[0];
		useUptimeCheckLogs.mockReturnValue({
			data: {
				data: [
					// Today: all down → uptimePercent === 0 ("down" branch).
					{ createdAt: `${today}T10:00:00Z`, status: "down" },
					{ createdAt: `${today}T10:05:00Z`, status: "down" },
					// Yesterday: mixed → 0 < uptimePercent < 100 ("partial" branch).
					{ createdAt: `${yesterday}T09:00:00Z`, status: "up" },
					{ createdAt: `${yesterday}T09:05:00Z`, status: "down" },
				],
			},
		});
		render(
			<OverviewTab monitor={monitor({ tlsExpiresInDays: 30 })} />,
		);
		expect(screen.getByText("42")).toBeInTheDocument();
				expect(screen.getByText("123 ms")).toBeInTheDocument();
		expect(screen.getByText("98.70%")).toBeInTheDocument();
		expect(
			screen.getByText("detail.tls.expiresInDays"),
		).toBeInTheDocument();
		// Recent response logs do not substitute for an unconfirmed daily aggregate.
		expect(screen.getByTestId("uptime-bar")).toHaveAttribute("data-len", "0");
		expect(screen.getByTestId("response-time")).toHaveAttribute(
			"data-len",
			"4",
		);
	});

	it("renders an em dash for a null monitor uptime percentage", () => {
		render(<OverviewTab monitor={monitor({ uptimePercentage: null })} />);
		expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
	});
	it("uses authoritative daily aggregates rather than 100 recent logs", () => {
		const daily = [{ date: "2026-10-09", status: "down", uptimePercent: 0, totalChecks: 400 }];
		useUptimeDailyUptime.mockReturnValue({ data: daily, isPending: false, error: null, refetch: vi.fn() });
		useUptimeCheckLogs.mockReturnValue({ data: { data: [{ createdAt: "2026-10-09T10:00:00Z", status: "up" }] } });
		render(<OverviewTab monitor={monitor()} />);
		expect(useUptimeDailyUptime).toHaveBeenCalledWith("m1", 90);
		expect(JSON.parse(screen.getByTestId("uptime-bar").getAttribute("data-points")!)).toEqual(daily);
	});

	it("does not manufacture successful days while daily history is pending or failed", () => {
		const { rerender } = render(<OverviewTab monitor={monitor()} />);
		expect(screen.getByTestId("uptime-bar")).toHaveAttribute("data-len", "0");
		useUptimeDailyUptime.mockReturnValue({ data: undefined, isPending: false, error: new Error("offline"), refetch: vi.fn() });
		rerender(<OverviewTab monitor={monitor({ uptimeMonitorId: "m2" })} />);
		expect(screen.getByTestId("uptime-bar")).toHaveAttribute("data-len", "0");
	});

});


describe("Overview statistics states",()=>{
  it("retries a failed query without substituting cached monitor uptime",()=>{
    const retry=vi.fn();
    useUptimeMonitorStats.mockReturnValue({data:undefined,isPending:false,error:new Error("offline"),refetch:retry});
    render(<OverviewTab monitor={monitor({uptimePercentage:99})}/>);
    expect(screen.getByRole("alert")).toHaveTextContent("Statistics unavailable");
    expect(screen.queryByText("99.00%")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Retry statistics"}));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("shows measured zero and zero-millisecond responses",()=>{
    useUptimeMonitorStats.mockReturnValue({data:{totalChecks:2,uptimePercentage:0,avgResponseTime:0},isPending:false,error:null});
    render(<OverviewTab monitor={monitor()}/>);
    expect(screen.getByText("0.00%")).toBeInTheDocument();
    expect(screen.getByText("0 ms")).toBeInTheDocument();
  });
  it("explains a new unmeasured monitor separately from older missing coverage",()=>{
    useUptimeMonitorStats.mockReturnValue({data:{totalChecks:0,uptimePercentage:null,avgResponseTime:null},isPending:false,error:null});
    const {rerender}=render(<OverviewTab monitor={monitor({active:true,lastCheckedAt:null})}/>);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the first check");
    rerender(<OverviewTab monitor={monitor({active:false,lastCheckedAt:"2026-01-01T00:00:00Z"})}/>);
    expect(screen.getByRole("status")).toHaveTextContent("No recorded checks in the last 30 days");
    expect(screen.queryByText("100.00%")).not.toBeInTheDocument();
  });
});

it("keeps the summary line mounted as statistics resolve without a loading paragraph shifting cards", () => {
  const { container, rerender } = render(<OverviewTab monitor={monitor()} />);
  expect(screen.getByRole("status")).toHaveClass("sr-only");
  const breakdown = container.querySelector("[data-overview-breakdown]");
  expect(breakdown).toHaveClass("min-h-4");
  useUptimeMonitorStats.mockReturnValue({ data: { totalChecks: 2, upChecks: 1, degradedChecks: 0, downChecks: 1, uptimePercentage: 50 }, isPending: false, error: null });
  rerender(<OverviewTab monitor={monitor()} />);
  expect(container.querySelector("[data-overview-breakdown]")).toBe(breakdown);
  expect(breakdown).toHaveTextContent("1 up · 0 degraded · 1 down");
});
