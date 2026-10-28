import { useState } from "react";
import { GlobalSearchDialog } from "@/components/uptime/global-search-dialog";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, defaultParseSearch, Outlet, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import type { MonitorView } from "@/types/monitor-views";
import { carrySearch } from "@/lib/uptime/dashboard-search";
import { Route } from "./dashboard";
type RouterModule = typeof import("@tanstack/react-router");

const fixtures = vi.hoisted(() => ({
  monitors: Array.from({ length: 6 }, (_, index) => ({ uptimeMonitorId: `m${index}`, name: `API ${index}`, tags: index % 2 ? ["env:qa", "qa-bug"] : ["client,one", "two words"], isPublic: false })),
  saved: {
    id: "v1", name: "QA", pinned: false, isDefault: false, createdAt: "", updatedAt: "",
    filters: { search: "api", tags: ["client,one", "two words"], tagMode: "all", health: "down", sort: "name", direction: "desc", density: "compact", group: "tag" },
  } satisfies MonitorView,
}));
vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });
// Keep the real router/history/serialization, binding the file-route component
// to a small memory route tree instead of bootstrapping authentication.
vi.mock("@tanstack/react-router", async importOriginal => {
  const actual = await importOriginal<RouterModule>();
  return { ...actual, createFileRoute: () => (options: object) => ({ options, useSearch: () => actual.useSearch({ strict: false }) }) };
});
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner" } } }) }));
vi.mock("@/hooks/uptime", () => ({
  useUptimeMonitors: () => ({ data: fixtures.monitors, isLoading: false, error: null }),
  useMonitorListUpdating: () => false,
 useIncidentSearch: () => ({ data: [], isFetching: false }),
}));
vi.mock("@/components/uptime/monitor-views-controls", () => ({ MonitorViewsControls: ({ onApply, onClear, allowDefault }: { onApply: (view: MonitorView) => void; onClear: () => void; allowDefault: boolean }) => <><button onClick={() => onApply(fixtures.saved)}>Restore saved view</button><button disabled={!allowDefault} onClick={() => onApply(fixtures.saved)}>Apply default saved view</button><button onClick={onClear}>Clear saved view</button></> }));
vi.mock("@/components/uptime/monitor-list", () => ({ MonitorList: ({ selectedTags, searchQuery, group }: { selectedTags: string[]; searchQuery?: string; group: string }) => <output data-testid="list-filters">{JSON.stringify({ tags: selectedTags, q: searchQuery, group })}</output> }));
vi.mock("@/components/uptime/channel-health-banner", () => ({ ChannelHealthBanner: () => null }));
vi.mock("@/components/uptime/uptime-stats-cards", () => ({ UptimeStatsCards: () => null }));
vi.mock("@/components/uptime/network-controls", () => ({ NetworkMonitorDialog: () => null }));
vi.mock("@/components/uptime/monitor-reuse-controls", () => ({ MonitorTemplatesControls: () => null }));
vi.mock("@/components/uptime/heartbeat-controls", () => ({ HeartbeatCreateControl: () => null }));
vi.mock("@/components/uptime/monitor-bulk-add-dialog", () => ({ MonitorBulkAddDialog: () => null }));
vi.mock("@/components/uptime/monitor-create-dialog", () => ({ MonitorCreateDialog: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="HTTP creation fixture">HTTP monitor form</div> : null }));
vi.mock("@/components/uptime/monitor-quick-add", () => ({ MonitorQuickAdd: () => null }));
vi.mock("@/components/uptime/notification-settings-sheet", () => ({ NotificationSettingsSheet: () => null }));
vi.mock("@/components/uptime/share/share-links-sheet", () => ({ ShareLinksSheet: () => null }));
vi.mock("@/components/uptime/status-pages-sheet", () => ({ StatusPagesSheet: () => null }));

vi.mock("@/components/uptime/server-health-controls", () => ({ ServerCreateControl: () => null }));

function fixture(initial = "/dashboard") {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({ getParentRoute: () => root, path: "/dashboard", component: Route.options.component, validateSearch: Route.options.validateSearch });
  const router = createRouter({ routeTree: root.addChildren([dashboard]), history: createMemoryHistory({ initialEntries: [initial] }) });
  return { router, ...render(<RouterProvider router={router} />) };
}

