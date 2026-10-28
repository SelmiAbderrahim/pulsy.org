import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { IncidentWorkspace } from "./incident-workspace";
import type { IncidentWorkspaceFilters } from "@/types/incident-workspace";
vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner" } } }) }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
const service = vi.hoisted(() => ({ list: vi.fn(), one: vi.fn(), group: vi.fn(), acknowledge: vi.fn(), unacknowledge: vi.fn(), channels: vi.fn() }));
vi.mock("@/services/uptime/incidentWorkspaceService", () => ({ IncidentWorkspaceService: service }));
vi.mock("@/services/uptime/uptimeService", () => ({ UptimeService: { listMonitors: vi.fn().mockResolvedValue([]) } }));
const row = (id: string, name: string, over: Record<string, unknown> = {}) => ({ incidentId: id, monitorName: name, status: "ongoing", acknowledgedAt: null, severity: "critical", cause: "HTTP 503", startedAt: "2026-10-09T12:00:00.000Z", durationSeconds: 120, lastUpdatedAt: "2026-10-09T12:05:00.000Z", measuredHealth: "down", monitorActive: true, ...over });
function mount(props: Partial<React.ComponentProps<typeof IncidentWorkspace>> = {}) {
  const onFilters = vi.fn(), onCursor = vi.fn(), onSelect = vi.fn();
  const filters: IncidentWorkspaceFilters = { state: "open", search: "" };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><IncidentWorkspace filters={filters} onFilters={onFilters} onCursor={onCursor} onSelect={onSelect} {...props} /></QueryClientProvider>);
  return { ...view, onFilters, onCursor, onSelect, client };
}
beforeEach(() => { vi.clearAllMocks(); });
describe("incident list hierarchy and selection", () => {
  it("labels response state and measured health separately and the opening cause, without a meaningless owner marker", async () => {
    service.list.mockResolvedValue({ items: [row("i1", "API", { acknowledgedAt: "2026-10-09T12:01:00.000Z" })], nextCursor: null });
    mount();
    await screen.findByText("API");
    expect(screen.getByText("workspace.measuredHealth:")).toBeInTheDocument();
    expect(screen.getByText("workspace.workflow:")).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getByText("workspace.stateBadge.acknowledged")).toBeInTheDocument();
    expect(screen.getByText("status.down")).toBeInTheDocument();
    expect(screen.getByText("workspace.openedBecause:", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("· workspace.you")).not.toBeInTheDocument();
  });
  it("tells page count apart from the rest of the results", async () => {
    service.list.mockResolvedValue({ items: [row("i1", "API")], nextCursor: { startedAt: "2026-10-09T12:00:00.000Z", incidentId: "i1" } });
    const first = mount();
    expect(await screen.findByText(/incidentUX\.resultMore/)).toBeInTheDocument();
    first.unmount();
    service.list.mockResolvedValue({ items: [row("i2", "Web")], nextCursor: null });
    mount({ cursor: { startedAt: "2026-10-09T12:00:00.000Z", incidentId: "i1" } });
    expect(await screen.findByText(/incidentUX\.resultLast/)).toBeInTheDocument();
  });
  it("says all matching incidents are shown on a single page", async () => {
    service.list.mockResolvedValue({ items: [row("i1", "API")], nextCursor: null });
    mount();
    expect(await screen.findByText(/incidentUX\.resultAll/)).toBeInTheDocument();
  });
  it("drops a selected incident that a new result set no longer contains and never groups it", async () => {
    service.list.mockResolvedValueOnce({ items: [row("i1", "API"), row("i2", "Web")], nextCursor: null });
    const view = mount();
    await userEvent.click((await screen.findAllByRole("checkbox"))[0]!);
    expect(screen.getByLabelText("workspace.groupSelected")).toBeInTheDocument();
    service.list.mockResolvedValue({ items: [row("i2", "Web")], nextCursor: null });
    view.rerender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IncidentWorkspace filters={{ state: "resolved", search: "" }} onFilters={view.onFilters} onCursor={view.onCursor} onSelect={view.onSelect} /></QueryClientProvider>);
    await waitFor(() => expect(screen.queryByLabelText("workspace.groupSelected")).not.toBeInTheDocument());
    expect(service.group).not.toHaveBeenCalled();
  });
  it("keeps group actions out of row flow and requires two selected incidents", async () => {
    service.list.mockResolvedValue({ items: [row("i1", "API"), row("i2", "Web")], nextCursor: null });
    service.group.mockResolvedValue({ id: "group" });
    mount();
    const choices = await screen.findAllByRole("checkbox", { name: "workspace.select" });
    await userEvent.click(choices[0]!);
    const actions = screen.getByRole("form", { name: "workspace.createGroup" });
    expect(actions).toHaveClass("fixed");
    await userEvent.type(screen.getByLabelText("workspace.groupSelected"), "Outage");
    expect(screen.getByRole("button", { name: "workspace.createGroup" })).toBeDisabled();
    expect(screen.getByText("workspace.groupMinimum")).toBeInTheDocument();
    await userEvent.click(choices[1]!);
    await userEvent.click(screen.getByRole("button", { name: "workspace.createGroup" }));
    expect(service.group).toHaveBeenCalledWith("Outage", ["i1", "i2"]);
  });
  it("opens a row by explicit choice and closes back to the list", async () => {
    service.list.mockResolvedValue({ items: [row("i1", "API")], nextCursor: null });
    const { onSelect } = mount();
    await userEvent.click(await screen.findByRole("button", { name: "API" }));
    expect(onSelect).toHaveBeenCalledWith("i1");
  });
});


