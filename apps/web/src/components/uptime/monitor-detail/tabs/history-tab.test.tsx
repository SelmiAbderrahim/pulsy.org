import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { HistoryTab } from "./history-tab";

vi.mock("react-i18next", () => reactI18nextMock());

const useUptimeCheckLogs = vi.fn();
vi.mock("@/hooks/uptime", () => ({
	useUptimeCheckLogs: (id: string, opts: unknown) =>
		useUptimeCheckLogs(id, opts),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("HistoryTab", () => {
	it("shows the empty state when there are no logs", () => {
		useUptimeCheckLogs.mockReturnValue({ data: { data: [] } });
		render(<HistoryTab monitorId="m1" />);
		expect(screen.getByText("history.empty")).toBeInTheDocument();
		expect(useUptimeCheckLogs).toHaveBeenCalledWith("m1", { limit: 100 });
	});

	it("treats undefined data as empty", () => {
		useUptimeCheckLogs.mockReturnValue({ data: undefined });
		render(<HistoryTab monitorId="m1" />);
		expect(screen.getByText("history.empty")).toBeInTheDocument();
	});

	it("renders a row per log with status dots and fallbacks", () => {
		useUptimeCheckLogs.mockReturnValue({
			data: {
				data: [
					{
						checkLogId: "1",
						createdAt: "2024-01-01T10:00:00Z",
						status: "up",
						httpStatus: 200,
						responseTime: 120,
						errorMessage: null,
					},
					{
						checkLogId: "2",
						createdAt: "2024-01-01T10:01:00Z",
						status: "down",
						httpStatus: null,
						responseTime: null,
						errorMessage: "timeout",
					},
					{
						checkLogId: "3",
						createdAt: "2024-01-01T10:02:00Z",
						status: "degraded",
						httpStatus: 503,
						responseTime: 900,
						errorMessage: null,
					},
				],
			},
		});
		const { container } = render(<HistoryTab monitorId="m1" />);
		expect(screen.getByText("up")).toBeInTheDocument();
		expect(screen.getByText("down")).toBeInTheDocument();
		expect(screen.getByText("degraded")).toBeInTheDocument();
		expect(screen.getByText("timeout")).toBeInTheDocument();
		expect(container.querySelector(".bg-success")).toBeInTheDocument();
		expect(container.querySelector(".bg-destructive")).toBeInTheDocument();
		expect(container.querySelector(".bg-warning")).toBeInTheDocument();
		// fallback dashes for the down row's httpStatus + responseTime
		expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
	});
});