describe("dashboard filter navigation", () => {
  it("clears search without changing tags and restores tag changes through back/forward", async () => {
    const { router } = fixture("/dashboard?q=api");
    await screen.findByRole("searchbox");
    await userEvent.click(screen.getByRole("button", { name: /^common:nav.filters/ }));
    await userEvent.click(screen.getByRole("button", { name: "env:qa" }));
    await waitFor(() => expect(router.state.location.search.tags).toEqual(["env:qa"]));
    await userEvent.click(screen.getByRole("button", { name: "qa-bug" }));
    await waitFor(() => expect(router.state.location.search.tags).toEqual(["env:qa", "qa-bug"]));
    expect(JSON.parse(new URLSearchParams(router.state.location.searchStr).get("tags")!)).toEqual(["env:qa", "qa-bug"]);
    act(() => router.history.back());
    await waitFor(() => expect(screen.getByRole("button", { name: "qa-bug" })).toHaveAttribute("aria-pressed", "false"));
    expect(router.state.location.search.tags).toEqual(["env:qa"]);
    act(() => router.history.forward());
    await waitFor(() => expect(screen.getByRole("button", { name: "qa-bug" })).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(router.state.location.search.q).toBeUndefined());
    expect(router.state.location.search.tags).toEqual(["env:qa", "qa-bug"]);
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.getByTestId("list-filters")).toHaveTextContent('"tags":["env:qa","qa-bug"]');
  });

  it("restores saved-view fields, reloads their URL, groups by tag and clears all filters", async () => {
    const { router, unmount } = fixture();
    await userEvent.click(await screen.findByRole("button", { name: "Restore saved view" }));
    await waitFor(() => expect(router.state.location.search.viewId).toBe("v1"));
    expect(router.state.location.search).toMatchObject({ q: "api", tags: fixtures.saved.filters.tags, tagMode: "all", status: "down", sort: "name", dir: "desc", view: "compact", group: "tag" });
    expect(screen.getByTestId("list-filters")).toHaveTextContent('"group":"tag"');
    const reloadUrl = router.state.location.href;
    unmount();
    const reloaded = fixture(reloadUrl);
    expect(await screen.findByRole("searchbox")).toHaveValue("api");
    expect(reloaded.router.state.location.search.tags).toEqual(fixtures.saved.filters.tags);
    await userEvent.click(within(screen.getByRole("group", { name: "views.activeFilters" })).getByRole("button", { name: "views.clear" }));
    await waitFor(() => expect(reloaded.router.state.location.search).toEqual({ noDefault: true }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("accepts the reported old URL and ignores malformed tags on reload", async () => {
    const { router, unmount } = fixture("/dashboard?tags=%22%5B%5C%22env%3Aqa%5C%22%2C%5C%22qa-bug%5C%22%5D%22");
    await screen.findByRole("searchbox");
    // The raw location contains the old string until the next navigation;
    // validated route state delivered to the monitor list already has arrays.
    expect(screen.getByTestId("list-filters")).toHaveTextContent('"tags":["env:qa","qa-bug"]');
    await userEvent.click(screen.getByRole("button", { name: /^common:nav.filters/ }));
    await userEvent.click(screen.getByRole("button", { name: "client,one" }));
	    expect(carrySearch(defaultParseSearch(router.state.location.searchStr)).tags).toEqual(["env:qa", "qa-bug", "client,one"]);
    unmount();
    fixture("/dashboard?q=api&tags=%5Bbroken");
    expect(await screen.findByRole("searchbox")).toHaveValue("api");
    expect(screen.getByTestId("list-filters")).toHaveTextContent('"tags":[]');
  });

  it("keeps chip layout after the panel and tag choices in place during pointer and keyboard toggles", async () => {
    fixture('/dashboard?tags=%5B%22orphan%22%5D');
    await userEvent.click(await screen.findByRole("button", { name: /^common:nav.filters/ }));
    const panel = document.getElementById("monitor-filters")!;
    const orphan = within(panel).getByRole("button", { name: "orphan" });
    const choices = within(panel).getAllByRole("button");
    for (let index = 0; index < 3; index++) {
      await userEvent.click(orphan);
      expect(within(panel).getAllByRole("button")).toEqual(choices);
      expect(orphan).toHaveFocus();
      await userEvent.keyboard(" ");
      await waitFor(() => expect(orphan).toHaveAttribute("aria-pressed", "true"));
      const chips = screen.getByRole("group", { name: "views.activeFilters" });
      expect(panel.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});


it("groups add choices and restores split-trigger focus after the first opening and Escape", async () => {
  fixture();
  const trigger = await screen.findByRole("button", { name: "actions.chooseMonitorType" });
  await userEvent.click(trigger);
  const menu = screen.getByRole("menu");
  expect(within(menu).getByText("actions.monitorType")).toBeInTheDocument();
  expect(within(menu).getByText("actions.otherWaysToAdd")).toBeInTheDocument();
  expect(within(menu).getByRole("separator")).toBeInTheDocument();
  expect(within(menu).getAllByRole("menuitem")).toHaveLength(7);
  for (const item of within(menu).getAllByRole("menuitem")) expect(item.querySelector("svg")).not.toBeNull();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
  await userEvent.click(trigger);
  expect(screen.getByRole("menu")).toBeInTheDocument();
});

it("exposes a density tooltip and preserves URL filters while toggling compact rows", async () => {
  const { router } = fixture("/dashboard?q=api&status=down");
  const density = await screen.findByRole("button", { name: "list.view.compactRows" });
  await userEvent.hover(density);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("list.view.compactRows");
  await userEvent.click(density);
  await waitFor(() => expect(density).toHaveAttribute("aria-pressed", "true"));
  expect(router.state.location.search).toMatchObject({ q: "api", status: "down", view: "compact" });
  await userEvent.click(density);
  await waitFor(() => expect(density).toHaveAttribute("aria-pressed", "false"));
  expect(router.state.location.search).toMatchObject({ q: "api", status: "down" });
});

it("keeps group and density controls available in Filters and persists their changes", async () => {
  const { router } = fixture('/dashboard?q=api');
  await userEvent.click(await screen.findByRole("button", { name: /^common:nav.filters/ }));
  const panel = document.getElementById("monitor-filters")!;
  const group = within(panel).getByRole("combobox", { name: "views.group" });
  await userEvent.click(group);
  await userEvent.click(screen.getByRole("option", { name: "views.byTag" }));
  await waitFor(() => expect(router.state.location.search.group).toBe("tag"));
  const density = within(panel).getByRole("button", { name: "list.view.compactRows" });
  await userEvent.click(density);
  await waitFor(() => expect(density).toHaveAttribute("aria-pressed", "true"));
  expect(router.state.location.search).toMatchObject({ q: "api", group: "tag", view: "compact" });
});

it.each(["/dashboard?panel=notifications&notificationTab=defaults", "/dashboard?notificationTab=monitors"])("allows defaults and preserves notification context while applying/clearing views: %s", async url => {
  const { router } = fixture(url);
  const notificationTab = new URL(url, "https://pulsy.test").searchParams.get("notificationTab");
  const panel = new URL(url, "https://pulsy.test").searchParams.get("panel") ?? undefined;
  const apply = await screen.findByRole("button", { name: "Apply default saved view" });
  expect(apply).toBeEnabled();
  await userEvent.click(apply);
  await waitFor(() => expect(router.state.location.search.viewId).toBe("v1"));
  expect(router.state.location.search).toMatchObject({ notificationTab, q: "api" });
  expect(router.state.location.search.panel).toBe(panel);
  await userEvent.click(screen.getByRole("button", { name: "Clear saved view" }));
  await waitFor(() => expect(router.state.location.search.noDefault).toBe(true));
  expect(router.state.location.search.notificationTab).toBe(notificationTab);
  expect(router.state.location.search.panel).toBe(panel);
  expect(router.state.location.search.viewId).toBeUndefined();
  expect(router.state.location.search.q).toBeUndefined();
});


it("labels global summary and resets filter matching while preserving display choices", async () => {
  const { router } = fixture('/dashboard?q=api&status=down&tagMode=all&group=tag&tags=%5B%22env%3Aqa%22%5D');
  expect(await screen.findByRole("heading", { name: "workspace.allMonitors" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /^common:nav.filters/ }));
  const reset = screen.getByRole("button", { name: "views.reset" });
  expect(reset).toBeEnabled();
  await userEvent.click(reset);
  await waitFor(() => expect(router.state.location.search.tagMode).toBeUndefined());
  expect(router.state.location.search.q).toBeUndefined();
  expect(router.state.location.search.tags).toBeUndefined();
  expect(router.state.location.search.status).toBeUndefined();
  expect(router.state.location.search.group).toBe("tag");
  expect(reset).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "views.tagMode" })).toHaveTextContent("views.any");
});

it("opens monitor creation from the palette on another private route", async () => {
  function SearchShell() { const [open, setOpen] = useState(true); return <><Outlet /><GlobalSearchDialog open={open} onOpenChange={setOpen} /></>; }
  const root = createRootRoute({ component: SearchShell });
  const dashboard = createRoute({ getParentRoute: () => root, path: "/dashboard", component: Route.options.component, validateSearch: Route.options.validateSearch });
  const keys = createRoute({ getParentRoute: () => root, path: "/dashboard/api-keys", component: () => <h1>API keys fixture</h1> });
  const router = createRouter({ routeTree: root.addChildren([dashboard, keys]), history: createMemoryHistory({ initialEntries: ["/dashboard/api-keys"] }) });
  render(<RouterProvider router={router} />);
  await screen.findByText("API keys fixture");
  await userEvent.click(screen.getByRole("option", { name: "search.action.addMonitor" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
  expect(await screen.findByRole("dialog", { name: "HTTP creation fixture" })).toBeVisible();
});
