import { renderWithQueryClient as render } from "@/test/query-wrapper";
vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { ApiDocsPage } from "./api-docs-page";

vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@tanstack/react-router", () => ({ Link: ({ to, ...props }: ComponentPropsWithoutRef<"a"> & { to: string }) => <a href={to} {...props} /> }));
vi.mock("./endpoint-section", () => ({ EndpointSection: () => null }));
vi.mock("./code-block", () => ({ CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre> }));
afterEach(() => window.history.replaceState(null, "", window.location.pathname));

describe("API documentation section navigation", () => {
  it("moves keyboard focus to the selected section after the list closes, then restores the trigger on Escape", async () => {
    render(<ApiDocsPage />);
    const trigger = screen.getByRole("combobox", { name: "toc.title" });
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}{Home}{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(window.location.hash).toBe("#auth");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Authentication" })).toHaveFocus());
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(window.location.hash).toBe("#auth");
  });

  it("returns focus to the trigger without navigating when dismissed before a choice", async () => {
    render(<ApiDocsPage />);
    const trigger = screen.getByRole("combobox", { name: "toc.title" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(window.location.hash).toBe("");
  });
});
