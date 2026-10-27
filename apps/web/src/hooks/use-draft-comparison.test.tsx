import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { useDraftComparison } from "./use-draft-comparison";
import { useDirtyNavigation } from "./use-dirty-navigation";
import { hasRegisteredDraft, discardRegisteredDrafts } from "@/lib/draft-guards";
vi.mock("react-i18next", () => reactI18nextMock());
function unload() { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }
function Form({ carried = "", open = true }: { carried?: string; open?: boolean }) {
  const [name, setName] = useState(carried), [tags, setTags] = useState<string[]>([]);
  const draft = useDraftComparison({ name, tags }, { name: "", tags: [] }, open);
  return <form {...draft.formProps}><input aria-label="Name" value={name} onChange={event => setName(event.target.value)} /><button type="button" onClick={() => setTags(tags.length ? [] : ["ops"])}>Toggle tag</button><button type="button" disabled={!draft.dirty} onClick={draft.accept}>Save</button></form>;
}
describe("original-default draft comparison", () => {
  it("tracks carried values and tag-only changes; reverting and saving clear the unload warning", async () => {
    render(<Form carried="Quick draft" />);
    expect(unload()).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    expect(unload()).toBe(false); expect(screen.getByText("Save")).toBeDisabled();
    await userEvent.click(screen.getByText("Toggle tag")); expect(unload()).toBe(true);
    await userEvent.click(screen.getByText("Toggle tag")); expect(unload()).toBe(false);
    await userEvent.type(screen.getByLabelText("Name"), "New");
    await userEvent.click(screen.getByText("Save")); expect(unload()).toBe(false);
  });
  it("does not guard a closed form or keep registrations after unmount", () => {
    const view = render(<Form carried="Quick draft" open={false} />);
    expect(unload()).toBe(false); expect(hasRegisteredDraft()).toBe(false);
    view.unmount(); expect(hasRegisteredDraft()).toBe(false);
  });
  it("uses one shared decision for route and query-tab navigation", async () => {
    function Shell() { const dialog = useDirtyNavigation(hasRegisteredDraft, discardRegisteredDrafts); return <>{dialog}<Outlet /></>; }
    const root = createRootRoute({ component: Shell });
    const editor = createRoute({ getParentRoute: () => root, path: "/dashboard", component: () => <><Form carried="Quick draft" /><Link to="/login">Leave</Link><Link to="/dashboard" search={{ panel: "templates" } as never}>Templates</Link></> });
    const destination = createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>Destination</p> });
    const router = createRouter({ routeTree: root.addChildren([editor,destination]), history: createMemoryHistory({ initialEntries: ["/dashboard"] }) });
    const view = render(<RouterProvider router={router} />);
    await userEvent.click(await screen.findByText("Templates"));
    await screen.findByRole("alertdialog"); await userEvent.keyboard("{Escape}");
    expect(router.state.location.searchStr).toBe(""); expect(unload()).toBe(true);
    await userEvent.click(screen.getByText("Leave"));
    await userEvent.click(await screen.findByRole("button", { name: "communication.discard" }));
    await screen.findByText("Destination");
    await waitFor(() => expect(hasRegisteredDraft()).toBe(false));
    view.unmount(); expect(unload()).toBe(false);
  });
});
