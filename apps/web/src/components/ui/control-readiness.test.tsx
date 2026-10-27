// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Dialog, DialogTrigger } from "./dialog";
import { Sheet, SheetTrigger } from "./sheet";
import { DropdownMenu, DropdownMenuTrigger } from "./dropdown-menu";

describe("overlay readiness before hydration", () => {
  it.each([
    ["menu with an asChild trigger", <DropdownMenu><DropdownMenuTrigger asChild><button type="button">Open</button></DropdownMenuTrigger></DropdownMenu>],
    ["dialog", <Dialog><DialogTrigger>Open</DialogTrigger></Dialog>],
    ["sheet", <Sheet><SheetTrigger>Open</SheetTrigger></Sheet>],
  ])("disables the %s trigger and shows a spinner", (_name, element) => {
    const markup = renderToString(element);
    expect(markup).toMatch(/<button[^>]*disabled=""/);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toMatch(/<svg[^>]*animate-spin/);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("Open");
  });
});
