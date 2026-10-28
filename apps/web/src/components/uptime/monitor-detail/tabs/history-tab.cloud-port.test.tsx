import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock, translate } from "@/test/i18n-mock";
import { HistoryTab } from "./history-tab";

vi.mock("react-i18next", () => {
  const mock = reactI18nextMock();
  return { ...mock, useTranslation: () => {
    const original = { t: translate, i18n: { language: "en", changeLanguage: vi.fn() } };
    return { ...original, t: (key: string, options?: Record<string, unknown>) => key === "reliability.asOf" ? `As of ${options?.date} (${options?.timezone})` : original.t(key, options) };
  } };
});

const useUptimeCheckLogs = vi.fn();
vi.mock("@/hooks/uptime", () => ({
	useUptimeCheckLogs: (id: string, opts: unknown) =>
		useUptimeCheckLogs(id, opts),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("HistoryTab", () => {
  it("ticks the snapshot age without refetching and retains the absolute timestamp", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    try {
      const refetch = vi.fn();
      useUptimeCheckLogs.mockReturnValue({ data: { data: [] }, dataUpdatedAt: Date.now() - 45_000, refetch });
      const view = render(<HistoryTab monitorId="clock" />);
      const snapshot = screen.getByText(/^As of/), absolute = snapshot.getAttribute("title");
      expect(snapshot).toHaveTextContent("45 seconds ago");
      act(() => vi.advanceTimersByTime(15_000));
      expect(snapshot).toHaveTextContent("1 minute ago");
      expect(snapshot.getAttribute("title")).toBe(absolute);
      expect(refetch).not.toHaveBeenCalled();
      view.unmount(); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
	it("shows the empty state when there are no logs", () => {
		useUptimeCheckLogs.mockReturnValue({ data: { data: [] } });
		render(<HistoryTab monitorId="m1" />);
		expect(screen.getByText("history.empty")).toBeInTheDocument();
		expect(useUptimeCheckLogs).toHaveBeenCalledWith("m1", { limit: 25, offset: 0 });
	});

	it("keeps pending data distinct from confirmed empty", () => {
		useUptimeCheckLogs.mockReturnValue({ data: undefined });
		render(<HistoryTab monitorId="m1" />);
		expect(screen.queryByText("history.empty")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("metrics.loading");
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
		expect(screen.getByText("status.up")).toBeInTheDocument();
		expect(screen.getByText("status.down")).toBeInTheDocument();
		expect(screen.getByText("status.degraded")).toBeInTheDocument();
		expect(screen.getByText("timeout")).not.toBeVisible();
    const errorDetails = screen.getByRole("button", { name: "historyUX.errorDetail" });
    fireEvent.click(errorDetails);
    expect(errorDetails).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("timeout")).toBeVisible();
		expect(container.querySelector(".bg-success")).toBeInTheDocument();
		expect(container.querySelector(".bg-destructive")).toBeInTheDocument();
		expect(container.querySelector(".bg-warning")).toBeInTheDocument();
		// fallback dashes for the down row's httpStatus + responseTime
		expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
	});

	it("announces a failed load with its own Retry and no stuck loading state", () => {
		const refetch = vi.fn();
		useUptimeCheckLogs.mockReturnValue({ data: undefined, error: new Error("network"), refetch, isFetching: false, dataUpdatedAt: 0 });
		render(<HistoryTab monitorId="m1" />);
		expect(screen.getByRole("alert")).toHaveTextContent("historyUX.loadError");
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "workspace.retry" }));
		expect(refetch).toHaveBeenCalledOnce();
	});
});

it("paginates check logs in 25-row pages without a nested vertical scroller", () => {
  useUptimeCheckLogs.mockReturnValue({ data: { data: [{ checkLogId: "one", createdAt: "2026-10-14T12:00:00Z", status: "up", responseTime: 63 }], total: 105 } });
  const { container } = render(<HistoryTab monitorId="paged" />);
  expect(container.querySelector("table")).toHaveClass("table-fixed");
  expect(container.querySelector('[class*="max-h-"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "historyUX.older" }));
  expect(useUptimeCheckLogs).toHaveBeenLastCalledWith("paged", { limit: 25, offset: 25 });
  fireEvent.click(screen.getByRole("button", { name: "historyUX.newer" }));
  expect(useUptimeCheckLogs).toHaveBeenLastCalledWith("paged", { limit: 25, offset: 0 });
});

it("keeps timestamps on one line and enables the page-following table header", () => {
  useUptimeCheckLogs.mockReturnValue({ data: { data: [{ checkLogId: "one", createdAt: "2026-10-14T12:00:00Z", status: "up", responseTime: 63 }], total: 1 } });
  const { container } = render(<HistoryTab monitorId="sticky" />);
  expect(container.querySelector("time")?.closest("td")).toHaveClass("whitespace-nowrap");
  expect(container.querySelector("thead")?.style.transform).toBe("translateY(0px)");
});

it("shows no latency for a failed HTTP check that stored a time-to-failure, only for the successful one", () => {
  useUptimeCheckLogs.mockReturnValue({ data: { data: [
    { checkLogId: "ok", createdAt: "2026-10-14T12:00:00Z", status: "up", httpStatus: 200, responseTime: 123, errorMessage: null },
    { checkLogId: "failed", createdAt: "2026-10-14T12:05:00Z", status: "down", httpStatus: null, responseTime: 4321, errorMessage: "timeout" },
  ], total: 2 } });
  render(<HistoryTab monitorId="m-failed" monitorType="http" />);
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows).toHaveLength(2);
  const failed = rows.find(row => row.textContent?.includes("status.down"))!;
  const ok = rows.find(row => row.textContent?.includes("status.up"))!;
  expect(failed.textContent).not.toMatch(/4[.,\u00a0\u202f ]?321|4[.,]3/);
  expect(failed.textContent).toContain("—");
  expect(ok.textContent).toContain("123");
});
