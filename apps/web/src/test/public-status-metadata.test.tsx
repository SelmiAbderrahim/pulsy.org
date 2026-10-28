import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { Helmet, HelmetProvider } from "@dr.pogodin/react-helmet";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { reactI18nextMock } from "./i18n-mock";
import { Route as LegacyRoute } from "../routes/status.$userId";
import { Route as NamedRoute } from "../routes/status.$userId.$slug";
import type { PublicStatusPage } from "@/types/uptime";

const { named, legacy } = vi.hoisted(() => ({ named: vi.fn(), legacy: vi.fn() }));
vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/services/uptime/uptimeService", () => ({ UptimeService: { getStatusPageBySlug: named, getPublicStatus: legacy } }));
function page(title: string): PublicStatusPage {
  return { title, description: "Public description", logoUrl: null, overallStatus: "unknown", monitors: [{ name: '<img src=x onerror="alert(1)">', status: "pending", uptimePercentage: null, responseTime: null, lastCheckedAt: null }], recentIncidents: [] };
}
const missing = { data: { code: "NOT_FOUND", httpStatus: 404 }, message: "Private upstream detail" };
function setup(path = "/status/owner/first") {
  const root = createRootRoute({ component: () => <><Helmet defer={false}><title>Pulsy</title><meta property="og:title" content="Pulsy" /></Helmet><Outlet /></> });
  const parent = createRoute({ getParentRoute: () => root, path: "status/$userId", component: LegacyRoute.options.component });
  const child = createRoute({ getParentRoute: () => parent, path: "$slug", component: NamedRoute.options.component });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: () => <main>Home</main> });
  const router = createRouter({ routeTree: root.addChildren([parent.addChildren([child]), home]), history: createMemoryHistory({ initialEntries: [path] }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<HelmetProvider><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></HelmetProvider>);
  return { router, client };
}
function expectMetadata(title: string) {
  expect(document.title).toBe(title);
  expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
  expect(document.head.querySelector('meta[property="og:title"]')).toHaveAttribute("content", title);
}
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());
it("updates page-specific titles across navigation/loading and resets metadata on leaving", async () => {
  const title = '</title><script>alert("page")</script> & Public';
  let resolveNext!: (page: PublicStatusPage) => void;
  named.mockImplementation(async (_owner: string, slug: string) => slug === "first" ? page(title) : new Promise<PublicStatusPage>(resolve => { resolveNext = resolve; }));
  const { router } = setup();
  await screen.findByRole("heading", { name: title });
  await waitFor(() => expectMetadata(`${title} — Status`));
  expect(document.querySelector("main img")).toBeNull();
  const jsonLd = document.head.querySelector('script[type="application/ld+json"]')!;
  expect(jsonLd.textContent).not.toContain("</");
  expect(JSON.parse(jsonLd.textContent!).name).toBe(title);
	  await act(async () => { await router.navigate({ to: "/status/$userId/$slug", params: { userId: "owner", slug: "second" } }); });
  await waitFor(() => expectMetadata("Status page"));
  expect(document.head.querySelector('meta[name="description"]')).toBeNull();
  expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();
  await act(async () => { resolveNext(page("Second public page")); });
  await screen.findByRole("heading", { name: "Second public page" });
  await waitFor(() => expectMetadata("Second public page — Status"));
  await act(async () => { await router.navigate({ to: "/" }); });
  await screen.findByText("Home");
  await waitFor(() => expectMetadata("Pulsy"));
  expect(document.head.querySelector('meta[name="description"]')).toBeNull();
  expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
});
it.each(["draft", "nonexistent"])("uses neutral metadata for %s with no Retry or default-page disclosure", async slug => {
  named.mockRejectedValue(missing);
  setup(`/status/owner/${slug}`);
  await screen.findByText("Status page is unavailable.");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Status page");
  expect(screen.queryByRole("button", { name: "communication.retry" })).not.toBeInTheDocument();
  expect(screen.queryByText("Private upstream detail")).not.toBeInTheDocument();
  await waitFor(() => expectMetadata("Status page"));
  expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  expect(document.head.querySelector('meta[name="description"]')).toBeNull();
  expect(legacy).not.toHaveBeenCalled();
});
it("retains transient retry behavior, but clears cached identity and content when a page becomes private", async () => {
  named.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce(page("Live public title")).mockRejectedValueOnce({ data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } }).mockRejectedValueOnce(missing);
  const { client } = setup();
  await screen.findByText("Status page is unavailable.");
  const retry = await screen.findByRole("button", { name: "communication.retry" });
  expectMetadata("Status page");
  await act(async () => { retry.click(); });
  await screen.findByRole("heading", { name: "Live public title" });
	  await waitFor(() => expectMetadata("Live public title — Status"));
	  await act(async () => { await client.refetchQueries({ type: "active" }); });
	  expectMetadata("Live public title — Status");
	  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("statusUX.stalePublic"));
  expect(screen.getByRole("button", { name: "communication.retry" })).toBeInTheDocument();
  await act(async () => { await client.refetchQueries({ type: "active" }); });
  await waitFor(() => expectMetadata("Status page"));
  expect(screen.queryByText("Live public title")).not.toBeInTheDocument();
  expect(document.head.innerHTML).not.toContain("Live public title");
  expect(screen.queryByRole("button", { name: "communication.retry" })).not.toBeInTheDocument();
});
