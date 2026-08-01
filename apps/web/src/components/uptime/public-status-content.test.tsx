import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { PublicStatusPage } from "@/types/uptime";
import { PublicStatusContent } from "./public-status-content";

vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));
// StatusPageSeo renders <Helmet>; stub it so tests need no HelmetProvider while
// the SEO logic (title/description/canonical/JSON-LD) still executes.
vi.mock("@dr.pogodin/react-helmet", () => ({
  Helmet: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

function page(overrides: Partial<PublicStatusPage> = {}): PublicStatusPage {
  return {
    title: null,
    description: null,
    logoUrl: null,
    monitors: [],
    overallStatus: "operational",
    recentIncidents: [],
    ...overrides,
  };
}

describe("PublicStatusContent", () => {
  it("renders the loading spinner", () => {
    const { container } = render(
      <PublicStatusContent data={undefined} isLoading error={null} />,
    );
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("renders the error/unavailable state on error", () => {
    render(
      <PublicStatusContent data={undefined} isLoading={false} error={new Error("x")} />,
    );
    expect(screen.getByText("Status page is unavailable.")).toBeInTheDocument();
  });

  it("renders the custom errorKey when provided", () => {
    render(
      <PublicStatusContent
        data={undefined}
        isLoading={false}
        error={new Error("x")}
        errorKey="statusPage.notFound"
      />,
    );
    // The mock t() returns the default value; key falls through to its default.
    expect(screen.getByText("Status page is unavailable.")).toBeInTheDocument();
  });

  it("renders the default heading and Activity icon without a logo/title", () => {
    render(
      <PublicStatusContent data={page()} isLoading={false} error={null} />,
    );
    expect(screen.getByText("Service Status")).toBeInTheDocument();
    expect(screen.getByText("No public monitors to display.")).toBeInTheDocument();
  });

  it("renders the page title, description, and logo", () => {
    render(
      <PublicStatusContent
        data={page({
          title: "Acme",
          description: "We are up",
          logoUrl: "https://cdn.test/logo.png",
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("We are up")).toBeInTheDocument();
    const img = document.querySelector("img");
    expect(img).toHaveAttribute("src", "https://cdn.test/logo.png");
  });

  it("renders every monitor status badge and metrics", () => {
    render(
      <PublicStatusContent
        data={page({
          overallStatus: "outage",
          monitors: [
            { name: "Web", status: "up", uptimePercentage: 99.95, responseTime: 50, lastCheckedAt: null },
            { name: "Api", status: "down", uptimePercentage: null, responseTime: null, lastCheckedAt: null },
            { name: "Cache", status: "degraded", uptimePercentage: 80, responseTime: 100, lastCheckedAt: null },
            { name: "Queue", status: "pending", uptimePercentage: null, responseTime: null, lastCheckedAt: null },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getByText("Api")).toBeInTheDocument();
    expect(screen.getByText(/99\.95% · 50ms/)).toBeInTheDocument();
    // The mock t() echoes the raw overall status passed as the fallback value.
    expect(screen.getByText("outage")).toBeInTheDocument();
  });

  it("renders degraded overall banner", () => {
    render(
      <PublicStatusContent
        data={page({ overallStatus: "degraded" })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("degraded")).toBeInTheDocument();
  });

  it("falls back gracefully for an unknown overall status", () => {
    render(
      <PublicStatusContent
        data={page({ overallStatus: "unknown" as never })}
        isLoading={false}
        error={null}
      />,
    );
    // Unknown maps to the title fallback label.
    expect(screen.getByText("Service Status")).toBeInTheDocument();
  });

  it("renders ongoing and resolved incidents", () => {
    render(
      <PublicStatusContent
        data={page({
          recentIncidents: [
            { monitorName: "M1", status: "ongoing", startedAt: "2026-06-01T00:00:00.000Z", resolvedAt: null, durationSeconds: null },
            { monitorName: "M2", status: "resolved", startedAt: "2026-06-02T00:00:00.000Z", resolvedAt: "2026-06-02T01:00:00.000Z", durationSeconds: 3600 },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("M1")).toBeInTheDocument();
    expect(screen.getByText("M2")).toBeInTheDocument();
    expect(screen.getByText("Recent Incidents")).toBeInTheDocument();
  });
});
