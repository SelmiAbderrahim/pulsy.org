import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { IncidentSearchResult, UptimeMonitor } from "@/types/uptime";
import { GlobalSearchDialog } from "./global-search-dialog";

vi.mock("react-i18next", () => reactI18nextMock());

const debounce = vi.hoisted(() => ({ pending: false }));
// Most cases pass through; the pending case retains the previous query.
vi.mock("@/hooks/useDebouncedValue", () => ({
	useDebouncedValue: (v: string) => debounce.pending ? "alpha" : v,
}));

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
}));

const monitorsState: { data: UptimeMonitor[] } = { data: [] };
const incidentsState: {
	data: IncidentSearchResult[];
	isFetching: boolean;
 error?: Error;
 refetch: () => void;
} = { data: [], isFetching: false, refetch: vi.fn() };

vi.mock("@/hooks/uptime", () => ({
	useUptimeMonitors: () => monitorsState,
	useIncidentSearch: () => incidentsState,
}));

function monitor(overrides: Partial<UptimeMonitor>): UptimeMonitor {
	return {
		uptimeMonitorId: "m1",
		name: "Alpha",
		url: "https://alpha.example.com",
		tags: [],
		active: true,
		status: "pending",
		...overrides,
	} as UptimeMonitor;
}

function incident(
	overrides: Partial<IncidentSearchResult>,
): IncidentSearchResult {
	return {
		incidentId: "i1",
		uptimeMonitorId: "m1",
		monitorName: "Alpha",
		status: "ongoing",
		startedAt: "2026-01-01T00:00:00.000Z",
		resolvedAt: null,
		durationSeconds: null,
		cause: "Timeout",
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	debounce.pending = false;
	monitorsState.data = [];
	incidentsState.data = [];
	incidentsState.isFetching = false;
 incidentsState.error = undefined;
});

function open() {
	return render(<GlobalSearchDialog open onOpenChange={vi.fn()} />);
}

function input() {
	return screen.getByPlaceholderText("Search monitors and incidents...");
}

