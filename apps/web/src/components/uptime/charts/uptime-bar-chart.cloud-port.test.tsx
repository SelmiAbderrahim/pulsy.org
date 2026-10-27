import userEvent from "@testing-library/user-event";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { UptimeBarChart } from "./uptime-bar-chart";

vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });
const tooltipProps = vi.hoisted(() => ({ current: undefined as { collisionBoundary?: unknown; collisionPadding?: unknown; className?: string } | undefined }));
vi.mock("@/components/ui/tooltip", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui/tooltip")>("@/components/ui/tooltip");
  return { ...actual, TooltipContent: (props: React.ComponentProps<typeof actual.TooltipContent>) => { tooltipProps.current = props; return <actual.TooltipContent {...props} />; } };
});

describe("UptimeBarChart", () => {
	it("renders a bar per data point with the right status colors", () => {
		const { container } = render(
			<UptimeBarChart
					data={[
						{ date: "2024-01-01", status: "up", uptimePercent: 100, totalChecks: 1 },
						{ date: "2024-01-02", status: "down", uptimePercent: 0, totalChecks: 1 },
						{ date: "2024-01-03", status: "degraded", uptimePercent: 50, totalChecks: 1 },
						{ date: "2024-01-04", status: "partial", uptimePercent: 100, totalChecks: 1 },
					]}
				/>,
		);
		expect(container.querySelector(".bg-success")).toBeInTheDocument();
		expect(container.querySelector(".bg-destructive")).toBeInTheDocument();
		expect(container.querySelector(".bg-warning")).toBeInTheDocument();
		expect(screen.getByText("overview.uptimeBar.windowTitle")).toBeInTheDocument();
	});

	it("uses the muted fallback only when no status matches and percent exceeds 100", () => {
		// The `partial` status with percent >100 reaches the final bg-muted branch.
		const { container } = render(
			<UptimeBarChart
				data={[{ date: "2024-01-01", status: "partial", uptimePercent: 101, totalChecks: 1 }]}
			/>,
		);
		expect(container.querySelector(".bg-muted")).toBeInTheDocument();
	});

	it("uses bg-warning for partial status below 100% uptime", () => {
		const { container } = render(
			<UptimeBarChart
				data={[{ date: "2024-01-01", status: "partial", uptimePercent: 99, totalChecks: 1 }]}
			/>,
		);
		expect(container.querySelector(".bg-warning")).toBeInTheDocument();
	});
	it("provides keyboard disclosure access to non-color daily data", async () => {
		const { container } = render(<UptimeBarChart data={[
			{ date: "2026-10-09", status: "down", uptimePercent: 0, totalChecks: 1 },
		]} />);
		const disclosure = screen.getByRole("button", { name: "View daily data" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    disclosure.focus();
    await userEvent.keyboard("{Enter}");
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector("details,summary")).toBeNull();
		expect(screen.getByRole("columnheader", { name: "Recorded checks" })).toBeInTheDocument();
		expect(screen.getByRole("cell", { name: "0.00%" })).toBeInTheDocument();
	});

	it("keeps unknown coverage neutral and distinct from a confirmed zero", () => {
		const { container } = render(<UptimeBarChart data={[
			{ date: "2026-10-08", status: "unknown", uptimePercent: null, totalChecks: 0 },
			{ date: "2026-10-09", status: "down", uptimePercent: 0, totalChecks: 4 },
		]} />);
		expect(container.querySelector('[aria-hidden="true"] .bg-success')).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "View daily data" }));
		expect(screen.getByRole("cell", { name: "0.00%" })).toBeInTheDocument();
		expect(screen.getAllByRole("cell", { name: "Unknown" }).length).toBeGreaterThan(0);
	});

	it("shows pending/error and a usable retry instead of fabricated green history", () => {
		const retry = vi.fn();
		const { rerender, container } = render(<UptimeBarChart data={[]} isLoading />);
		expect(screen.getByRole("status")).toHaveTextContent("Loading daily history");
		rerender(<UptimeBarChart data={[]} error={new Error("offline")} onRetry={retry} />);
		expect(screen.getByRole("alert")).toHaveTextContent("Could not load daily history");
		screen.getByRole("button", { name: "Retry" }).click();
		expect(retry).toHaveBeenCalledTimes(1);
		expect(container.querySelector('[aria-hidden="true"] .bg-success')).not.toBeInTheDocument();
	});

  it("retains daily observations and the selected date after a refresh error", () => {
    const data = [{ date: "2026-10-09", status: "down" as const, uptimePercent: 0, totalChecks: 4 }];
    const { rerender } = render(<UptimeBarChart data={data} />);
    rerender(<UptimeBarChart data={data} error={new Error("private transport details")} onRetry={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "detailUX.chooseDay" })).toHaveTextContent("Oct 9, 2026 · UTC (GMT+0)");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load daily history");
    expect(document.body).not.toHaveTextContent("private transport details");
    fireEvent.click(screen.getByRole("button", { name: "View daily data" }));
    expect(screen.getByRole("cell", { name: "0.00%" })).toBeInTheDocument();
  });
});

