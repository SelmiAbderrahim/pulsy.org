import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { StatusPageMembership } from "./status-page-membership";

vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });
const fixture = vi.hoisted(() => ({ page: { monitorIds: ["http"] }, preview: vi.fn(), apply: vi.fn() }));
vi.mock("@/hooks/uptime", () => ({
  useStatusPage: () => ({ data: fixture.page, isPending: false }),
  useUptimeMonitors: () => ({ data: [{ uptimeMonitorId: "dns", name: "DNS" }, { uptimeMonitorId: "http", name: "HTTP" }], isPending: false }),
}));
vi.mock("@/services/uptime/uptimeService", () => ({ UptimeService: { previewStatusPageMonitors: fixture.preview, setStatusPageMonitors: fixture.apply } }));
beforeEach(() => {
  vi.clearAllMocks(); fixture.page = { monitorIds: ["http"] };
  fixture.preview.mockImplementation(async (_page: string, ids: string[]) => ({
    title: "Public", slug: "public", isPublished: true, revision: "revision", resultingCount: ids.length,
    components: ids.map(id => ({ id, publicName: id.toUpperCase() })),
    added: ids.filter(id => !fixture.page.monitorIds.includes(id)).map(id => ({ id, publicName: id.toUpperCase() })),
    alreadySelected: ids.filter(id => fixture.page.monitorIds.includes(id)).map(id => ({ id, publicName: id.toUpperCase() })), removed: [],
  }));
  fixture.apply.mockImplementation(async (_page: string, ids: string[]) => { fixture.page = { monitorIds: [...ids] }; });
});
function editor(changed = vi.fn(async () => {})) {
  return <QueryClientProvider client={new QueryClient()}><StatusPageMembership pageId="page" changed={changed} /></QueryClientProvider>;
}
function previewNames() { return within(screen.getByRole("button", { name: "statusUX.applyMembership" }).parentElement!).getAllByRole("listitem").map(item => item.textContent); }
async function preview() { fireEvent.click(screen.getByRole("button", { name: "statusUX.previewMembership" })); await screen.findByRole("button", { name: "statusUX.applyMembership" }); }
it("searches/selects a new monitor, previews the submitted order, applies and reloads HTTP then DNS", async () => {
  const changed = vi.fn(async () => {}), mounted = render(editor(changed));
  fireEvent.change(screen.getByLabelText("notificationUX.searchMonitors"), { target: { value: "dns" } });
  expect(screen.queryByText("HTTP")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "DNS" }));
  await preview(); expect(previewNames()).toEqual(["HTTP", "DNS"]);
  expect(fixture.preview).toHaveBeenCalledWith("page", ["http", "dns"]);
  fireEvent.click(screen.getByRole("button", { name: "statusUX.applyMembership" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(fixture.apply).toHaveBeenCalledWith("page", ["http", "dns"], "revision");
  mounted.unmount(); render(editor());
  expect(screen.getAllByRole("checkbox").every(box => box.getAttribute("aria-checked") === "true")).toBe(true);
  // Deselect/reselect the first component: its position moves to the end.
  fireEvent.click(screen.getByRole("checkbox", { name: "HTTP" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "HTTP" }));
  await preview(); expect(previewNames()).toEqual(["DNS", "HTTP"]);
  fireEvent.click(screen.getByRole("button", { name: "statusUX.applyMembership" }));
  await waitFor(() => expect(fixture.apply).toHaveBeenLastCalledWith("page", ["dns", "http"], "revision"));
});

it("uses the shared section heading and dashboard search geometry without losing selection", () => {
  render(editor());
  expect(screen.getByRole("heading", { name: "statusUX.membership" })).toHaveClass("text-base");
  const search = screen.getByRole("searchbox", { name: "notificationUX.searchMonitors" });
  expect(search).toHaveAttribute("placeholder", "notificationUX.searchMonitors");
  expect(search).toHaveClass("ps-9");
  expect(search.parentElement?.querySelector("svg")).toHaveClass("start-3");
  fireEvent.change(search, { target: { value: "DNS" } });
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByRole("checkbox", { name: "HTTP" })).toHaveAttribute("aria-checked", "true");
});
