import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PageBreadcrumb } from "./page-breadcrumb";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: () => "Breadcrumb" }) }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
it("names the section root and exposes the current page once", () => {
  render(<PageBreadcrumb section="Monitors" to="/dashboard" current="Production API" />);
  expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Monitors" })).toHaveAttribute("href", "/dashboard");
  expect(screen.getByText("Production API").closest("[aria-current]")).toHaveAttribute("aria-current", "page");
  expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
});
