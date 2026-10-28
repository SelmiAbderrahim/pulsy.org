import { renderWithQueryClient as render } from "@/test/query-wrapper";
vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { ApiDocsPage } from "./api-docs-page";
import { ApiDocsTable } from "./api-docs-table";
import { CodeBlock } from "./code-block";

vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@tanstack/react-router", () => ({ Link: ({ to, ...props }: ComponentPropsWithoutRef<"a"> & { to: string }) => <a href={to} {...props} /> }));
const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: { success, error } }));

describe("API reference overflow and copy actions", () => {
  it("keeps every sample action in a solid header outside its scrolling code region", () => {
    const { container } = render(<ApiDocsPage />);
    const blocks = container.querySelectorAll("pre");
    expect(blocks).toHaveLength(34);
    for (const pre of blocks) {
      expect(pre).toHaveClass("overflow-auto", "pe-12", "min-w-0");
      const block = pre.closest("[data-code-block]")!;
      const header = block.querySelector("[data-code-header]")!;
      expect(header).toHaveClass("bg-muted");
      const copy = within(header as HTMLElement).getByRole("button");
      expect(pre.contains(copy)).toBe(false);
      expect(copy).not.toHaveClass("absolute");
    }
    const tables = screen.getAllByRole("table");
    expect(tables.length).toBeGreaterThan(3);
    for (const table of tables) {
      const region = table.closest('[role="region"]')!;
      expect(region).toHaveClass("overflow-x-auto");
      expect(region.parentElement?.querySelectorAll("table")).toHaveLength(1);
      expect(region).toHaveAttribute("tabindex", "0");
      expect(region).toHaveAccessibleName();
    }
  });

  it("copies the full metrics sample and reports a failed clipboard operation", async () => {
    const code = "# HELP pulsy_monitor_status Current status\npulsy_monitor_status{monitor_id=\"1\"} 1";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CodeBlock code={code} language="text" label="Metrics" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy code — Metrics" }));
    await waitFor(() => expect(success).toHaveBeenCalledWith("Copied"));
    expect(writeText).toHaveBeenCalledWith(code);
    writeText.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Copy code — Metrics" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("ux.copyFailed"));
  });

  it.each(["ltr", "rtl"])("tracks the logical scroll edges in %s", async dir => {
    render(<div dir={dir}><ApiDocsTable aria-label="Parameters"><tbody><tr><td>name</td></tr></tbody></ApiDocsTable></div>);
    const region = screen.getByRole("region", { name: "Parameters" });
    Object.defineProperties(region, { clientWidth: { configurable: true, value: 320 }, scrollWidth: { configurable: true, value: 640 }, scrollLeft: { configurable: true, writable: true, value: 0 } });
    fireEvent.scroll(region);
    expect(region).toHaveAttribute("data-scroll-end", "true");
    expect(region).not.toHaveAttribute("data-scroll-start");
    region.scrollLeft = dir === "rtl" ? -320 : 320;
    fireEvent.scroll(region);
    expect(region).toHaveAttribute("data-scroll-start", "true");
    expect(region).not.toHaveAttribute("data-scroll-end");
  });
});
