import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { IncidentsTab } from "./incidents-tab";

vi.mock("react-i18next", () => reactI18nextMock());

const useUptimeIncidents = vi.fn();
vi.mock("@/hooks/uptime", () => ({
	useUptimeIncidents: (id: string, limit: number) =>
		useUptimeIncidents(id, limit),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("IncidentsTab", () => {
	it("shows the empty state with no incidents", () => {
		useUptimeIncidents.mockReturnValue({ data: [] });
		render(<IncidentsTab monitorId="m1" />);
		expect(screen.getByText("No incidents recorded")).toBeInTheDocument();
		expect(useUptimeIncidents).toHaveBeenCalledWith("m1", 50);
	});

	it("announces loading while incident data is unavailable", () => {
		useUptimeIncidents.mockReturnValue({ data: undefined });
		render(<IncidentsTab monitorId="m1" />);
		expect(screen.getByRole("status")).toHaveTextContent("workspace.loading");
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
		expect(screen.getAllByText("incidents.status.ongoing")).toHaveLength(2);
		expect(
			screen.getAllByText("incidents.status.resolved").length,
		).toBe(8);
		expect(screen.getAllByText(/5xx errors/)).toHaveLength(2);
		// duration translation keys per branch
		expect(screen.getAllByText("45s")).toHaveLength(2);
		expect(screen.getAllByText("5m")).toHaveLength(2);
		expect(screen.getAllByText("2h")).toHaveLength(2);
		expect(screen.getAllByText("2d")).toHaveLength(2);
	});
});

vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a href="/dashboard/incidents">{children}</a> }));
