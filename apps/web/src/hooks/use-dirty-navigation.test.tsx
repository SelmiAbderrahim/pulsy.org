import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { useDirtyNavigation } from "./use-dirty-navigation";
vi.mock("react-i18next", () => reactI18nextMock());

function Editor() {
  const [dirty, setDirty] = useState(false);
  const dialog = useDirtyNavigation(dirty);
  return <main id="app-main" tabIndex={-1}>
    {dialog}<button onClick={() => setDirty(true)}>Edit</button><button onClick={() => setDirty(false)}>Save or reset</button>
    <Link to="/login">Leave editor</Link>
    <Link to="/dashboard" search={{ tab: "general" } as never}>General tab</Link>
  </main>;
}
function fixture() {
  const root = createRootRoute({ component: Outlet });
  const editor = createRoute({ getParentRoute: () => root, path: "/dashboard", validateSearch: (search: Record<string, unknown>) => ({ tab: String(search.tab ?? "announcements") }), component: Editor });
  const destination = createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>Destination</p> });
  const router = createRouter({ routeTree: root.addChildren([editor, destination]), history: createMemoryHistory({ initialEntries: ["/dashboard?tab=announcements"] }) });
  return { router, ...render(<RouterProvider router={router} />) };
}
function unload() { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }

describe("dirty navigation and unload lifecycle", () => {
  it("warns only while dirty, removes the warning after save/reset, and leaves clean forms without confirmation", async () => {
    fixture(); await screen.findByText("Edit");
    expect(unload()).toBe(false);
    await userEvent.click(screen.getByText("Edit")); expect(unload()).toBe(true);
    await userEvent.click(screen.getByText("Save or reset")); expect(unload()).toBe(false);
    await userEvent.click(screen.getByText("Leave editor")); await screen.findByText("Destination");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(unload()).toBe(false);
  });
  it("protects dirty routes and tab changes, cancels with Escape and focus return, then confirms navigation and removes the unload handler", async () => {
    const { router } = fixture(); await screen.findByText("Edit"); await userEvent.click(screen.getByText("Edit"));
    const opener = screen.getByText("Leave editor");
    await userEvent.click(opener); await screen.findByRole("alertdialog");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/dashboard"); expect(opener).toHaveFocus(); expect(unload()).toBe(true);
    await userEvent.click(screen.getByText("General tab"));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "actions.cancel" }));
    expect(router.state.location.search.tab).toBe("announcements");
    await userEvent.click(opener);
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "communication.discard" }));
    await screen.findByText("Destination"); expect(unload()).toBe(false);
  });
  it("removes the native handler when a dirty editor is unmounted", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = fixture(); await screen.findByText("Edit"); fireEvent.click(screen.getByText("Edit")); expect(unload()).toBe(true);
    unmount(); expect(unload()).toBe(false); expect(remove.mock.calls.some(([type]) => type === "beforeunload")).toBe(true); remove.mockRestore();
  });
});
