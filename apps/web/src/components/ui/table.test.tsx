import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

vi.mock("react-i18next", () => reactI18nextMock());
afterEach(() => vi.restoreAllMocks());

describe("page-scrolling table header", () => {
  it("follows the page below the app bar, stays inside the table and resets on return to the top", async () => {
    const { unmount } = render(<Table aria-label="Monitors" pageScroll>
      <TableHeader className="relative z-20"><TableRow><TableHead><button>Sort name</button></TableHead></TableRow></TableHeader>
      <TableBody>{Array.from({ length: 6 }, (_, index) => <TableRow key={index}><TableCell>Monitor {index + 1}</TableCell></TableRow>)}</TableBody>
    </Table>);
    const table = screen.getByRole("table");
    const region = screen.getByRole("region");
    const header = table.querySelector("thead")!;
    let top = 200;
    vi.spyOn(table, "getBoundingClientRect").mockImplementation(() => ({ top, height: 480 }) as DOMRect);
    Object.defineProperty(header, "offsetHeight", { configurable: true, value: 48 });
    region.style.scrollPaddingTop = "64px";
    expect(screen.getAllByRole("row")).toHaveLength(7);
    // Full natural height, retaining the keyboard-focusable horizontal region.
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).not.toMatch(/max-h|h-\[/);
    top = -100;
    fireEvent.scroll(window);
    await waitFor(() => expect(header.style.transform).toBe("translateY(164px)"));
    top = -1000;
    fireEvent.scroll(window);
    await waitFor(() => expect(header.style.transform).toBe("translateY(432px)"));
    top = 200;
    fireEvent.scroll(window);
    await waitFor(() => expect(header.style.transform).toBe("translateY(0px)"));
    const remove = vi.spyOn(window, "removeEventListener");
    unmount();
    expect(header.style.transform).toBe("");
    expect(remove.mock.calls.some(([type]) => type === "scroll")).toBe(true);
  });

  it("leaves ordinary overflow tables unchanged", () => {
    render(<Table aria-label="Ordinary" containerClassName="max-h-80"><TableHeader><TableRow><TableHead>Name</TableHead></TableRow></TableHeader></Table>);
    expect(screen.getByRole("region")).toHaveClass("max-h-80");
    expect(screen.getByRole("table").querySelector("thead")!.style.transform).toBe("");
  });
});
