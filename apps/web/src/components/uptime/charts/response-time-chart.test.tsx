import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import {
	formatResponseTimeTooltip,
	ResponseTimeChart,
} from "./response-time-chart";

vi.mock("react-i18next", () => reactI18nextMock());

// Force a concrete size so recharts lays out axes (and thus invokes the
// tickFormatter) instead of bailing out on a 0x0 ResponsiveContainer. We clone
// the chart child with explicit width/height props.
vi.mock("recharts", async () => {
	const actual =
		await vi.importActual<typeof import("recharts")>("recharts");
	const { cloneElement } = await vi.importActual<typeof import("react")>(
		"react",
	);
	return {
		...actual,
		ResponsiveContainer: ({
			children,
		}: {
			children: ReactElement<{ width?: number; height?: number }>;
		}) => cloneElement(children, { width: 600, height: 300 }),
	};
});

describe("ResponseTimeChart", () => {
	it("shows the empty state when there are no logs", () => {
		render(<ResponseTimeChart checkLogs={[]} />);
		expect(screen.getByText("No check logs yet")).toBeInTheDocument();
	});

	it("renders the chart container when logs are present", () => {
		const { container } = render(
			<ResponseTimeChart
				checkLogs={
					[
						{
							createdAt: "2024-01-01T10:00:00Z",
							responseTime: 120,
							status: "up",
						},
						{
							createdAt: "2024-01-01T10:01:00Z",
							responseTime: null,
							status: "down",
						},
					] as never
				}
			/>,
		);
		expect(screen.getByRole("heading", { name: "Response time" })).toBeInTheDocument();
		// With a concrete size, recharts lays out the Y axis and runs the
		// tickFormatter, rendering "<n>ms" tick labels.
		expect(container.querySelector(".recharts-surface")).toBeInTheDocument();
		expect(
			container.querySelectorAll(".recharts-cartesian-axis-tick").length,
		).toBeGreaterThan(0);
	});

	// recharts 3 derives hover state from real layout geometry, which jsdom
	// cannot simulate — so the tooltip formatting is asserted directly.
	it("formats tooltip values as '<n>ms' with the series label", () => {
		expect(formatResponseTimeTooltip(120, "Response time")).toEqual([
			"120\u00a0ms",
			"Response time",
		]);
		expect(formatResponseTimeTooltip(0, "Response time")).toEqual([
			"0\u00a0ms",
			"Response time",
		]);
	});
});
