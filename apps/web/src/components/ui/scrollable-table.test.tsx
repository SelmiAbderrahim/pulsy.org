import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { ScrollableTable } from "./scrollable-table";
import { Table, TableBody, TableCell, TableRow } from "./table";
vi.mock("react-i18next", () => reactI18nextMock());
afterEach(() => vi.unstubAllGlobals());
function metrics(element: HTMLElement, scrollWidth: number, clientWidth: number, scrollLeft = 0) {
  for (const [key, value] of Object.entries({ scrollWidth, clientWidth, scrollLeft })) Object.defineProperty(element, key, { configurable: true, value });
}
describe("ScrollableTable", () => {
  it("updates real overflow on resize and removes sticky-edge emphasis at the end", () => {
    const callbacks: ResizeObserverCallback[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { callbacks.push(callback); } observe() {} disconnect = disconnect; });
    const { unmount } = render(<ScrollableTable aria-label="Data"><table><tbody><tr><td>One</td></tr></tbody></table></ScrollableTable>);
    const region = screen.getByRole("region", { name: "Data" });
    expect(screen.queryByText("nav.scrollTable")).not.toBeInTheDocument();
    metrics(region, 600, 300);
    act(() => callbacks.forEach(callback => callback([], {} as ResizeObserver)));
    expect(screen.getByText("nav.scrollTable")).toBeVisible();
    expect(region).toHaveAttribute("data-scroll-end", "true");
    metrics(region, 600, 300, 300);
    fireEvent.scroll(region);
    expect(region).not.toHaveAttribute("data-scroll-end");
    expect(region).toHaveAttribute("data-scroll-start", "true");
    metrics(region, 300, 300);
    act(() => callbacks.forEach(callback => callback([], {} as ResizeObserver)));
    expect(screen.queryByText("nav.scrollTable")).not.toBeInTheDocument();
    expect(region).not.toHaveAttribute("data-scroll-start");
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
  it("tracks logical scroll edges in RTL and marks sticky cells for conditional borders", () => {
    render(<Table aria-label="RTL data" dir="rtl"><TableBody><TableRow><TableCell>One</TableCell><TableCell sticky="end">Actions</TableCell></TableRow></TableBody></Table>);
    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("Actions")).toHaveAttribute("data-sticky", "end");
    expect(screen.getByText("Actions")).toHaveClass("sticky", "end-0");
    metrics(region, 600, 300, -100);
    fireEvent.scroll(region);
    expect(region).toHaveAttribute("data-scroll-start", "true");
    expect(region).toHaveAttribute("data-scroll-end", "true");
    metrics(region, 600, 300, -300);
    fireEvent.scroll(region);
    expect(region).not.toHaveAttribute("data-scroll-end");
  });
});
