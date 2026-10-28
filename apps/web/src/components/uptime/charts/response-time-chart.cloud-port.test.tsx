import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock, translate } from "@/test/i18n-mock";
import { ResponseTimeChart, responseSeries, responseTimeTicks } from "./response-time-chart";

const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => "Africa/Tunis" }));
vi.mock("react-i18next", () => {
  const mock = reactI18nextMock();
  return { ...mock, useTranslation: () => ({ t: translate, i18n: locale }) };
});
beforeEach(() => { locale.language = "en"; });

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
		ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
			cloneElement(children, { width: 600, height: 300 }),
	};
});

describe("ResponseTimeChart", () => {
  it("shows a configured threshold beyond the observed series and leaves missing timing as a gap", () => {
    const { container } = render(<ResponseTimeChart thresholdMs={800} checkLogs={[{ checkLogId: "a", uptimeMonitorId: "m", createdAt: "2026-10-09T10:00:00Z", responseTime: 120, status: "up", httpStatus: 200, errorMessage: null }, { checkLogId: "b", uptimeMonitorId: "m", createdAt: "2026-10-09T10:01:00Z", responseTime: null, status: "down", httpStatus: null, errorMessage: "Timeout" }]} />);
    expect(screen.getByText("latency.chartThreshold")).toBeInTheDocument();
    expect(container.querySelector(".recharts-reference-line-line")).toBeInTheDocument();
    // A single known sample cannot invent a line down to zero for the missing sample.
    expect(container.querySelector(".recharts-line-curve")?.getAttribute("d") ?? "").not.toContain("L");
  });
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

	it("formats the tooltip value on hover", async () => {
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
							responseTime: 80,
							status: "up",
						},
					] as never
				}
			/>,
		);
		const surface = container.querySelector(".recharts-surface");
		expect(surface).not.toBeNull();
		setChartGeometry(container);
		fireEvent.mouseOver(surface as Element, { clientX: 300, clientY: 150 });
		fireEvent.mouseMove(surface as Element, { clientX: 300, clientY: 150 });
		// The Tooltip `formatter` renders "<value>ms" into the tooltip wrapper.
		await waitFor(() => expect(container.querySelector(".recharts-tooltip-wrapper")?.textContent).toContain("ms"));
	});
});

it("preserves exact zero, missing timings and unsampled intervals as separate data", () => {
  const logs = [{ checkLogId: "first", createdAt: "2026-10-11T10:00:00Z", responseTime: 0, status: "up" }, { checkLogId: "second", createdAt: "2026-10-11T10:10:00Z", responseTime: null, status: "down" }] as never;
  expect(responseSeries(logs, 60).map(point => point.responseTime)).toEqual([0, null, null]);
  render(<ResponseTimeChart checkLogs={logs} thresholdMs={500} recoveryThresholdMs={300} />);
  fireEvent.click(screen.getByText("detailUX.chartData"));
  expect(screen.getByRole("cell", { name: "0\u00a0ms" })).toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
  expect(document.querySelectorAll(".recharts-reference-line-line")).toHaveLength(2);
});


