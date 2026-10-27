import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { IncidentsTab } from "./incidents-tab";

vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a href="/dashboard/incidents">{children}</a> }));
vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });

const useUptimeIncidents = vi.fn();
vi.mock("@/hooks/uptime", () => ({
	useUptimeIncidents: (id: string, limit: number) =>
		useUptimeIncidents(id, limit),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("IncidentsTab", () => {
	it("keeps a missing resolved duration unknown rather than extending it to now", () => {
		useUptimeIncidents.mockReturnValue({ data: [{ incidentId: "missing-duration", status: "resolved", startedAt: "2024-01-01T00:00:00Z", resolvedAt: "2024-01-01T00:05:00Z", durationSeconds: null, cause: null }] });
		render(<IncidentsTab monitorId="m1" />);
		expect(screen.getByRole("cell", { name: "—" })).not.toHaveAttribute("title");
		expect(screen.queryByText("incidents.duration.days")).not.toBeInTheDocument();
	});
	it("distinguishes never-observed monitors from an empty recorded history", () => {
		useUptimeIncidents.mockReturnValue({ data: [] });
		const { rerender } = render(<IncidentsTab monitorId="new" hasObservations={false} />);
		expect(screen.getByText("incidents.noObservations")).toBeVisible();
		rerender(<IncidentsTab monitorId="sparse-or-paused" hasObservations />);
		expect(screen.getByText("incidents.emptyDescription")).toBeVisible();
		expect(screen.queryByText("incidents.noObservations")).not.toBeInTheDocument();
	});
	it("shows the empty state with no incidents", () => {
		useUptimeIncidents.mockReturnValue({ data: [] });
		render(<IncidentsTab monitorId="m1" />);
		expect(screen.getByText("No incidents recorded")).toBeInTheDocument();
		expect(useUptimeIncidents).toHaveBeenCalledWith("m1", 50);
	});

	it("does not claim empty history before observations load", () => {
		useUptimeIncidents.mockReturnValue({ data: undefined });
		render(<IncidentsTab monitorId="m1" />);
		expect(screen.queryByText("No incidents recorded")).not.toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent("workspace.loading");
	});
	it("does not mistake a failed history request for no incidents", () => {
		useUptimeIncidents.mockReturnValue({ data: undefined, error: new Error("offline") });
		render(<IncidentsTab monitorId="m1" />);
		expect(screen.queryByText("No incidents recorded")).not.toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent("incidents.loadError");
	});

	it("renders ongoing and resolved incidents with formatted durations", () => {
		useUptimeIncidents.mockReturnValue({
			data: [
				{
					incidentId: "1",
					status: "ongoing",
					startedAt: "2024-01-01T00:00:00Z",
					resolvedAt: null,
					durationSeconds: null,
					cause: null,
				},
				{
					incidentId: "2",
					status: "resolved",
					startedAt: "2024-01-01T00:00:00Z",
					resolvedAt: "2024-01-01T00:00:45Z",
					durationSeconds: 45, // seconds branch
					cause: "5xx errors",
				},
				{
					incidentId: "3",
					status: "resolved",
					startedAt: "2024-01-01T00:00:00Z",
					resolvedAt: "2024-01-01T00:05:00Z",
					durationSeconds: 300, // minutes branch
					cause: null,
				},
				{
					incidentId: "4",
					status: "resolved",
					startedAt: "2024-01-01T00:00:00Z",
					resolvedAt: "2024-01-01T02:00:00Z",
					durationSeconds: 7200, // hours branch
					cause: null,
				},
				{
					incidentId: "5",
					status: "resolved",
					startedAt: "2024-01-01T00:00:00Z",
					resolvedAt: "2024-01-03T00:00:00Z",
					durationSeconds: 172800, // days branch
					cause: null,
				},
			],
		});
		render(<IncidentsTab monitorId="m1" />);
  expect(screen.getAllByText("incidents.status.ongoing").length).toBeGreaterThanOrEqual(1);
		expect(
			screen.getAllByText("incidents.status.resolved").length,
  ).toBe(8);
  expect(screen.getAllByText("5xx errors").length).toBeGreaterThanOrEqual(1);
		// duration translation keys per branch
		expect(
			screen.getAllByText("45s")[0],
		).toBeInTheDocument();
		expect(
			screen.getAllByText("5m")[0],
		).toBeInTheDocument();
		expect(screen.getAllByText("2h")[0]).toBeInTheDocument();
		expect(screen.getAllByText("2d")[0]).toBeInTheDocument();
	});
});

it("allows desktop incident facts to wrap while retaining exact duration details", () => {
  useUptimeIncidents.mockReturnValue({ data: [{ incidentId: "compact", status: "resolved", startedAt: "2026-10-14T12:00:00Z", resolvedAt: "2026-10-14T12:34:52Z", durationSeconds: 2092, cause: "Timeout" }] });
  const { container } = render(<IncidentsTab monitorId="m1" />);
  expect(screen.getAllByText("34m 52s")[0]).toHaveAttribute("title", expect.stringContaining("2,092 seconds"));
  expect(screen.getAllByText("34m 52s")[0]).toHaveAttribute("tabindex", "0");
  const cells = container.querySelectorAll("tbody tr td");
  for (const index of [1, 2, 3]) { expect(cells[index]).toHaveClass("whitespace-normal", "break-words"); expect(cells[index]).not.toHaveClass("whitespace-nowrap"); }
  expect(screen.getByRole("table")).toHaveClass("table-fixed");
  expect(container.querySelectorAll("th[class*=min-w],td[class*=min-w]")).toHaveLength(0);
});


it("reuses shared card facts on mobile and wraps long desktop causes", () => {
  useUptimeIncidents.mockReturnValue({ data: [{ incidentId: "long", status: "ongoing", startedAt: "2026-10-14T12:00:00Z", durationSeconds: null, cause: "x".repeat(300), severity: "critical" }] });
  const { container } = render(<IncidentsTab monitorId="m1" />);
  expect(container.querySelectorAll("[data-incident-card]")).toHaveLength(1);
  expect(container.querySelector("tbody tr td:last-child")).toHaveClass("[overflow-wrap:anywhere]");
});
