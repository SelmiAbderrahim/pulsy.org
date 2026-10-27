import { render, screen } from "@testing-library/react";
import { HelmetProvider } from "@dr.pogodin/react-helmet";
import { expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { AppNotFound, PageNotFound } from "./page-not-found";
vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: null }) }));
it("gives missing dashboard routes an explanation and useful destinations even before session readiness", () => {
  history.replaceState({}, "", "/dashboard/missing");
  render(<HelmetProvider><AppNotFound /></HelmetProvider>);
  expect(screen.getByText("notFound.description")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to monitors" })).toHaveAttribute("href", "/dashboard");
  expect(screen.getByRole("link", { name: "notFound.help" })).toHaveAttribute("href", "/dashboard/help");
  history.replaceState({}, "", "/");
});

it("reuses the dashboard empty state for an absent entity without adding another main landmark", () => {
  const { container } = render(<HelmetProvider><main><PageNotFound dashboard /></main></HelmetProvider>);
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Page not found", level: 1 })).toBeInTheDocument();
  expect(screen.getByText("notFound.description")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to monitors" })).toHaveAttribute("href", "/dashboard");
  expect(container.querySelector("svg[aria-hidden=true]")).toBeInTheDocument();
});
