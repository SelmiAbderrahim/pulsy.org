import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { StatusSubscriptionSettings } from "./status-subscription-settings";
const mocks = vi.hoisted(() => ({ read: vi.fn(), configure: vi.fn(), providers: vi.fn() }));
vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner-fixture" } } }) }));
vi.mock("@/services/uptime/statusCommunicationService", () => ({ StatusCommunicationService: { subscriptions: mocks.read, subscriptionsConfigure: mocks.configure } }));
vi.mock("@/services/uptime/uptimeService", () => ({ UptimeService: { listEmailProviders: mocks.providers } }));
describe("explicit provider-backed subscription settings", () => {
  it("shows safe counts/readiness and requires explicit confirmation before enabling an owned provider", async () => {
    mocks.read.mockResolvedValue({ enabled: false, ready: false, providerId: null, messagesPerMinute: 30, confirmed: 2, pending: 1, queued: 0, delivered: 0, failures: [] });
    mocks.providers.mockResolvedValue([{ emailProviderId: "verified", name: "Ready provider", verified: true }, { emailProviderId: "not-ready", name: "Unverified", verified: false }]); mocks.configure.mockResolvedValue({});
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><StatusSubscriptionSettings pageId="page-fixture" /></QueryClientProvider>);
    await screen.findByText("subscriptions.notReady");
    const user = userEvent.setup(); await user.click(screen.getByLabelText("subscriptions.enable"));
    await user.click(screen.getByRole("combobox", { name: "subscriptions.provider" }));
    await user.click(await screen.findByRole("option", { name: "Ready provider" }));
    expect(screen.queryByRole("option", { name: "Unverified" })).toBeNull();
    expect(screen.getByRole("button", { name: "subscriptions.save" })).toBeDisabled(); expect(mocks.configure).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("subscriptions.confirmChange")); await user.click(screen.getByRole("button", { name: "subscriptions.save" }));
    await waitFor(() => expect(mocks.configure).toHaveBeenCalledWith({ statusPageId: "page-fixture", enabled: true, providerId: "verified", messagesPerMinute: 30, confirmChange: true }));
  });
});
describe("why saving is unavailable", () => {
  it("names the missing prerequisite instead of leaving the button silently disabled, and points to providers when none is verified", async () => {
    mocks.read.mockResolvedValue({ enabled: false, ready: false, providerId: null, messagesPerMinute: 30, confirmed: 0, pending: 0, queued: 0, delivered: 0, failures: [] });
    mocks.providers.mockResolvedValue([{ emailProviderId: "untested", name: "Untested", verified: false }]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><StatusSubscriptionSettings pageId="page-fixture" /></QueryClientProvider>);
    await screen.findByText("subscriptions.notReady");
    expect(screen.getByText("subscriptions.noVerifiedProvider", { exact: false })).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "subscriptions.save" });
    expect(save).toBeDisabled(); expect(screen.getByText("subscriptions.blockedConfirm")).toBeInTheDocument();
    const user = userEvent.setup(); await user.click(screen.getByLabelText("subscriptions.enable")); await user.click(screen.getByLabelText("subscriptions.confirmChange"));
    expect(screen.getByText("subscriptions.blockedProvider")).toBeInTheDocument(); expect(save.getAttribute("aria-describedby")).toBe("status-subscription-blocked");
  });
});

it.each([true, false])("only lists missing prerequisites for a published=%s page", async published => {
  mocks.read.mockResolvedValue({ enabled: true, ready: false, providerReady: false, providerId: "invalid", messagesPerMinute: 30, confirmed: 0, pending: 0, queued: 0, delivered: 0, failures: [] });
  mocks.providers.mockResolvedValue([]);
  render(<QueryClientProvider client={new QueryClient()}><StatusSubscriptionSettings pageId="page" published={published} /></QueryClientProvider>);
  expect(await screen.findByText("subscriptions.needsProvider")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "statusUX.configureProviders" })).toHaveLength(1);
  expect(Boolean(screen.queryByText("subscriptions.needsPublication"))).toBe(!published);
});
it("hides fulfilled publishing and usable-provider prerequisites", async () => {
  mocks.read.mockResolvedValue({ enabled: true, ready: true, providerReady: true, providerId: "verified", messagesPerMinute: 30, confirmed: 0, pending: 0, queued: 0, delivered: 0, failures: [] });
  mocks.providers.mockResolvedValue([{ emailProviderId: "verified", name: "Verified", verified: true }]);
  render(<QueryClientProvider client={new QueryClient()}><StatusSubscriptionSettings pageId="page" published /></QueryClientProvider>);
  await screen.findByText("subscriptions.ready");
  expect(screen.queryByText("subscriptions.needsPublication")).not.toBeInTheDocument();
  expect(screen.queryByText("subscriptions.needsProvider")).not.toBeInTheDocument();
});


it("groups both decisions with described helpers and preserves keyboard delivery-rate editing", async () => {
  mocks.read.mockResolvedValue({ enabled: false, ready: true, providerReady: true, providerId: "verified", messagesPerMinute: 30, confirmed: 0, pending: 0, queued: 0, delivered: 0, failures: [] });
  mocks.providers.mockResolvedValue([{ emailProviderId: "verified", name: "Verified", verified: true }]);
  mocks.configure.mockResolvedValue({});
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><StatusSubscriptionSettings pageId="page" /></QueryClientProvider>);
  const group = await screen.findByRole("group", {name:"subscriptions.controlsLegend"});
  const decisions = within(group).getAllByRole("checkbox");
  expect(decisions).toHaveLength(2);
  expect(decisions[0]).toHaveAccessibleDescription("subscriptions.enableHelp");
  expect(decisions[1]).toHaveAccessibleDescription("subscriptions.confirmChangeHelp");
  const disclosure = screen.getByRole("button", {name:"statusUX.advancedDelivery"});
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  disclosure.focus();
  const user = userEvent.setup(); await user.keyboard("{Enter}");
  expect(disclosure).toHaveAttribute("aria-expanded", "true");
  const rate = screen.getByRole("spinbutton", {name:"subscriptions.rate"});
  await user.clear(rate); await user.type(rate,"20");
  await user.click(decisions[1]!);
  await user.click(screen.getByRole("button",{name:"subscriptions.save"}));
  await waitFor(()=>expect(mocks.configure).toHaveBeenCalledWith({statusPageId:"page",enabled:false,providerId:"verified",messagesPerMinute:20,confirmChange:true}));
});

it("links to provider selection when a verified provider exists without repeating configuration", async () => {
  mocks.read.mockResolvedValue({ enabled: false, ready: false, providerReady: false, providerId: null, messagesPerMinute: 30, confirmed: 0, pending: 0, queued: 0, delivered: 0, failures: [] });
  mocks.providers.mockResolvedValue([{ emailProviderId: "verified", name: "Verified", verified: true }]);
  render(<QueryClientProvider client={new QueryClient()}><StatusSubscriptionSettings pageId="page" published /></QueryClientProvider>);
  expect(await screen.findByRole("link", { name: "subscriptions.chooseProvider" })).toHaveAttribute("href", "#status-subscription-provider");
  expect(screen.queryByRole("link", { name: "statusUX.configureProviders" })).not.toBeInTheDocument();
});