describe("GlobalSearchDialog", () => {
  it("captures immediate typing and shows only the explicit Clear button", async () => {
    open();
    expect(input()).toHaveFocus();
    await userEvent.keyboard("http");
    expect(input()).toHaveValue("http");
    expect(screen.queryByRole("button", { name: "actions.close" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input()).toHaveValue(""); expect(input()).toHaveFocus();
  });
  it("offers application destinations alongside monitor search", async () => {
    open();
    const option = screen.getByRole("option", { name: "common:nav.apiKeys" });
    await userEvent.click(option);
    expect(navigate).toHaveBeenCalledWith({ to: "/dashboard/api-keys" });
  });
	it("does not select results from a previous query during debounce", () => {
		monitorsState.data = [monitor({ name: "Alpha" })];
		incidentsState.data = [incident({ monitorName: "Old incident" })];
		const { rerender } = open();
		fireEvent.change(input(), { target: { value: "alpha" } });
		expect(screen.getAllByRole("option")).toHaveLength(2);
		debounce.pending = true;
		fireEvent.change(input(), { target: { value: "beta" } });
		expect(screen.queryByRole("option")).not.toBeInTheDocument();
		fireEvent.keyDown(input(), { key: "Enter" });
		expect(navigate).not.toHaveBeenCalled();
		expect(screen.getByRole("status")).toHaveTextContent("metrics.loading");
		debounce.pending = false;
		incidentsState.data = [];
		rerender(<GlobalSearchDialog open onOpenChange={vi.fn()} />);
		expect(screen.getByText("No results found.")).toBeInTheDocument();
	});

	it("shows type and paused state rather than presenting a paused monitor as healthy", () => {
		monitorsState.data = [monitor({ name: "Alpha", monitorType: "tcp", status: "up", active: false })];
		open();
		fireEvent.change(input(), { target: { value: "alpha" } });
		expect(screen.getByRole("option")).toHaveTextContent("TCP · status.paused");
		expect(screen.getByRole("status")).toHaveTextContent("search.resultsSummary");
	});

	it("uses heartbeat Late semantics without displaying a synthetic endpoint", () => {
		monitorsState.data = [monitor({ name: "Alpha", monitorType: "heartbeat", status: "degraded", url: "heartbeat://private-id" })];
		open();
		fireEvent.change(input(), { target: { value: "alpha" } });
		expect(screen.getByRole("option")).toHaveTextContent("heartbeat.title · heartbeat.late");
		expect(screen.queryByText("heartbeat://private-id")).not.toBeInTheDocument();
	});
	it("shows the hint with no query", () => {
		open();
		expect(
			screen.getByText("Type to search monitors and incidents."),
		).toBeInTheDocument();
	});

	it("filters monitors and navigates to a monitor (no tab)", async () => {
		monitorsState.data = [
			monitor({ uptimeMonitorId: "1", name: "Alpha" }),
			monitor({ uptimeMonitorId: "2", name: "Beta" }),
		];
		open();
		fireEvent.change(input(), { target: { value: "alpha" } });
		await userEvent.click(screen.getByText("Alpha"));
		expect(navigate).toHaveBeenCalledWith({
			to: "/dashboard/uptime/$monitorId",
			params: { monitorId: "1" },
			search: {},
		});
	});

	it("shows incidents (with cause and fallback) and opens the incidents tab", async () => {
		incidentsState.data = [
			incident({ incidentId: "i1", monitorName: "Alpha", cause: "Timeout" }),
			incident({ incidentId: "i2", monitorName: "Beta", cause: null }),
		];
		open();
		fireEvent.change(input(), { target: { value: "unmatched-query" } });
		expect(screen.getByText("Timeout")).toBeInTheDocument();
		expect(screen.getByText("Incident")).toBeInTheDocument();
		await userEvent.click(screen.getByText("Timeout"));
		expect(navigate).toHaveBeenCalledWith({
			to: "/dashboard/uptime/$monitorId",
			params: { monitorId: "m1" },
			search: { tab: "incidents" },
		});
	});

	it("navigates the result list with the keyboard and selects with Enter", async () => {
		monitorsState.data = [
			monitor({ uptimeMonitorId: "1", name: "Alpha" }),
		];
		incidentsState.data = [
			incident({ incidentId: "i1", uptimeMonitorId: "9", monitorName: "Gamma" }),
		];
		open();
		fireEvent.change(input(), { target: { value: "unmatched-query" } });
		// Down to the incident (index 1), then Enter.
		fireEvent.keyDown(input(), { key: "ArrowDown" });
		fireEvent.keyDown(input(), { key: "Enter" });
		expect(navigate).toHaveBeenCalledWith({
			to: "/dashboard/uptime/$monitorId",
			params: { monitorId: "9" },
			search: { tab: "incidents" },
		});
		// Up wraps back around without throwing.
		fireEvent.keyDown(input(), { key: "ArrowUp" });
	});

	it("ignores keyboard navigation with no results", () => {
		open();
    fireEvent.change(input(), { target: { value: "no-matching-item" } });
		fireEvent.keyDown(input(), { key: "ArrowDown" });
		fireEvent.keyDown(input(), { key: "ArrowUp" });
		fireEvent.keyDown(input(), { key: "Enter" });
		expect(navigate).not.toHaveBeenCalled();
	});

	it("highlights the hovered item", async () => {
		monitorsState.data = [
			monitor({ uptimeMonitorId: "1", name: "Alpha" }),
			monitor({ uptimeMonitorId: "2", name: "Alphabet" }),
		];
		open();
		fireEvent.change(input(), { target: { value: "alpha" } });
		const second = screen.getByText("Alphabet").closest("button");
		fireEvent.mouseMove(second as Element);
		expect(second?.className).toContain("bg-accent");
	});

	it("resets the active index when results shrink below it", () => {
		monitorsState.data = [
			monitor({ uptimeMonitorId: "1", name: "Alpha", url: "https://x.ex.com" }),
			monitor({ uptimeMonitorId: "2", name: "Beta", url: "https://y.ex.com" }),
		];
		open();
		fireEvent.change(input(), { target: { value: "ex" } });
		fireEvent.keyDown(input(), { key: "ArrowDown" }); // active -> 1
		// Narrow to a single match; active index 1 is now out of range -> reset.
		fireEvent.change(input(), { target: { value: "x.ex" } });
		const first = screen.getByText("Alpha").closest("button");
		expect(first?.className).toContain("bg-accent");
	});

	it("shows the empty state when nothing matches", () => {
		monitorsState.data = [monitor({ name: "Zeta" })];
		open();
		fireEvent.change(input(), { target: { value: "nomatch" } });
		expect(screen.getByText("No results found.")).toBeInTheDocument();
	});

	it("shows a spinner while incidents are loading", () => {
		incidentsState.isFetching = true;
		open();
		fireEvent.change(input(), { target: { value: "api" } });
		expect(
			document.body.querySelectorAll(".animate-spin").length,
		).toBeGreaterThan(0);
	});

	it("tolerates undefined hook data while loading", () => {
		monitorsState.data = undefined as never;
		incidentsState.data = undefined as never;
		open();
		fireEvent.change(input(), { target: { value: "api" } });
		expect(screen.getByRole("option", { name: "common:nav.apiKeys" })).toBeInTheDocument();
	});

	it("keeps available monitor results and query when incident search fails, with retry", async () => {
    monitorsState.data = [monitor({ name: "Alpha" })];
    incidentsState.error = new Error("Unavailable");
    open();
    fireEvent.change(input(), { target: { value: "alpha" } });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("No results found.")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("listbox")).not.toContainElement(screen.getByRole("button", { name: "common:actions.retry" }));
    await userEvent.click(screen.getByRole("button", { name: "common:actions.retry" }));
    expect(incidentsState.refetch).toHaveBeenCalledOnce();
    expect(input()).toHaveValue("alpha");
  });

  it("clears its query when closed and reopened", () => {
		const { rerender } = render(
			<GlobalSearchDialog open onOpenChange={vi.fn()} />,
		);
		fireEvent.change(input(), { target: { value: "alpha" } });
		rerender(<GlobalSearchDialog open={false} onOpenChange={vi.fn()} />);
		rerender(<GlobalSearchDialog open onOpenChange={vi.fn()} />);
		expect(input()).toHaveValue("");
	});

	describe("Clear and Close are separate controls", () => {
		function renderWithClose() {
			const onOpenChange = vi.fn();
			render(<GlobalSearchDialog open onOpenChange={onOpenChange} />);
			return onOpenChange;
		}

		it("offers Clear only when there is something to clear", () => {
			renderWithClose();
			expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
			fireEvent.change(input(), { target: { value: "QA" } });
			expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
		});

		it("Clear empties the query, keeps the palette open and returns focus to the field", async () => {
			const onOpenChange = renderWithClose();
			fireEvent.change(input(), { target: { value: "QA" } });
			await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
			expect(input()).toHaveValue("");
			expect(input()).toHaveFocus();
			expect(onOpenChange).not.toHaveBeenCalled();
			expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
		});

    it("Escape closes immediately even with a typed query", async () => {
      const onOpenChange = renderWithClose();
      fireEvent.change(input(), { target: { value: "QA" } });
      await userEvent.keyboard("{Escape}");
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByRole("button", { name: "actions.close" })).not.toBeInTheDocument();
    });

    it("outside pointer dismissal closes without a draft confirmation", async () => {
      const onOpenChange = renderWithClose();
      fireEvent.change(input(), { target: { value: "QA" } });
      await new Promise(resolve => setTimeout(resolve, 0));
      fireEvent.pointerDown(document.body);
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

	});
});


it("opens the canonical import/export route from global navigation search", async () => {
  render(<GlobalSearchDialog open onOpenChange={vi.fn()} />);
  const destination = screen.getByText("common:nav.portability");
  expect(destination.closest("button")?.querySelector("svg")).toHaveClass("rtl:scale-x-[-1]");
  await userEvent.click(destination);
  expect(navigate).toHaveBeenCalledWith({to:"/dashboard/import-export"});
});
