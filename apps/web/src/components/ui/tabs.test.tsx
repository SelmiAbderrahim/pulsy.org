import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "ar" } }) }));
describe("localized tab direction", () => {
  it("uses Arabic direction for content and horizontal keyboard navigation", async () => {
    render(<Tabs defaultValue="second"><TabsList><TabsTrigger value="first">First</TabsTrigger><TabsTrigger value="second">Second</TabsTrigger><TabsTrigger value="third">Third</TabsTrigger></TabsList><TabsContent value="first">First panel</TabsContent><TabsContent value="second">Second panel</TabsContent><TabsContent value="third">Third panel</TabsContent></Tabs>);
    expect(screen.getByRole("tablist").parentElement).toHaveAttribute("dir", "rtl");
    act(() => screen.getByRole("tab", { name: "Second" }).focus());
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "First" })).toHaveFocus();
  });
});

describe("overflowing tab strips", () => {
  function sized(list: HTMLElement, metrics: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
    for (const [key, value] of Object.entries(metrics)) Object.defineProperty(list, key, { configurable: true, writable: true, value });
  }
  it("fades only the edge that still hides tabs, and updates as the strip scrolls", () => {
    render(<Tabs defaultValue="a"><TabsList aria-label="Sections"><TabsTrigger value="a">Overview</TabsTrigger><TabsTrigger value="b">Incidents</TabsTrigger><TabsTrigger value="c">History</TabsTrigger></TabsList></Tabs>);
    const list = screen.getByRole("tablist");
    sized(list, { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
    act(() => { fireEvent.scroll(list); });
    // The mocked language is Arabic (rtl): content starts at the right, so more tabs hide on the left.
    const leftAtStart = list.getAttribute("data-fade-left");
    const rightAtStart = list.getAttribute("data-fade-right");
    expect([leftAtStart, rightAtStart].filter(Boolean)).toHaveLength(1);
    sized(list, { scrollWidth: 600, clientWidth: 300, scrollLeft: -150 });
    act(() => { fireEvent.scroll(list); });
    expect(list.getAttribute("data-fade-left")).toBe("true");
    expect(list.getAttribute("data-fade-right")).toBe("true");
    expect(list.style.maskImage).toContain("transparent 0");
    sized(list, { scrollWidth: 600, clientWidth: 300, scrollLeft: -300 });
    act(() => { fireEvent.scroll(list); });
    expect([list.getAttribute("data-fade-left"), list.getAttribute("data-fade-right")].filter(Boolean)).toHaveLength(1);
  });

  it("shows no fade when everything fits", () => {
    render(<Tabs defaultValue="a"><TabsList aria-label="Sections"><TabsTrigger value="a">One</TabsTrigger></TabsList></Tabs>);
    const list = screen.getByRole("tablist");
    sized(list, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
    act(() => { fireEvent.scroll(list); });
    expect(list).not.toHaveAttribute("data-fade-left");
    expect(list).not.toHaveAttribute("data-fade-right");
    expect(list.style.maskImage).toBe("");
  });

  it("keeps the selected tab in view when selection changes, scrolling only the strip", async () => {
    render(<Tabs defaultValue="a"><TabsList aria-label="Sections"><TabsTrigger value="a">One</TabsTrigger><TabsTrigger value="b">Two</TabsTrigger></TabsList></Tabs>);
    const list = screen.getByRole("tablist");
    sized(list, { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
    list.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 44, width: 300, height: 44, x: 0, y: 0, toJSON: () => ({}) });
    const tab = screen.getByRole("tab", { name: "Two" });
    tab.getBoundingClientRect = () => ({ left: 400, right: 520, top: 0, bottom: 44, width: 120, height: 44, x: 400, y: 0, toJSON: () => ({}) });
    const windowScroll = vi.spyOn(window, "scrollTo");
    await userEvent.click(tab);
    await waitFor(() => expect(list.scrollLeft).toBe(228)); // 520 − 300 + 8 margin
    expect(windowScroll).not.toHaveBeenCalled();
  });

  it("re-reveals the selected tab when the strip is resized (a page scrollbar appearing narrows it)", async () => {
    const callbacks: Array<() => void> = [];
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { callbacks.push(callback); } observe() {} disconnect() {} unobserve() {} });
    try {
      render(<Tabs defaultValue="a"><TabsList aria-label="Sections"><TabsTrigger value="a">One</TabsTrigger><TabsTrigger value="b">Two</TabsTrigger></TabsList></Tabs>);
      const list = screen.getByRole("tablist");
      sized(list, { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
      list.getBoundingClientRect = () => ({ left: 0, right: 285, top: 0, bottom: 44, width: 285, height: 44, x: 0, y: 0, toJSON: () => ({}) });
      screen.getByRole("tab", { name: "One" }).getBoundingClientRect = () => ({ left: 190, right: 292, top: 0, bottom: 44, width: 102, height: 44, x: 190, y: 0, toJSON: () => ({}) });
      act(() => callbacks.forEach(callback => callback()));
      expect(list.scrollLeft).toBe(15); // 292 − 285 + 8 margin
    } finally { vi.unstubAllGlobals(); }
  });
});
