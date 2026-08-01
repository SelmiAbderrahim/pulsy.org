import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { IncidentSearchResult, UptimeMonitor } from "@/types/uptime";
import { GlobalSearchDialog } from "./global-search-dialog";

vi.mock("react-i18next", () => reactI18nextMock());

// Pass-through debounce so query state takes effect synchronously in tests.
vi.mock("@/hooks/useDebouncedValue", () => ({
	useDebouncedValue: (v: string) => v,
}));

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
}));

const monitorsState: { data: UptimeMonitor[] } = { data: [] };
const incidentsState: {
	data: IncidentSearchResult[];
	isFetching: boolean;
} = { data: [], isFetching: false };

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
	monitorsState.data = [];
	incidentsState.data = [];
	incidentsState.isFetching = false;
});

function open() {
	return render(<GlobalSearchDialog open onOpenChange={vi.fn()} />);
}

function input() {
	return screen.getByPlaceholderText("Search monitors and incidents...");
}

describe("GlobalSearchDialog", () => {
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
		fireEvent.change(input(), { target: { value: "a" } });
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
		fireEvent.change(input(), { target: { value: "a" } });
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
		expect(screen.getByText("No results found.")).toBeInTheDocument();
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
});