it("uses searchable monitor choices and keeps the other URL filters when selecting", async () => {
  service.list.mockResolvedValue({ items: [], nextCursor: null });
  const filters = { state: "acknowledged" as const, severity: "critical" as const, search: "API", monitorId: "saved-monitor" };
  const { onFilters } = mount({ filters });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "workspace.monitorFilter" })).toBeEnabled());
  const monitor = screen.getByRole("combobox", { name: "workspace.monitorFilter" });
  expect(monitor).toHaveTextContent("workspace.selectedMonitor");
  await userEvent.click(monitor);
  expect(screen.getByRole("combobox", { name: "controls.search" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("option", { name: "workspace.allMonitors" }));
  await waitFor(() => expect(onFilters).toHaveBeenCalledWith({ ...filters, monitorId: undefined }));
});

it("matches dashboard search affordances while preserving other URL filters", async () => {
  service.list.mockResolvedValue({ items: [], nextCursor: null });
  const filters = { state: "all" as const, severity: "critical" as const, search: "", monitorId: "monitor" };
  const { onFilters } = mount({ filters });
  const search = screen.getByRole("searchbox", { name: "workspace.search" });
  expect(search).toHaveAttribute("placeholder", "Search incidents");
  expect(search).toHaveClass("ps-9", "pe-10");
  expect(search.parentElement?.querySelector("svg")).toHaveClass("start-3", "pointer-events-none");
  fireEvent.change(search, { target: { value: "HTTP 503" } });
  await waitFor(() => expect(onFilters).toHaveBeenCalledWith({ ...filters, search: "HTTP 503" }));
});

it("shows a compact resolved duration with keyboard-accessible exact seconds and both dates", async () => {
  service.list.mockResolvedValue({ items: [row("resolved", "API", { status: "resolved", durationSeconds: 325380, resolvedAt: "2026-10-13T06:23:00.000Z" })], nextCursor: null });
  mount();
  const duration = await screen.findByText("3d 18h 23m");
  expect(duration).toHaveAttribute("title", expect.stringContaining("325,380 seconds"));
  expect(duration.getAttribute("title")).toMatch(/October 9.*October 13/);
  expect(duration).toHaveAttribute("tabindex", "0");
  act(() => duration.focus());
  expect(await screen.findByRole("tooltip")).toHaveTextContent(duration.getAttribute("title")!);
});

it("acknowledges once from the card and refreshes list and cached detail without opening the drawer", async () => {
  service.list.mockResolvedValue({ items: [row("i1", "API")], nextCursor: null });
  let resolve!: (value: { acknowledged: boolean }) => void;
  service.acknowledge.mockReturnValue(new Promise(done => { resolve = done; }));
  const { client, onSelect } = mount();
  client.setQueryData(uptimeKeys.incidents.response("owner", "i1"), { marker: "cached detail" });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const acknowledge = await screen.findByRole("button", { name: "workspace.acknowledge" });
  fireEvent.click(acknowledge); fireEvent.click(acknowledge);
  expect(service.acknowledge).toHaveBeenCalledTimes(1);
  expect(service.acknowledge).toHaveBeenCalledWith("i1");
  expect(acknowledge).toBeDisabled();
  service.list.mockResolvedValue({ items: [row("i1", "API", { acknowledgedAt: "2026-10-09T12:06:00Z" })], nextCursor: null });
  await act(async () => resolve({ acknowledged: true }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: uptimeKeys.incidents.all() }));
  expect(client.getQueryState(uptimeKeys.incidents.response("owner", "i1"))?.isInvalidated).toBe(true);
  await waitFor(() => expect(screen.getByText("workspace.stateBadge.acknowledged")).toBeVisible());
  expect(screen.getByRole("button", { name: "workspace.unacknowledge" })).toBeEnabled();
  expect(screen.getByText("status.down")).toBeVisible();
  expect(onSelect).not.toHaveBeenCalled();
});

