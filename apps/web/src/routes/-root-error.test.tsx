import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { HelmetProvider } from "@dr.pogodin/react-helmet";
import { afterEach, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { Route } from "./__root";

vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/components/source-code-offer", () => ({ SourceCodeOffer: () => <footer data-testid="source-offer">Source</footer> }));
vi.mock("@/components/ui/confirmation-host", () => ({ ConfirmationHost: () => <div data-testid="confirmations" /> }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => <div data-testid="toasts" /> }));
afterEach(() => { vi.restoreAllMocks(); document.documentElement.removeAttribute("data-locale-pending"); });

it("keeps one source offer and shared overlay host in the safe root error UI, then retries", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  let failing = true;
  const root = createRootRoute({ component: Route.options.component, errorComponent: Route.options.errorComponent });
  const page = createRoute({ getParentRoute: () => root, path: "/dashboard", component: () => {
    if (failing) throw new Error("private implementation details");
    return <h1>Recovered page</h1>;
  } });
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: ["/dashboard"] }) });
  document.documentElement.dataset.localePending = "";
  render(<HelmetProvider><RouterProvider router={router} /></HelmetProvider>);
  expect(await screen.findByRole("heading", { name: "states.error" })).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("private implementation details");
  expect(document.documentElement).not.toHaveAttribute("data-locale-pending");
  expect(screen.getAllByTestId("source-offer")).toHaveLength(1);
  expect(screen.getAllByTestId("confirmations")).toHaveLength(1);
  expect(screen.getAllByTestId("toasts")).toHaveLength(1);
  failing = false;
  fireEvent.click(screen.getByRole("button", { name: "actions.retry" }));
  expect(await screen.findByRole("heading", { name: "Recovered page" })).toBeInTheDocument();
  expect(screen.getAllByTestId("source-offer")).toHaveLength(1);
});
