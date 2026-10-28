import { renderWithQueryClient as render } from "@/test/query-wrapper";
import * as confirmations from "@/lib/confirmation";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeMonitor, UptimeMonitorStatus } from "@/types/uptime";
import { MonitorDetailHeader, MonitorDetailHeaderSkeleton } from "./monitor-detail-header";

vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });
afterEach(() => { vi.useRealTimers(); });

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
	Link: ({ children, ...props }: { children?: unknown }) => {
		const { to, ...rest } = props as Record<string, unknown>;
		void to;
		return <a {...(rest as object)}>{children as never}</a>;
	},
}));

const deleteMutateAsync = vi.fn();
const toggleMutateAsync = vi.fn();
const checkNowMutateAsync = vi.fn();
const pending = { delete: false, toggle: false, check: false };
vi.mock("@/hooks/uptime", () => ({
	useDeleteUptimeMonitor: () => ({
		mutateAsync: deleteMutateAsync,
		isPending: pending.delete,
	}),
	useToggleUptimeMonitor: () => ({
		mutateAsync: toggleMutateAsync,
		isPending: pending.toggle,
	}),
	useCheckNow: () => ({
		mutateAsync: checkNowMutateAsync,
		isPending: pending.check,
	}),
	useCreateUptimeShareLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({
	toast: {
		success: (m: unknown) => toastSuccess(m),
		error: (m: unknown) => toastError(m),
	},
}));
vi.mock("../monitor-reuse-controls", () => ({
	MonitorReuseActions: ({ children }: { children: (actions: { duplicate: () => void; saveTemplate: () => void; busy: boolean }) => unknown }) => children({ duplicate: vi.fn(), saveTemplate: vi.fn(), busy: false }),
}));

function monitor(overrides: Partial<UptimeMonitor> = {}): UptimeMonitor {
	return {
		uptimeMonitorId: "m1",
		name: "Alpha",
		url: "https://a.com",
		status: "up",
		active: true,
		...overrides,
	} as UptimeMonitor;
}

beforeEach(() => {
	vi.clearAllMocks();
	pending.delete = pending.toggle = pending.check = false;
	vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true);
});

describe("MonitorDetailHeader status badge", () => {
  it("advances the last evaluation without interaction or new monitor data", () => {
    const timestamp = "2026-10-13T12:00:00Z";
    vi.useFakeTimers(); vi.setSystemTime(Date.parse(timestamp) + 11_000);
    const { unmount } = render(<MonitorDetailHeader monitor={monitor({ monitorType: "heartbeat", interval: 60, timeout: 1000, lastCheckedAt: timestamp })} />);
    expect(screen.getByText("11 seconds ago")).toBeInTheDocument();
    expect(screen.getByText("heartbeat.lastEvaluated")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByText("41 seconds ago")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText("2 minutes ago")).toBeInTheDocument();
    unmount(); expect(vi.getTimerCount()).toBe(0);
  });
	const statusCases = [
		["up", "status.up"],
		["down", "status.down"],
		["degraded", "status.degraded"],
		["pending", "status.pending"],
	] satisfies Array<[UptimeMonitorStatus, string]>;

	it.each(statusCases)("renders the %s status badge", (status, label) => {
		render(<MonitorDetailHeader monitor={monitor({ status, lastCheckedAt: "2026-10-13T12:00:00Z" })} />);
		expect(screen.getByText(label)).toBeInTheDocument();
	});
	it("shows Checking… instead of Pending while an active monitor's first check runs", () => {
		render(<MonitorDetailHeader monitor={monitor({ status: "pending", lastCheckedAt: null })} />);
		expect(screen.getByText("status.checking")).toBeInTheDocument();
		expect(screen.queryByText("status.pending")).not.toBeInTheDocument();
	});
});

describe("MonitorDetailHeader actions", () => {
	it("checks now and shows success", async () => {
		checkNowMutateAsync.mockResolvedValue(undefined);
		render(<MonitorDetailHeader monitor={monitor()} />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.checkNow" }),
		);
		await waitFor(() => expect(checkNowMutateAsync).toHaveBeenCalled());
		expect(toastSuccess).toHaveBeenCalledWith("checkNow.success");
	});

	it("disables/checks now is unavailable for inactive monitors and shows Enable", async () => {
		render(<MonitorDetailHeader monitor={monitor({ active: false })} />);
		expect(
			screen.getByRole("button", { name: "actions.checkNow" }),
		).toBeDisabled();
		expect(screen.getByRole("button", { name: "actions.checkNow" })).toHaveAccessibleDescription("status.paused · actions.enable");
		await userEvent.click(screen.getByRole("button", { name: "detailUX.more" }));
		expect(
			screen.getByRole("menuitem", { name: /actions.enable/ }),
		).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "actions.checkNow" })).toHaveAccessibleDescription("status.paused · actions.enable");
	});

	it.each(["heartbeat", "server"] as const)("hides Check now for push-based %s monitors in the header and menu", async (monitorType) => {
		render(<MonitorDetailHeader monitor={monitor({ monitorType, interval: 60 })} />);
		expect(screen.queryByRole("button", { name: "actions.checkNow" })).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "detailUX.more" }));
		expect(screen.queryByRole("menuitem", { name: "actions.checkNow" })).not.toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: /actions.disable/ })).toBeInTheDocument();
		expect(checkNowMutateAsync).not.toHaveBeenCalled();
	});

	it("explains that a pending server monitor waits for its first agent report", async () => {
		render(<MonitorDetailHeader monitor={monitor({ monitorType: "server", interval: 60, status: "pending", lastCheckedAt: null })} />);
		const hint = screen.getByRole("button", { name: "server.pending" });
		act(() => hint.focus());
		expect(await screen.findByRole("tooltip")).toHaveTextContent("server.awaitingHint");
	});

	it.each([
		["after the first report", { status: "up", lastCheckedAt: "2026-10-18T12:00:00Z" }],
		["while paused", { status: "pending", lastCheckedAt: null, active: false }],
	] as const)("hides the first-report hint %s", (_label, overrides) => {
		render(<MonitorDetailHeader monitor={monitor({ monitorType: "server", interval: 60, ...overrides })} />);
		expect(screen.queryByRole("button", { name: "server.pending" })).not.toBeInTheDocument();
	});

	it("does not show the first-report hint for a pending heartbeat monitor", () => {
		render(<MonitorDetailHeader monitor={monitor({ monitorType: "heartbeat", interval: 60, status: "pending", lastCheckedAt: null })} />);
		expect(screen.queryByRole("button", { name: "server.pending" })).not.toBeInTheDocument();
	});

	it("toggles a monitor and shows the disable-success toast when active", async () => {
		toggleMutateAsync.mockResolvedValue(undefined);
		render(<MonitorDetailHeader monitor={monitor({ active: true })} />);
		await userEvent.click(screen.getByRole("button", { name: "detailUX.more" }));
		await userEvent.click(
			screen.getByRole("menuitem", { name: /actions.disable/ }),
		);
		await waitFor(() =>
			expect(toastSuccess).toHaveBeenCalledWith("toggle.disableSuccess"),
		);
	});

	it("toggles a monitor and shows the enable-success toast when inactive", async () => {
		toggleMutateAsync.mockResolvedValue(undefined);
		render(<MonitorDetailHeader monitor={monitor({ active: false })} />);
		await userEvent.click(screen.getByRole("button", { name: "detailUX.more" }));
		await userEvent.click(
			screen.getByRole("menuitem", { name: /actions.enable/ }),
		);
		await waitFor(() =>
			expect(toastSuccess).toHaveBeenCalledWith("toggle.enableSuccess"),
		);
	});

	it("deletes and navigates home on confirm", async () => {
		deleteMutateAsync.mockResolvedValue(undefined);
		render(<MonitorDetailHeader monitor={monitor()} />);
		await userEvent.click(screen.getByRole("button", { name: "detailUX.more" }));
		await userEvent.click(
			screen.getByRole("menuitem", { name: "Delete monitor" }),
		);
		await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalled());
		expect(navigate).toHaveBeenCalledWith({ to: "/dashboard" });
		expect(toastSuccess).toHaveBeenCalledWith("delete.success");
	});

	it("aborts delete when confirm is declined", async () => {
		vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(false);
		render(<MonitorDetailHeader monitor={monitor()} />);
		await userEvent.click(screen.getByRole("button", { name: "detailUX.more" }));
		await userEvent.click(
			screen.getByRole("menuitem", { name: "Delete monitor" }),
		);
		expect(deleteMutateAsync).not.toHaveBeenCalled();
	});

	it("surfaces errors from each action", async () => {
		checkNowMutateAsync.mockRejectedValue(new Error("check fail"));
		toggleMutateAsync.mockRejectedValue(new Error("toggle fail"));
		deleteMutateAsync.mockRejectedValue(new Error("delete fail"));
		render(<MonitorDetailHeader monitor={monitor()} />);
		await userEvent.click(
			screen.getByRole("button", { name: "actions.checkNow" }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("check fail"));
		await userEvent.click(screen.getByRole("button", { name: "detailUX.more" }));
		await userEvent.click(
			screen.getByRole("menuitem", { name: /actions.disable/ }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("toggle fail"));
		await userEvent.click(screen.getByRole("button", { name: "detailUX.more" }));
		await userEvent.click(
			screen.getByRole("menuitem", { name: "Delete monitor" }),
		);
		await waitFor(() => expect(toastError).toHaveBeenCalledWith("delete fail"));
	});

	it("shows a spinner while a check is pending", () => {
		pending.check = true;
		const { container } = render(<MonitorDetailHeader monitor={monitor()} />);
		expect(container.querySelector(".animate-spin")).toBeInTheDocument();
	});
});

