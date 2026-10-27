import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { reactI18nextMock, translate } from "@/test/i18n-mock";
import { createWrapper } from "@/test/query-wrapper";
import { Route } from "./_app";
import { retireSessionClient } from "@/lib/session-query-client";
import { carrySearch } from "@/lib/uptime/dashboard-search";

const state = vi.hoisted(() => ({
  loadResources: vi.fn(), loadLanguages: vi.fn(), changeLanguage: vi.fn(), signOut: vi.fn(), retry: vi.fn(), listeners: new Set<() => void>(),
  auth: { data: { user: { id: "owner", name: "Owner" } } as { user: { id: string; name: string } } | null, isPending: false, error: null as { status: number } | null },
}));
vi.mock("react-i18next", () => ({ ...reactI18nextMock(), useTranslation: () => ({ t: translate, i18n: { language: "en", resolvedLanguage: "en", loadLanguages: state.loadLanguages, loadResources: state.loadResources, changeLanguage: state.changeLanguage } }) }));
vi.mock("@tanstack/react-router", async original => { const actual = await original<typeof import("@tanstack/react-router")>(); return { ...actual, createFileRoute: () => (options: object) => ({ options }) }; });
vi.mock("@/i18n", () => ({ SUPPORTED_LANGUAGES: ["en", "ar", "fr", "de", "es"] }));
vi.mock("@/lib/auth-client", async () => {
  const { useSyncExternalStore } = await import("react");
  return { authClient: { signOut: state.signOut }, useSession: () => ({ ...useSyncExternalStore(listener => { state.listeners.add(listener); return () => state.listeners.delete(listener); }, () => state.auth), refetch: state.retry }) };
});
vi.mock("@/hooks/useConfig", () => ({ useConfig: () => ({ data: { timezone: "UTC", requireEmailVerification: false }, isPending: false }) }));
vi.mock("@/components/uptime/global-search-dialog", () => ({ GlobalSearchDialog: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="Global search" /> : null }));
vi.mock("@/components/auth/verify-email-banner", () => ({ VerifyEmailBanner: () => null }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/preferences-dialog", () => ({ PreferencesDialog: ({ onLanguageChange, onOpenChange }: { onLanguageChange: (value: "fr") => Promise<void>; onOpenChange: (value: boolean) => void }) => <div role="dialog" aria-label="nav.preferences"><button onClick={async () => { await onLanguageChange("fr"); onOpenChange(false); }}>Save French</button></div> }));

beforeEach(() => {
  vi.clearAllMocks(); state.listeners.clear();
  state.auth = { data: { user: { id: "owner", name: "Owner" } }, isPending: false, error: null };
  state.loadLanguages.mockImplementation((_language, callback) => { callback?.(); return Promise.resolve(); }); state.loadResources.mockImplementation(callback => callback()); state.changeLanguage.mockResolvedValue(undefined); state.signOut.mockResolvedValue({ error: null });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
function shell(url = "/dashboard") {
  const root = createRootRoute({ component: Outlet });
  const app = createRoute({ getParentRoute: () => root, id: "app", component: Route.options.component });
  const dashboard = createRoute({ getParentRoute: () => app, path: "/dashboard", validateSearch: carrySearch, component: () => <h1>Monitors</h1> });
  const login = createRoute({ getParentRoute: () => root, path: "/login", validateSearch: (search: Record<string, unknown>) => search, component: () => <h1>Sign in</h1> });
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([dashboard]), login]), history: createMemoryHistory({ initialEntries: [url] }) });
  const { Wrapper, client } = createWrapper(); return { router, client, ...render(<RouterProvider router={router} />, { wrapper: Wrapper }) };
}

