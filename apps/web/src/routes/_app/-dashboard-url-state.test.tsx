import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { Route } from "./dashboard";

vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@tanstack/react-router", async original => {
  const actual = await original<typeof import("@tanstack/react-router")>();
  return { ...actual, createFileRoute: () => (options: object) => ({ options, useSearch: () => actual.useSearch({ strict: false }) }) };
});
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner" } } }) }));
vi.mock("@/hooks/uptime", () => ({ useUptimeMonitors: () => ({ data: [{ uptimeMonitorId: "m1", name: "API", tags: [] }], isLoading: false }), useMonitorListUpdating: () => false }));
vi.mock("@/components/uptime/monitor-list", () => ({ MonitorList: ({ selectedTags, onTagsChange }: { selectedTags: string[]; onTagsChange: (tags: string[]) => void }) => <><output>{JSON.stringify(selectedTags)}</output><button onClick={() => onTagsChange([...selectedTags, "client,one"])}>Add comma tag</button></> }));
vi.mock("@/components/uptime/uptime-stats-cards", () => ({ UptimeStatsCards: ({ onStatusChange }: { onStatusChange: (status: "pending") => void }) => <button onClick={() => onStatusChange("pending")}>Pending</button> }));
vi.mock("@/components/uptime/monitor-bulk-add-dialog", () => ({ MonitorBulkAddDialog: () => null }));
vi.mock("@/components/uptime/monitor-create-dialog", () => ({ MonitorCreateDialog: () => null }));
vi.mock("@/components/uptime/monitor-quick-add", () => ({ MonitorQuickAdd: () => null }));
vi.mock("@/components/uptime/notification-settings-sheet", () => ({ NotificationSettingsSheet: () => null }));
vi.mock("@/components/uptime/share/share-links-sheet", () => ({ ShareLinksSheet: () => null }));
vi.mock("@/components/uptime/status-pages-sheet", () => ({ StatusPagesSheet: () => null }));

it("preserves every dashboard URL field, round-trips comma tags and restores filters with history", async () => {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({ getParentRoute: () => root, path: "/dashboard", component: Route.options.component, validateSearch: Route.options.validateSearch });
  const router = createRouter({ routeTree: root.addChildren([dashboard]), history: createMemoryHistory({ initialEntries: ["/dashboard?q=api&sort=name&dir=desc&view=compact&tagMode=all&group=tag&viewId=v1&panel=notifications&notificationTab=defaults"] }) });
  render(<RouterProvider router={router} />);
  await userEvent.click(await screen.findByRole("button", { name: "Add comma tag" }));
  await waitFor(() => expect(router.state.location.search.tags).toEqual(["client,one"]));
  expect(router.state.location.search).toMatchObject({ q: "api", sort: "name", dir: "desc", view: "compact", tagMode: "all", group: "tag", viewId: "v1", panel: "notifications", notificationTab: "defaults", noDefault: true });
  expect(JSON.parse(new URLSearchParams(router.state.location.searchStr).get("tags")!)).toEqual(["client,one"]);
  await userEvent.click(screen.getByRole("button", { name: "Pending" }));
  await waitFor(() => expect(router.state.location.search.status).toBe("pending"));
  act(() => router.history.back());
  await waitFor(() => expect(router.state.location.search.status).toBeUndefined());
  expect(router.state.location.search.tags).toEqual(["client,one"]);
  act(() => router.history.forward());
  await waitFor(() => expect(router.state.location.search.status).toBe("pending"));
  expect(screen.getByText('["client,one"]')).toHaveTextContent('["client,one"]');
});

vi.mock("@/components/uptime/monitor-views-controls", () => ({ MonitorViewsControls: () => null }));
vi.mock("@/components/uptime/monitor-reuse-controls", () => ({ MonitorTemplatesControls: () => null }));
vi.mock("@/components/uptime/channel-health-banner", () => ({ ChannelHealthBanner: () => null }));
vi.mock("@/components/uptime/server-health-controls", () => ({ ServerCreateControl: () => null }));
vi.mock("@/components/uptime/network-controls", () => ({ NetworkMonitorDialog: () => null }));
vi.mock("@/components/uptime/heartbeat-controls", () => ({ HeartbeatCreateControl: () => null }));