it("keeps a failed quick acknowledgement retryable without changing health or selection", async () => {
  service.list.mockResolvedValue({ items: [row("i1", "API")], nextCursor: null });
  service.acknowledge.mockRejectedValueOnce(new Error("Temporary failure")).mockResolvedValue({ acknowledged: true });
  const { onSelect } = mount();
  const acknowledge = await screen.findByRole("button", { name: "workspace.acknowledge" });
  await userEvent.click(acknowledge);
  expect(await screen.findByRole("alert")).toHaveTextContent("Temporary failure");
  expect(acknowledge).toBeEnabled();
  expect(screen.getByText("status.down")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "workspace.select" })).not.toBeChecked();
  await userEvent.click(acknowledge);
  await waitFor(() => expect(service.acknowledge).toHaveBeenCalledTimes(2));
  expect(onSelect).not.toHaveBeenCalled();
});

it("formats the same incident-start instant identically in the card, drawer and timeline", async () => {
  const startedAt = "2026-10-09T12:00:37.000Z";
  service.list.mockResolvedValue({ items: [row("i1", "API", { startedAt })], nextCursor: null });
  service.channels.mockResolvedValue({ items: [], nextCursor: null });
  service.one.mockResolvedValue({ incident: { incidentId: "i1", uptimeMonitorId: "m1", startedAt, status: "ongoing", cause: "HTTP 503", severity: "critical" }, monitor: { id: "m1", name: "API", status: "down" }, response: { acknowledgedAt: null, runbookDescription: "", runbookUrl: null, escalationSteps: null, escalationDisabled: false, group: null }, timeline: [{ id: "opened", kind: "opened", createdAt: startedAt, actorId: null }], timelineTruncated: false });
  const { container } = mount({ incidentId: "i1" });
  await waitFor(() => expect(container.querySelectorAll(`time[datetime="${startedAt}"]`)).toHaveLength(3));
  const timestamps = Array.from(container.querySelectorAll(`time[datetime="${startedAt}"]`));
  expect(new Set(timestamps.map(time => time.textContent)).size).toBe(1);
  expect(timestamps[0]?.textContent).toMatch(/:37/);
});


it("uses indeterminate selection and unacknowledges from the shared card", async () => {
  service.list.mockResolvedValue({ items: [row("i1", "API", { acknowledgedAt: "2026-10-14T12:00:00.000Z", acknowledgedBy: "owner" }), row("i2", "Other", { status: "resolved" })], nextCursor: null });
  service.unacknowledge.mockImplementation(async () => { service.list.mockResolvedValue({ items: [row("i1", "API"), row("i2", "Other", { status: "resolved" })], nextCursor: null }); return { acknowledged: false }; });
  mount();
  const action = await screen.findByRole("button", { name: "workspace.unacknowledge" });
  expect(screen.queryByRole("button", { name: "workspace.acknowledge" })).not.toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("checkbox", { name: "workspace.select" })[0]!);
  expect(screen.getByRole("checkbox", { name: "Select all visible incidents" })).toHaveAttribute("aria-checked", "mixed");
  await userEvent.click(action);
  await waitFor(() => expect(service.unacknowledge).toHaveBeenCalledWith("i1"));
  await screen.findByRole("button", { name: "workspace.acknowledge" });
});


it("discards the active draft before pagination and does not prompt again on the next selection", async () => {
  const confirmations = await import("@/lib/confirmation");
  const { hasRegisteredDraft } = await import("@/lib/draft-guards");
  const confirm = vi.spyOn(confirmations, "requestDiscardConfirmation").mockResolvedValue(true);
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
  service.list.mockResolvedValue({ items: [row("i1", "API"), row("i2", "Worker")], nextCursor: { startedAt: "2026-10-09T12:00:00Z", incidentId: "i2" } });
  service.channels.mockResolvedValue({ items: [], nextCursor: null });
  service.one.mockResolvedValue({ incident: { incidentId: "i1", uptimeMonitorId: "m1", startedAt: "2026-10-09T12:00:00Z", status: "ongoing", cause: "HTTP 503" }, monitor: { id: "m1", name: "API", status: "down" }, response: { acknowledgedAt: null, runbookDescription: "", runbookUrl: null, escalationSteps: null, escalationDisabled: false, group: null }, timeline: [], timelineTruncated: false });
  const view = mount({ incidentId: "i1" });
  try {
    await userEvent.type(await screen.findByLabelText("workspace.note"), "Discarded response");
    expect(hasRegisteredDraft()).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "workspace.nextPage" }));
    expect(view.onCursor).toHaveBeenCalled(); expect(confirm).toHaveBeenCalledTimes(1);
    expect(hasRegisteredDraft()).toBe(false);
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Worker" }));
    expect(view.onSelect).toHaveBeenCalledWith("i2"); expect(confirm).toHaveBeenCalledTimes(1);
  } finally { view.unmount(); confirm.mockRestore(); Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth }); }
});
