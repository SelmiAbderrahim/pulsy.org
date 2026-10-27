import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { PublicStatusPage } from "@/types/uptime";
import { PublicStatusContent } from "./public-status-content";

vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));
// Head updates and cleanup are exercised with the real HelmetProvider in
// public-status-metadata.test.tsx; these tests cover the visible content.
vi.mock("@dr.pogodin/react-helmet", () => ({
  Helmet: () => null,
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
  it("renders a neutral accessible loading skeleton", () => {
    const { container } = render(
      <PublicStatusContent data={undefined} isLoading error={null} />,
    );
    expect(screen.getByRole("status", { name: "statusPage.loading" })).toBeInTheDocument();
    expect(container.textContent).not.toContain("Pulsy");
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
    expect(screen.getByText("Service status")).toBeInTheDocument();
    expect(screen.getByText("statusPage.noComponentsPublic")).toBeInTheDocument();
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
    expect(screen.getByText((_, element) => element?.tagName === "P" && /Uptime \(30 days\): 99\.95% · .*50\u00a0ms/.test(element.textContent ?? ""))).toBeInTheDocument();
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

  it("shows the supported unobserved state without an operational label", () => {
    render(<PublicStatusContent data={page({ overallStatus: "unknown" })} isLoading={false} error={null} />);
    expect(screen.getByText("unknown")).toBeInTheDocument();
    expect(screen.queryByText("operational")).not.toBeInTheDocument();
  });

  it("falls back gracefully for an unsupported overall status", () => {
    render(
      <PublicStatusContent
        data={page({ overallStatus: "unsupported" as never })}
        isLoading={false}
        error={null}
      />,
    );
    // Unknown maps to the title fallback label.
    expect(screen.getByText("Service status")).toBeInTheDocument();
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
    expect(screen.getByText("Recent incidents")).toBeInTheDocument();
  });
});

it("retains last loaded observations on refresh failure with timestamps and an explicit retry", () => {
  const retry = vi.fn();
  const { container } = render(<PublicStatusContent data={page({ title: "Public service", overallStatus: "outage", monitors: [{ name: "API", status: "down", uptimePercentage: 0, responseTime: 0, lastCheckedAt: "2026-10-10T12:00:00Z" }] })} isLoading={false} error={new Error("Private upstream detail")} onRetry={retry} />);
  expect(screen.getByText("API")).toBeInTheDocument(); expect(screen.getByText(/0\.00%/)).toBeInTheDocument(); expect(screen.queryByText(/0 ms/)).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("statusUX.stalePublic"); expect(screen.queryByText("Private upstream detail")).not.toBeInTheDocument();
  expect(container.querySelector('time[datetime="2026-10-10T12:00:00Z"]')).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "communication.retry" })); expect(retry).toHaveBeenCalledOnce(); expect(screen.getAllByRole("main")).toHaveLength(1);
});

describe("empty and unobserved pages never imply health", () => {
  it("says the page is awaiting observations exactly once and omits the second empty Monitors card", () => {
    render(<PublicStatusContent data={page({ overallStatus: "unknown", monitors: [] })} isLoading={false} error={null} />);
    expect(screen.getAllByText("unknown")).toHaveLength(1);
    expect(screen.getByText("statusPage.noComponentsPublic")).toBeInTheDocument();
    expect(screen.queryByText("Monitors")).not.toBeInTheDocument();
    expect(screen.queryByText("statusUX.lastObservation")).not.toBeInTheDocument();
  });
  it("downgrades an operational claim that has no component or no recorded observation", () => {
    const { rerender } = render(<PublicStatusContent data={page({ overallStatus: "operational", monitors: [] })} isLoading={false} error={null} />);
    expect(screen.queryByText("operational")).not.toBeInTheDocument(); expect(screen.getByText("unknown")).toBeInTheDocument();
    rerender(<PublicStatusContent data={page({ overallStatus: "operational", monitors: [{ name: "Web", status: "up", uptimePercentage: null, responseTime: null, lastCheckedAt: null }] })} isLoading={false} error={null} />);
    expect(screen.queryByText("operational")).not.toBeInTheDocument();
    rerender(<PublicStatusContent data={page({ overallStatus: "operational", monitors: [{ name: "Web", status: "up", uptimePercentage: 100, responseTime: 20, lastCheckedAt: "2026-10-12T08:00:00.000Z" }] })} isLoading={false} error={null} />);
    expect(screen.getByText("operational")).toBeInTheDocument();
  });
  it("puts a published update ahead of the component list on a populated page", () => {
    const data = page({ overallStatus: "degraded", monitors: [{ name: "Web", componentId: "c1", status: "degraded", uptimePercentage: 99, responseTime: 20, lastCheckedAt: "2026-10-12T08:00:00.000Z" }], announcements: [{ id: "a1", title: "Investigating slow checkout", text: "We are looking into it.", stage: "investigating", kind: "incident", timezone: "UTC", publishedAt: "2026-10-12T08:05:00.000Z", componentIds: ["c1"] }] as never, publicKey: "key" });
    render(<PublicStatusContent data={data} isLoading={false} error={null} />);
    const update = screen.getByText("Investigating slow checkout"), component = screen.getAllByText("Monitors")[0]!;
    expect(component).toHaveClass("sr-only");
    expect(update.compareDocumentPosition(component) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});


it("shows neutral empty-page copy and the server snapshot timestamp in a restrained footer", () => {
  const { container } = render(<PublicStatusContent data={page({ monitors: [], asOf: "2026-10-14T12:00:00Z" })} isLoading={false} error={null} />);
  expect(screen.getByText("statusPage.noComponentsPublic")).toBeInTheDocument();
  expect(container.querySelector('footer time')).toHaveAttribute("datetime", "2026-10-14T12:00:00Z");
  expect(screen.queryByText("No monitors configured")).not.toBeInTheDocument();
});

describe("availability and overall status (QA-017)", () => {
  it("reports 100 checks of which 60 were slow as 100% uptime plus 60% slow responses, never 0%", () => {
    const { container } = render(
      <PublicStatusContent
        data={page({ overallStatus: "degraded", monitors: [{ name: "Slow API", status: "degraded", uptimePercentage: 100, slowPercentage: 60, responseTime: 900, lastCheckedAt: null }] })}
        isLoading={false}
        error={null}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/100\.00%/);
    expect(text).toMatch(/60\.00%/);
    expect(text).not.toMatch(/(^|[^\d.])0(\.0+)?%/);
  });

  it("omits the slow-response line when no check was slow", () => {
    const { container } = render(
      <PublicStatusContent
        data={page({ monitors: [{ name: "API", status: "up", uptimePercentage: 99.5, slowPercentage: 0, responseTime: 40, lastCheckedAt: null }] })}
        isLoading={false}
        error={null}
      />,
    );
    expect(container.textContent).not.toContain("Slow responses");
  });

  it("names a partial outage with its own label rather than the raw status or Major outage", () => {
    render(<PublicStatusContent data={page({ overallStatus: "partial" })} isLoading={false} error={null} />);
    expect(screen.getByText("partial")).toBeInTheDocument();
    expect(screen.queryByText("outage")).not.toBeInTheDocument();
  });

  it("names a major outage when every component is down", () => {
    render(<PublicStatusContent data={page({ overallStatus: "outage" })} isLoading={false} error={null} />);
    expect(screen.getByText("outage")).toBeInTheDocument();
    expect(screen.queryByText("partial")).not.toBeInTheDocument();
  });
});