it("shows 30 daily observations on mobile and lets the reader expand to 90", async () => {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockReturnValue({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()});
  try {
    const data = Array.from({length:90}, (_,index) => ({date:new Date(Date.UTC(2026,0,index+1)).toISOString().slice(0,10),status:"up" as const,uptimePercent:100,totalChecks:1}));
    const {container} = render(<UptimeBarChart data={data} />);
    const windowSelect = screen.getByRole("combobox", {name:"overview.uptimeBar.window"});
    expect(windowSelect.tagName).toBe("BUTTON");
    expect(container.querySelectorAll("[data-daily-uptime] tbody tr")).toHaveLength(30);
    await userEvent.click(windowSelect);
    await userEvent.click(screen.getAllByRole("option")[1]!);
    expect(container.querySelectorAll("[data-daily-uptime] tbody tr")).toHaveLength(90);
  } finally { window.matchMedia = original; }
});

it("searches dates with the shared Combobox and retains the selected observation", async () => {
  const { container } = render(<UptimeBarChart data={[
    { date: "2026-10-08", status: "up", uptimePercent: 100, totalChecks: 2 },
    { date: "2026-10-09", status: "down", uptimePercent: 0, totalChecks: 4 },
  ]} />);
  const trigger = screen.getByRole("combobox", { name: "detailUX.chooseDay" });
  await userEvent.click(trigger);
  await userEvent.type(screen.getByRole("combobox", { name: "controls.search" }), "Oct 8");
  await userEvent.click(screen.getByRole("option", { name: "Oct 8, 2026 · UTC (GMT+0)" }));
  expect(trigger).toHaveTextContent("Oct 8, 2026 · UTC (GMT+0)");
  expect(container.querySelector('[data-selected-day="2026-10-08"]')).toHaveTextContent("100.00%");
  expect(container.querySelectorAll('select:not([aria-hidden="true"])')).toHaveLength(0);
});


it("makes every daily bar keyboard reachable with a date, percentage and plural count tooltip", async () => {
  const { container } = render(<UptimeBarChart data={[
    { date: "2026-10-08", status: "unknown", uptimePercent: null, totalChecks: 0 },
    { date: "2026-10-09", status: "degraded", uptimePercent: 95.88, totalChecks: 170 },
  ]} />);
  const unknown = screen.getByRole("button", { name: /Oct 8, 2026.*Unknown.*0 recorded checks/ });
  expect(unknown).toHaveClass("bg-muted");
  const bar = screen.getByRole("button", { name: /Oct 9, 2026.*95.88%.*170 recorded checks/ });
  act(() => bar.focus());
  expect(await screen.findByRole("tooltip")).toHaveTextContent("95.88% · 170 recorded checks");
  await userEvent.keyboard("{Enter}");
  expect(container.querySelector('[data-selected-day="2026-10-09"]')).toHaveTextContent("status.degraded · 95.88% · 170 recorded checks");
  expect(bar).toHaveAttribute("aria-pressed", "true");
});

it.each(["ltr", "rtl"])("bounds the edge tooltip to its card in %s layouts", async direction => {
  const { container } = render(<div dir={direction}><UptimeBarChart data={[
    { date: "2026-10-08", status: "unknown", uptimePercent: null, totalChecks: 0 },
    { date: "2026-10-09", status: "up", uptimePercent: 100, totalChecks: 1 },
  ]} /></div>);
  const bar = screen.getByRole("button", { name: /Oct 9, 2026.*100.00%/ });
  act(() => bar.focus());
  expect(await screen.findByRole("tooltip")).toHaveTextContent("100.00%");
  await waitFor(() => expect(tooltipProps.current?.collisionBoundary).toBe(container.querySelector("section")));
  expect(tooltipProps.current?.collisionPadding).toBe(8);
  expect(tooltipProps.current?.className).toContain("max-w-[var(--radix-tooltip-content-available-width)]");
  expect(screen.getByRole("button", { name: /Oct 8, 2026.*Unknown/ })).not.toHaveClass("bg-muted-foreground");
});