it("shows paused independently of the last measured healthy state and keeps delete in More", () => {
  const { container } = render(<MonitorDetailHeader monitor={monitor({ active: false, status: "up" })} />);
  expect(screen.getByText("Paused")).toBeInTheDocument();
  expect(screen.queryByText("status.up")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete monitor" })).not.toBeInTheDocument();
  expect(container.querySelector("a button, button a")).toBeNull();
});

it("keeps Settings in the tab navigation instead of repeating a header action", async () => {
  render(<MonitorDetailHeader monitor={monitor({ monitorType: "http", interval: 300, timeout: 10000 })} />);
  expect(screen.queryByRole("link", { name: /Settings|settings/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Settings|settings/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Copy URL|copyEndpoint/i })).toBeInTheDocument();
});

it("separates the destructive menu action and labels it Delete monitor", async () => {
  render(<MonitorDetailHeader monitor={monitor()} />);
  await userEvent.click(screen.getByRole("button", { name: "detailUX.more" }));
  const deletion = screen.getByRole("menuitem", { name: "Delete monitor" });
  expect(deletion).toHaveClass("text-destructive");
  expect(deletion.previousElementSibling).toHaveAttribute("role", "separator");
});

it("exposes the exact last-check time to keyboard focus using the shared live timestamp", async () => {
  const { container } = render(<MonitorDetailHeader monitor={monitor({ lastCheckedAt: "2026-10-14T12:00:00Z" })} />);
  const time = container.querySelector("time")!;
  expect(time).toHaveAttribute("tabindex", "0");
  act(() => time.focus());
  expect(await screen.findByRole("tooltip")).toHaveTextContent(time.getAttribute("title")!);
  expect(container.querySelector("[data-monitor-detail-header]")).toBeInTheDocument();
});

it("renders a loading header with the breadcrumb and final header layout", () => {
  const { container } = render(<MonitorDetailHeaderSkeleton />);
  const header = container.querySelector("[data-monitor-detail-header]");
  expect(header).toHaveAttribute("data-monitor-detail-loading");
  expect(header).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("navigation", { name: "detailUX.breadcrumb" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("common:states.loading");
  expect(container.querySelector("h1")).toBeInTheDocument();
});

it.each(["http", "dns", "tcp", "heartbeat", "server"] as const)("keeps metadata and unobserved timestamp rows for a pending %s monitor", (monitorType) => {
  const { container } = render(<MonitorDetailHeader monitor={monitor({ monitorType, interval: 300, lastCheckedAt: null, status: "pending" })} />);
  const metadata = container.querySelector("[data-monitor-detail-metadata]");
  expect(metadata).toHaveClass("min-h-11");
  const timestamp = container.querySelector("[data-monitor-detail-timestamp]");
  expect(timestamp).toHaveClass("min-h-5");
  expect(timestamp).toHaveTextContent(monitorType === "heartbeat" ? "heartbeat.lastEvaluated" : "list.columns.lastChecked");
  expect(timestamp).toHaveTextContent("—");
  if (monitorType === "heartbeat" || monitorType === "server") {
    expect(metadata).toHaveTextContent("detail.interval: 5 minutes");
    expect(screen.queryByRole("button", { name: "actions.checkNow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "detailUX.copyEndpoint" })).not.toBeInTheDocument();
  }
});

it("keeps title/actions inline from small tablet widths in loaded and loading headers", () => {
  const { container, rerender } = render(<MonitorDetailHeader monitor={monitor()} />);
  expect(container.querySelector("[data-monitor-detail-header] > div")).toHaveClass("sm:flex-row", "sm:items-start", "sm:justify-between");
  rerender(<MonitorDetailHeaderSkeleton />);
  expect(container.querySelector("[data-monitor-detail-header] > div")).toHaveClass("sm:flex-row", "sm:items-start", "sm:justify-between");
});
