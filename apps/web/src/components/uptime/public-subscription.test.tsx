import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { PublicSubscription } from "./public-subscription";
import { PublicStatusContent } from "./public-status-content";
import { captureSubscriptionCapability, clearSubscriptionCapability } from "@/lib/uptime/public-subscription-capability";
const mocks = vi.hoisted(() => ({ request: vi.fn(), redeem: vi.fn() }));
vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@dr.pogodin/react-helmet", () => ({ Helmet: ({ children }: { children?: ReactNode }) => <>{children}</> }));
vi.mock("@/services/uptime/publicSubscriptionService", () => ({ PublicSubscriptionService: mocks }));
afterEach(() => { clearSubscriptionCapability(); window.history.replaceState({}, "", "/"); vi.clearAllMocks(); });
const data = { publicKey: "page-fixture", emailSubscriptionsEnabled: true, title: "Public page", description: null, logoUrl: null, overallStatus: "unknown" as const, recentIncidents: [], monitors: [{ componentId: "component-fixture", name: "Public API", status: "pending" as const, uptimePercentage: null, responseTime: null, lastCheckedAt: null }] };
describe("deliberate public subscription actions", () => {
  it("requires explicit opt-in and exact selected components, then clears the email", async () => {
    mocks.request.mockResolvedValue(undefined); render(<PublicSubscription data={data} />); const user = userEvent.setup();
    await user.click(screen.getByText("subscriptions.subscribe")); await user.type(screen.getByLabelText("subscriptions.email"), "person@fixtures.invalid");
    await user.click(screen.getByRole("combobox", { name: "subscriptions.scope" }));
    await user.click(await screen.findByRole("option", { name: "subscriptions.selected" }));
    expect(screen.getByRole("button", { name: "subscriptions.request" })).toBeDisabled();
    await user.click(screen.getByLabelText("Public API")); expect(mocks.request).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "subscriptions.request" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("page-fixture", { email: "person@fixtures.invalid", componentIds: ["component-fixture"], language: "en" }));
    expect(screen.getByLabelText("subscriptions.email")).toHaveValue("");
  });
  it("allows explicit capability unsubscribe after a page is unpublished without displaying the token", async () => {
    const token = "z".repeat(43); window.history.replaceState({}, "", `/status/owner/page#subscription=unsubscribe%3A${token}%3Apage-fixture`); captureSubscriptionCapability();
    mocks.redeem.mockResolvedValue(undefined); const { container } = render(<PublicStatusContent data={undefined} isLoading={false} error={new Error("unpublished")} />);
    expect(container.textContent).not.toContain(token); expect(window.location.hash).toBe(""); expect(mocks.redeem).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "subscriptions.unsubscribeAction" }));
    await waitFor(() => expect(mocks.redeem).toHaveBeenCalledWith("page-fixture", expect.objectContaining({ action: "unsubscribe", token })));
    expect(screen.getByRole("status")).toHaveTextContent("subscriptions.linkProcessed");
  });
});

it("preserves a newly captured link when an older redemption completes", async () => {
  const { act } = await import("@testing-library/react");
  const { readSubscriptionCapability } = await import("@/lib/uptime/public-subscription-capability");
  const first = "a".repeat(43), next = "b".repeat(43);
  window.history.replaceState({}, "", `/status/owner/page#subscription=confirm%3A${first}%3Apage-fixture`);
  captureSubscriptionCapability();
  let finish!: () => void;
  mocks.redeem.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<PublicSubscription data={data} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "subscriptions.confirmAction" }));
  await act(async () => {
    window.history.replaceState({}, "", `/status/owner/page#subscription=unsubscribe%3A${next}%3Apage-fixture`);
    captureSubscriptionCapability();
    finish();
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "subscriptions.unsubscribeAction" })).toBeEnabled());
  expect(readSubscriptionCapability()).toEqual(expect.objectContaining({ action: "unsubscribe", token: next }));
  expect(screen.queryByText("subscriptions.linkProcessed")).not.toBeInTheDocument();
});

it("redeems an old email link against its immutable page key after a slug is reused", async () => {
  const token = "c".repeat(43);
  window.history.replaceState({}, "", `/status/owner/reused#subscription=unsubscribe%3A${token}%3Aoriginal-page`);
  captureSubscriptionCapability();
  mocks.redeem.mockResolvedValue(undefined);
  render(<PublicSubscription data={{ ...data, publicKey: "replacement-page" }} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "subscriptions.unsubscribeAction" }));
  expect(mocks.redeem).toHaveBeenCalledWith("original-page", expect.objectContaining({ action: "unsubscribe", token }));
});
