import * as confirmations from "@/lib/confirmation";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../public/locales/en/uptimeMonitor.json";
import { translate } from "@/test/i18n-mock";
import { MonitorViewsControls } from "./monitor-views-controls";
import type { MonitorView, MonitorViewFilters } from "@/types/monitor-views";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
const mocks = vi.hoisted(() => ({ list: vi.fn(), initial:vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock("@/services/uptime/monitorViewsService", () => ({ MonitorViewsService: mocks }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner" } } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" }, t: (key: string, options?: Record<string, unknown>) => {
  const value = key.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, en);
  return translate(key, { ...options, defaultValue: typeof value === "string" ? value : key });
} }) }));
const filters: MonitorViewFilters = { search: "agency", tags: ["client,one"], tagMode: "all", health: "down", sort: "name", direction: "asc", density: "compact", group: "tag" };
const saved: MonitorView = { id: "v1", name: "Production", filters, pinned: true, isDefault: true, createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z" };
const clients: QueryClient[] = [];
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([saved]); mocks.initial.mockResolvedValue(saved); mocks.save.mockImplementation(async input => ({ ...saved, ...input })); });
afterEach(() => { clients.forEach(client => client.clear()); clients.length = 0; });
function show(props: Partial<Parameters<typeof MonitorViewsControls>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  const onApply = vi.fn(); const onClear = vi.fn();
  render(<QueryClientProvider client={client}><MonitorViewsControls filters={filters} allowDefault={false} onApply={onApply} onClear={onClear} {...props} /></QueryClientProvider>);
  return { onApply, onClear, client };
}
describe("personal view controls", () => {
  it("applies a default only on an unfiltered dashboard and marks automatic application for replacement", async () => {
    const { onApply } = show({ allowDefault: true });
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(saved, true));
  });
  it("keeps explicit URL filters and saves their exact comma-containing tags without monitor writes", async () => {
    const { onApply } = show();
    await waitFor(() => expect(screen.getByRole("button", { name: "Saved views" })).toBeEnabled()); expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Saved view actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Save new view" }));
    await userEvent.type(screen.getByRole("textbox", { name: "View name" }), "Agency");
    await userEvent.click(screen.getByRole("checkbox", { name: "Pin view" }));
    await userEvent.click(screen.getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ name: "Agency", filters, pinned: true, isDefault: false }, expect.anything()));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ name: "Agency", filters }));
  });
  it("keeps a reloaded JSON-storage view unmodified when field order changes", async () => {
    const persisted = { group: filters.group, density: filters.density, tags: filters.tags, direction: filters.direction, sort: filters.sort, health: filters.health, tagMode: filters.tagMode, search: filters.search };
    mocks.list.mockResolvedValue([{ ...saved, filters: persisted }]);
    show({ selectedId: saved.id });
    await screen.findByText("Production");
    await userEvent.click(screen.getByRole("button", { name: "Saved views: Production" }));
    expect(screen.getByText(en.views.description)).toBeInTheDocument();
    expect(screen.queryByLabelText(en.views.modified)).not.toBeInTheDocument();
  });
  it("shows failure and retry without silently applying a view", async () => {
    mocks.initial.mockRejectedValueOnce(new Error("Fixture unavailable"));
    const { onApply } = show({ allowDefault: true });
    await screen.findByRole("alert"); expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: en.metrics.retry }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(saved, true));
  });
  it("names the picker after the selected view and the menu for what it does, so the two buttons never share a name", async () => {
    show({ selectedId: saved.id });
    await screen.findByText("Production");
    const picker = screen.getByRole("button", { name: "Saved views: Production" });
    const manage = screen.getByRole("button", { name: "Saved view actions" });
    expect(picker).not.toBe(manage);
    expect(screen.getAllByRole("button", { name: /saved view/i })).toHaveLength(2);
    expect(picker).toHaveTextContent("Production");
  });
  it("tells a first-time user how to save the current filters, and opens the save form with the current filters", async () => {
    mocks.list.mockResolvedValue([]);
    show();
    await waitFor(() => expect(screen.getByRole("button", { name: "Saved views" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Saved views" }));
    expect(await screen.findByText(en.views.firstSave)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: en.views.saveCurrent }));
    expect(await screen.findByRole("textbox", { name: "View name" })).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});


it("renames a saved view without replacing its saved filters with current filters", async () => {
  show({ selectedId: saved.id, filters: { ...filters, search: "unsaved change" } });
  await screen.findByText("Production");
  await userEvent.click(screen.getByRole("button", { name: "Saved view actions" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Rename saved view" }));
  const name = screen.getByLabelText("View name"); await userEvent.clear(name); await userEvent.type(name, "Renamed");
  await userEvent.click(screen.getByRole("button", { name: "Save view" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id, name: "Renamed", filters: saved.filters }), expect.anything()));
});
it("disables clearing an already unfiltered view", async () => {
  show({ filters: { search: "", tags: [], tagMode: "any", health: "all", sort: "status", direction: "asc", density: "comfortable", group: "none" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Saved views" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Saved view actions" }));
  expect(screen.getByRole("menuitem", { name: "Clear filters" })).toHaveAttribute("aria-disabled", "true");
});

it("deletes a named unselected view after confirmation without clearing the current filters", async () => {
  const confirm = vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true); mocks.remove.mockResolvedValue({ success: true });
  const { onClear } = show({ pickerOpen: true });
  await userEvent.click(await screen.findByRole("button", { name: "Saved view actions — Production" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Remove view" }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(saved.id, expect.anything()));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Production"), expect.objectContaining({ title: "Remove view" })); expect(onClear).not.toHaveBeenCalled(); confirm.mockRestore();
});

it("hides the selected view while removal is pending and restores it on failure", async () => {
  const confirm = vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true);
  let reject!: (error: Error) => void;
  mocks.remove.mockImplementation(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
  const { onClear, client } = show({ selectedId: saved.id });
  const defaultKey = uptimeKeys.views.initial("owner");
  client.setQueryData(defaultKey, saved);
  await screen.findByRole("button", { name: "Saved views: Production" });
  await userEvent.click(screen.getByRole("button", { name: "Saved view actions" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Remove view" }));
  await screen.findByRole("button", { name: "Saved views" });
  expect(client.getQueryData(defaultKey)).toBeNull();
  expect(onClear).not.toHaveBeenCalled();
  await act(async () => reject(new Error("Removal failed")));
  await screen.findByRole("button", { name: "Saved views: Production" });
  expect(client.getQueryData(defaultKey)).toEqual(saved);
  expect(onClear).not.toHaveBeenCalled();
  confirm.mockRestore();
});


it("shows the saved-view action tooltip and returns focus after Escape without stealing save-dialog focus", async () => {
  show();
  const manage = screen.getByRole("button", { name: "Saved view actions" });
  await userEvent.hover(manage);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Saved view actions");
  await userEvent.click(manage);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(manage).toHaveFocus());
  await userEvent.click(manage);
  await userEvent.click(screen.getByRole("menuitem", { name: "Save new view" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "View name" })).toHaveFocus());
});


it("keeps the saved-view picker flexible inside its reserved toolbar width", async () => {
  show({ selectedId: saved.id, filters: { ...filters, search: "changed" } });
  const button = await screen.findByRole("button", { name: "Saved views: Production" });
  expect(button).toHaveClass("min-w-0", "flex-1");
  expect(button.parentElement).toHaveClass("w-full", "min-w-0");
  expect(screen.getByText("Production")).toHaveClass("truncate", "flex-1");
});

it("replaces a cached former default when saving another default, including all initial-view caches", async () => {
  const next = { ...saved, id: "v2", name: "New default", isDefault: true };
  mocks.initial.mockResolvedValue(next); mocks.save.mockResolvedValue(next);
  const { client, onApply } = show({ selectedId: next.id });
  const defaultKey = uptimeKeys.views.initial("owner");
  client.setQueryData(defaultKey, saved);
  client.setQueryData(uptimeKeys.views.initial("owner", saved.id), saved);
  await screen.findByRole("button", { name: "Saved views: New default" });
  await userEvent.click(screen.getByRole("button", { name: "Saved view actions" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Save new view" }));
  await userEvent.type(screen.getByRole("textbox", { name: "View name" }), "New default");
  await userEvent.click(screen.getByRole("checkbox", { name: en.views.defaultDescription }));
  await userEvent.click(screen.getByRole("button", { name: "Save view" }));
  await waitFor(() => expect(onApply).toHaveBeenCalledWith(next));
  expect(client.getQueryData(defaultKey)).toEqual(next);
  expect(client.getQueryData(uptimeKeys.views.initial("owner", saved.id))).toMatchObject({ id: saved.id, isDefault: false });
});

it("keeps a newer editor draft when a dismissed save completes", async () => {
  let release!: (view: MonitorView) => void;
  mocks.save.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  vi.spyOn(confirmations, "requestConfirmation").mockResolvedValue(true);
  const { onApply } = show();
  await userEvent.click(screen.getByRole("button", { name: "Saved view actions" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Save new view" }));
  await userEvent.type(screen.getByRole("textbox", { name: "View name" }), "First draft");
  await userEvent.click(screen.getByRole("button", { name: "Save view" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  const discard = await screen.findByRole("alertdialog");
  await userEvent.click(within(discard).getByRole("button", { name: "actions.discard" }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "View name" })).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Saved view actions" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Save new view" }));
  await userEvent.type(screen.getByRole("textbox", { name: "View name" }), "Second draft");
  await act(async () => release({ ...saved, name: "First draft" }));
  expect(screen.getByRole("textbox", { name: "View name" })).toHaveValue("Second draft");
  expect(onApply).not.toHaveBeenCalled();
});

it("ignores an older inactive default read after saving a new default", async () => {
  const next = { ...saved, id: "v2", name: "New default", isDefault: true };
  mocks.initial.mockResolvedValue(next); mocks.save.mockResolvedValue(next);
  const { client, onApply } = show({ selectedId: next.id });
  await screen.findByRole("button", { name: "Saved views: New default" });
  const defaultKey = uptimeKeys.views.initial("owner");
  client.setQueryData(defaultKey, saved);
  let release!: (view: MonitorView) => void;
  const oldRead = client.fetchQuery({ queryKey: defaultKey, queryFn: () => new Promise<MonitorView>(resolve => { release = resolve; }) }).catch(() => null);
  await userEvent.click(screen.getByRole("button", { name: "Saved view actions" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Save new view" }));
  await userEvent.type(screen.getByRole("textbox", { name: "View name" }), "New default");
  await userEvent.click(screen.getByRole("checkbox", { name: en.views.defaultDescription }));
  await userEvent.click(screen.getByRole("button", { name: "Save view" }));
  await waitFor(() => expect(onApply).toHaveBeenCalledWith(next));
  await act(async () => { release(saved); await oldRead; });
  expect(client.getQueryData(defaultKey)).toEqual(next);
});
