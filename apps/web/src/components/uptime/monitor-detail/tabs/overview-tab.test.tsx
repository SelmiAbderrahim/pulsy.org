import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeMonitor } from "@/types/uptime";
import { OverviewTab } from "./overview-tab";

vi.mock("react-i18next", () => reactI18nextMock());

// Stub the charts so we focus on OverviewTab's own logic (covered separately).
vi.mock("../../charts/uptime-bar-chart", () => ({
	UptimeBarChart: ({ data }: { data: unknown[] }) => (
		<div data-testid="uptime-bar" data-len={data.length} />
	),
}));
vi.mock("../../charts/response-time-chart", () => ({
	ResponseTimeChart: ({ checkLogs }: { checkLogs: unknown[] }) => (
		<div data-testid="response-time" data-len={checkLogs.length} />
	),
}));

const useUptimeMonitorStats = vi.fn();
const useUptimeCheckLogs = vi.fn();
vi.mock("@/hooks/uptime", () => ({
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
	useUptimeMonitorStats.mockReturnValue({ data: undefined });
	useUptimeCheckLogs.mockReturnValue({ data: undefined });
});

describe("OverviewTab", () => {
	it("renders fallbacks when stats and logs are missing", () => {
		render(<OverviewTab monitor={monitor()} />);
		expect(useUptimeMonitorStats).toHaveBeenCalledWith("m1", 30);
		expect(useUptimeCheckLogs).toHaveBeenCalledWith("m1", { limit: 100 });
		// Total checks defaults to 0; success rate + avg response show em dash.
		expect(screen.getByText("0")).toBeInTheDocument();
		expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
		// uptime bar always renders 90 days
		expect(screen.getByTestId("uptime-bar")).toHaveAttribute("data-len", "90");
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
		expect(screen.getByText("98.7%")).toBeInTheDocument();
		expect(screen.getByText("123ms")).toBeInTheDocument();
		expect(screen.getByText("99.50%")).toBeInTheDocument();
		expect(
			screen.getByText("detail.tls.expiresInDays"),
		).toBeInTheDocument();
		// Today's bucket has logs (1 up / 2) → partial; chart still 90 days.
		expect(screen.getByTestId("uptime-bar")).toHaveAttribute("data-len", "90");
		expect(screen.getByTestId("response-time")).toHaveAttribute(
			"data-len",
			"4",
		);
	});

	it("renders an em dash for a null monitor uptime percentage", () => {
		render(<OverviewTab monitor={monitor({ uptimePercentage: null })} />);
		expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
	});
});
