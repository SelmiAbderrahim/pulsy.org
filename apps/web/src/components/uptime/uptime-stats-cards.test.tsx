import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { UptimeStatsCards } from "./uptime-stats-cards";

vi.mock("react-i18next", () => reactI18nextMock());

describe("UptimeStatsCards", () => {
	it("renders all five stat values with formatted uptime", () => {
		render(
			<UptimeStatsCards
				summary={
					{
						totalMonitors: 9,
						monitorsUp: 6,
						monitorsDown: 2,
						monitorsDegraded: 1,
						avgUptimePercentage: 99.123,
					} as never
				}
			/>,
		);
		expect(screen.getByText("9")).toBeInTheDocument();
		expect(screen.getByText("6")).toBeInTheDocument();
		expect(screen.getByText("2")).toBeInTheDocument();
		expect(screen.getByText("1")).toBeInTheDocument();
		expect(screen.getByText("99.12%")).toBeInTheDocument();
		expect(screen.getByText("Total")).toBeInTheDocument();
	});

	it("shows unknown uptime when there are no measurements", () => {
		render(
			<UptimeStatsCards
				summary={
					{
						totalMonitors: 0,
						monitorsUp: 0,
						monitorsDown: 0,
						monitorsDegraded: 0,
						avgUptimePercentage: null,
					} as never
				}
			/>,
		);
		expect(screen.getByText("No data")).toBeInTheDocument();
	});
});
