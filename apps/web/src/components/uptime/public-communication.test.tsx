import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { PublicStatusContent } from "./public-status-content";
vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@dr.pogodin/react-helmet", () => ({ Helmet: ({ children }: { children?: ReactNode }) => <>{children}</> }));
const monitor = (componentId: string, group: string) => ({ componentId, group, maintenance: componentId === "component-a", description: "Public description", name: "API", status: "down" as const, uptimePercentage: null, responseTime: null, lastCheckedAt: null });
const update = { id: "public-update", previousId: null, title: "Working on the outage", text: "<img src=x onerror=alert(1)>\nNext update soon", stage: "resolved" as const, componentIds: ["component-a"], timezone: "Europe/Berlin", kind: "incident" as const, startsAt: null, endsAt: null, publishedAt: "2026-10-10T12:00:00.000Z" };
const page = { title: "Customer status", description: null, logoUrl: null, publicKey: "page-public", overallStatus: "outage" as const, monitors: [monitor("component-a", "Production"), monitor("component-b", "Staging"), monitor("component-c", "Production")], recentIncidents: [], announcements: [update] };
describe("published status communication", () => {
  it("groups exact components in first-occurrence order with counts and safe descriptions", () => {
    render(<PublicStatusContent data={page} isLoading={false} error={null} />);
    const groups = within(screen.getByRole("region", { name: "Monitors" })).getAllByRole("region");
    expect(groups.map(group => within(group).getByRole("heading").textContent)).toEqual(["Production", "Staging"]);
    expect(within(groups[0]!).getAllByText("API")).toHaveLength(2);
    expect(within(groups[0]!).getByText("2 components")).toBeInTheDocument();
    expect(screen.getAllByText("Public description")).toHaveLength(3);
  });
  it("keeps a resolved announcement separate from down health and escapes authored HTML", () => {
    render(<PublicStatusContent data={page} isLoading={false} error={null} />);
    expect(screen.getAllByText("Down")).toHaveLength(3);
    expect(screen.getByText("Maintenance")).toBeInTheDocument();
    const article = screen.getByRole("article");
    expect(within(article).getByText("Working on the outage")).toBeInTheDocument();
    expect(within(article).getByText("Resolved")).toBeInTheDocument();
    expect(article.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(article.querySelector("img")).toBeNull();
    expect(within(article).getByText(/Europe\/Berlin/)).toBeInTheDocument();
    expect(article).toHaveAttribute("id", "announcement-public-update");
    expect(screen.getByRole("link", { name: "RSS feed" })).toHaveAttribute("href", "/api/status/pages/page-public/feed.rss");
    expect(screen.getByRole("link", { name: "Atom feed" })).toHaveAttribute("href", "/api/status/pages/page-public/feed.atom");
  });
});
