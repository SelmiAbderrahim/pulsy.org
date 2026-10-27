import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

vi.mock("react-i18next", () => reactI18nextMock());
afterEach(() => document.documentElement.removeAttribute("dir"));

function openSheet(side?: "left" | "right" | "top" | "bottom") {
  render(<Sheet defaultOpen><SheetContent side={side} aria-describedby={undefined}><SheetTitle>Panel</SheetTitle><button type="button">First action</button></SheetContent></Sheet>);
  return screen.getByRole("dialog", { name: "Panel" });
}

describe("Sheet logical opening direction", () => {
  it.each(["ltr", "rtl"])("keeps the start-side panel and entering motion aligned in %s", dir => {
    document.documentElement.dir = dir;
    const panel = openSheet("left");
    expect(panel).toHaveClass("start-0", "border-e", "data-[state=open]:slide-in-from-left", "rtl:data-[state=open]:slide-in-from-right");
    expect(panel).not.toHaveClass("left-0", "right-0", "end-0");
    expect(screen.getByRole("button", { name: "First action" })).toHaveFocus();
  });

  it.each(["ltr", "rtl"])("keeps the end-side panel and entering motion aligned in %s", dir => {
    document.documentElement.dir = dir;
    const panel = openSheet("right");
    expect(panel).toHaveClass("end-0", "border-s", "data-[state=open]:slide-in-from-right", "rtl:data-[state=open]:slide-in-from-left");
    expect(panel).not.toHaveClass("left-0", "right-0", "start-0");
  });

  it.each(["top", "bottom"] as const)("does not mirror the vertical %s transition", side => {
    document.documentElement.dir = "rtl";
    const panel = openSheet(side);
    expect(panel).toHaveClass(`${side}-0`, `data-[state=open]:slide-in-from-${side}`);
    expect(panel.className).not.toContain("rtl:data-[state=open]:slide-in-from-");
  });

  it("defaults to the logical end and keeps the close control at the logical end", () => {
    const panel = openSheet();
    expect(panel).toHaveClass("end-0");
    expect(screen.getByRole("button", { name: "actions.close" })).toHaveClass("end-2");
  });
});