it("uses compact nonwrapping ticks and identifies thresholds in the legend without overlapping chart labels", () => {
  const { container } = render(<ResponseTimeChart thresholdMs={8000} recoveryThresholdMs={6000} checkLogs={[
    { createdAt: "2026-10-09T10:00:00Z", responseTime: 6000, status: "up" },
    { createdAt: "2026-10-09T10:01:00Z", responseTime: 4000, status: "up" },
  ] as never} />);
  const ticks = [...container.querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value")];
  expect(ticks.map(tick => tick.textContent)).toContain("6k");
  for (const tick of ticks) expect(tick).toHaveStyle({ whiteSpace: "nowrap" });
  const recovery = container.querySelectorAll(".recharts-reference-line-line")[1];
  expect(recovery).toHaveAttribute("stroke", "hsl(var(--success))");
  expect(recovery).toHaveAttribute("stroke-width", "1.5");
  expect(container.querySelector(".recharts-reference-line .recharts-label")).toBeNull();
  expect(screen.getByRole("list", { name: "Legend" })).toHaveTextContent("Recovery threshold");
  const topTick = ticks.at(-1)!;
  expect(Number(topTick.getAttribute("y"))).toBeGreaterThanOrEqual(24);
});


it("places the value axis on the right and reverses chronological ticks in Arabic", () => {
  locale.language = "ar";
  const { container } = render(<ResponseTimeChart checkLogs={[
    { createdAt: "2026-10-09T10:00:00Z", responseTime: 6000, status: "up" },
    { createdAt: "2026-10-09T11:00:00Z", responseTime: 4000, status: "up" },
  ] as never} />);
  expect(screen.getByRole("figure")).toHaveAttribute("dir", "rtl");
  const values = container.querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value");
  for (const tick of values) expect(Number(tick.getAttribute("x"))).toBeGreaterThan(500);
  const times = container.querySelectorAll(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value");
  expect(Number(times[0]?.getAttribute("x"))).toBeGreaterThan(Number(times[times.length - 1]?.getAttribute("x")));
});

it.each(["en", "ar"])("shows one timezone offset in the %s hover label", async language => {
  locale.language = language;
  const { container } = render(<ResponseTimeChart checkLogs={[
    { createdAt: "2026-10-09T10:00:00Z", responseTime: 120, status: "up" },
    { createdAt: "2026-10-09T11:00:00Z", responseTime: 80, status: "up" },
  ] as never} />);
  const surface = container.querySelector(".recharts-surface")!;
  setChartGeometry(container);
		fireEvent.mouseOver(surface, { clientX: 300, clientY: 150 });
  fireEvent.mouseMove(surface, { clientX: 300, clientY: 150 });
  await waitFor(() => expect(container.querySelector(".recharts-tooltip-label")?.textContent).toContain("Africa/Tunis"));
  const label = container.querySelector(".recharts-tooltip-label")!.textContent!;
  expect(label).toContain("Africa/Tunis");
  expect((label.match(/GMT|غرينتش/g) ?? [])).toHaveLength(1);
});


it("uses evenly spaced round time ticks within the observed window", () => {
  const start = Date.parse("2026-10-09T10:02:13Z");
  const end = Date.parse("2026-10-09T11:08:41Z");
  const ticks = responseTimeTicks(start, end);
  expect(ticks.length).toBeGreaterThanOrEqual(3);
  expect(ticks.every(tick => tick >= start && tick <= end && tick % 900_000 === 0)).toBe(true);
  expect(new Set(ticks.slice(1).map((tick, i) => tick - ticks[i]!)).size).toBe(1);
  expect(responseTimeTicks(start, start)).toEqual([start]);
  expect(responseTimeTicks(NaN, end)).toEqual([]);
});

it("wraps tooltip content within the plot instead of overflowing narrow pages", async () => {
  const { container } = render(<ResponseTimeChart checkLogs={[
    { createdAt: "2026-10-09T10:00:00Z", responseTime: 120, status: "up" },
    { createdAt: "2026-10-09T11:00:00Z", responseTime: 80, status: "up" },
  ] as never} />);
  const surface = container.querySelector(".recharts-surface")!;
  setChartGeometry(container);
		fireEvent.mouseOver(surface, { clientX: 300, clientY: 150 });
  fireEvent.mouseMove(surface, { clientX: 300, clientY: 150 });
  await waitFor(() => expect(container.querySelector(".recharts-tooltip-wrapper")?.textContent).toContain("ms"));
  expect(container.querySelector(".recharts-default-tooltip")).toHaveStyle({ whiteSpace: "normal", overflowWrap: "anywhere", maxWidth: "240px" });
});

function setChartGeometry(container: HTMLElement) {
  const wrapper = container.querySelector(".recharts-wrapper")!;
  Object.defineProperties(wrapper, {
    offsetWidth: { configurable: true, value: 600 },
    offsetHeight: { configurable: true, value: 300 },
    getBoundingClientRect: { configurable: true, value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 300, width: 600, height: 300, toJSON: () => ({}) }) },
  });
}


it("preserves measured DNS/TCP assertion failures while keeping HTTP connection failures unknown", () => {
  const logs = [{ createdAt: "2026-10-09T10:00:00Z", responseTime: 17, status: "down", httpStatus: null }];
  for (const kind of ["dns", "tcp"]) expect(Reflect.apply(responseSeries, undefined, [logs, 60, kind])[0].responseTime).toBe(17);
  expect(Reflect.apply(responseSeries, undefined, [logs, 60, "http"])[0].responseTime).toBeNull();
});

it("shows a failed DNS assertion's measured latency in the accessible chart data", () => {
  render(<ResponseTimeChart monitorType="dns" checkLogs={[{ checkLogId: "dns", createdAt: "2026-10-09T10:00:00Z", responseTime: 17, status: "down", httpStatus: null }] as never} />);
  fireEvent.click(screen.getByText("detailUX.chartData"));
  expect(screen.getByRole("cell", { name: "17\u00a0ms" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "status.down" })).toBeInTheDocument();
});