it("groups navigation with pinned account actions and reserves the OSS source-offer space", async () => {
  const { container } = shell();
  const nav = await screen.findByRole("navigation", { name: "nav.navigation" });
  for (const item of within(nav).getAllByRole("link")) expect(item).toHaveClass("gap-3", "px-3", "text-start");
  const footer = nav.querySelector<HTMLElement>("[data-sidebar-footer]")!;
  expect(footer).toContainElement(within(nav).getByRole("button", { name: "nav.signOut" }));
  expect(nav.querySelector("[data-sidebar-scroll]")).not.toContainElement(footer);
  expect(within(nav).queryByRole("link", { name: "nav.home" })).toBeNull();
  expect(container.querySelector("aside")).toHaveClass("bottom-[45px]");
  expect(screen.getByRole("link", { name: "nav.skip" })).toHaveAttribute("href", "#app-main");
});

it.each(["/dashboard?q=API", "/dashboard?q=API&lng=ar#metrics"])("saves preferences without dropping URL state: %s", async url => {
  const { router } = shell(url);
  await userEvent.click(await screen.findByRole("button", { name: "preferences.accountMenu" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "nav.preferences" }));
  await userEvent.click(screen.getByRole("button", { name: "Save French" }));
  await waitFor(() => expect(router.state.location.search).toMatchObject({ q: "API", lng: "fr" }));
  expect(router.state.location.hash).toBe(url.includes("#") ? "metrics" : "");
});

it("keeps mobile account links collapsed and sign-out in the account menu", async () => {
  shell(); await userEvent.click(await screen.findByRole("button", { name: "nav.openMenu" }));
  const drawer = screen.getByRole("dialog", { name: "nav.navigation" });
  const account = within(drawer).getByRole("button", { name: "nav.accountGroup" });
  expect(account).toHaveAttribute("aria-expanded", "false");
  expect(within(drawer).queryByRole("link", { name: "nav.help" })).toBeNull();
  account.focus(); await userEvent.keyboard("{Enter}");
  expect(within(drawer).getByRole("link", { name: "nav.help" })).toHaveAttribute("href", "/dashboard/help");
  await userEvent.click(within(drawer).getByRole("button", { name: "preferences.accountMenu" }));
  expect(screen.getByRole("menuitem", { name: "nav.signOut" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "nav.home" })).toBeNull();
  await userEvent.keyboard("{Escape}{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "nav.navigation" })).toBeNull());
});

it.each([401, 403])("returns to sign-in on terminal %i despite stale auth data", async status => {
  const { router } = shell("/dashboard?q=kept"); await screen.findByRole("heading", { name: "Monitors" });
  const navigation = vi.spyOn(router, "navigate");
  await act(async () => { state.auth = { ...state.auth, error: { status } }; state.listeners.forEach(listener => listener()); });
  await screen.findByRole("heading", { name: "Sign in" });
  expect(router.state.location.search).toMatchObject({ reason: "session", returnTo: "/dashboard?q=kept" });
  expect(navigation).toHaveBeenCalledOnce();
});

it("retains the resolved session during a temporary outage and exposes retry", async () => {
  const { router } = shell(); await screen.findByRole("heading", { name: "Monitors" });
  await act(async () => { state.auth = { ...state.auth, data: null, error: { status: 503 } }; state.listeners.forEach(listener => listener()); });
  expect(router.state.location.pathname).toBe("/dashboard");
  expect(screen.getByRole("alert")).toHaveTextContent("session.retryDescription");
  await userEvent.click(screen.getByRole("button", { name: "actions.retry" }));
  expect(state.retry).toHaveBeenCalledOnce();
});


it("does not commit a pending language load after its owner session retires", async () => {
  let release!: () => void;
  state.loadLanguages.mockImplementation((_language, callback) => new Promise<void>(resolve => { release = () => { callback?.(); resolve(); }; }));
  const { client, router } = shell("/dashboard?q=kept");
  await userEvent.click(await screen.findByRole("button", { name: "preferences.accountMenu" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "nav.preferences" }));
  await userEvent.click(screen.getByRole("button", { name: "Save French" }));
  expect(state.loadLanguages).toHaveBeenCalledWith("fr", expect.any(Function));
  retireSessionClient(client);
  await act(async () => release());
  expect(state.changeLanguage).not.toHaveBeenCalled();
  expect(router.state.location.search).toEqual({ q: "kept" });
});
