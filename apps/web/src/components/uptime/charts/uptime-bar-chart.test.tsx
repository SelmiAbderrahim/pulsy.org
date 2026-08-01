import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { UptimeBarChart } from "./uptime-bar-chart";

vi.mock("react-i18next", () => reactI18nextMock());

describe("UptimeBarChart", () => {
	it("renders a bar per data point with the right status colors", () => {
		const { container } = render(
			<UptimeBarChart
					data={[
						{ date: "2024-01-01", status: "up", uptimePercent: 100 },
						{ date: "2024-01-02", status: "down", uptimePercent: 0 },
						{ date: "2024-01-03", status: "degraded", uptimePercent: 50 },
						{ date: "2024-01-04", status: "partial", uptimePercent: 100 },
					]}
				/>,
		);
		expect(container.querySelector(".bg-success")).toBeInTheDocument();
		expect(container.querySelector(".bg-destructive")).toBeInTheDocument();
		expect(container.querySelector(".bg-warning")).toBeInTheDocument();
		expect(screen.getByText("Uptime (90 days)")).toBeInTheDocument();
	});

	it("uses the muted fallback only when no status matches and percent exceeds 100", () => {
		// The `partial` status with percent >100 reaches the final bg-muted branch.
		const { container } = render(
			<UptimeBarChart
				data={[{ date: "d-muted", status: "partial", uptimePercent: 101 }]}
			/>,
		);
		expect(container.querySelector(".bg-muted")).toBeInTheDocument();
	});

	it("uses bg-warning for partial status below 100% uptime", () => {
		const { container } = render(
			<UptimeBarChart
				data={[{ date: "d", status: "partial", uptimePercent: 99 }]}
			/>,
		);
		expect(container.querySelector(".bg-warning")).toBeInTheDocument();
	});
});
