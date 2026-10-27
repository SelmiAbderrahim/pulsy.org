import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicHistory } from "./public-history";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
vi.mock("@/lib/api/trpc", () => ({ SERVER_URL: "" }));
afterEach(() => vi.unstubAllGlobals());
describe("public lazy history", () => {
  it("does not request or mount history until explicitly expanded, and loads all components in one request", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 1, from: "2026-10-02T00:00:00.000Z", to: "2026-10-09T00:00:00.000Z", asOf: "2026-10-10T00:00:00.000Z", components: [{ componentId: "one", timingKind: "connection", days: [{ date: "2026-10-09", raw: { availabilityPercent: null, coveragePercent: 0 }, maintenanceAdjusted: null, averageTimingMs: null }] }] }) });
    vi.stubGlobal("fetch", fetcher); render(<PublicHistory publicKey="page" components={[{ componentId: "one", name: "Customer" }]} />);
    expect(fetcher).not.toHaveBeenCalled(); expect(screen.queryByRole("table")).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "reliability.publicTitle" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); await screen.findByText("Customer");
    expect(screen.queryByRole("table")).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "Customer" }));
    expect(await screen.findByRole("table")).toBeInTheDocument(); expect(screen.getAllByText("reliability.unknown").length).toBeGreaterThan(0);
  });
  it("handles disabled or unpublished history without presenting a healthy placeholder", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 })); render(<PublicHistory publicKey="missing" components={[]} />); fireEvent.click(screen.getByRole("button", { name: "reliability.publicTitle" }));
    await screen.findByRole("alert"); expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

it("renders history for an uncapped page with more than one hundred components", async () => {
  const components = Array.from({ length: 101 }, (_, index) => ({ componentId: `component-${index}`, name: `Public component ${index}` }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 1, from: "2026-10-02T00:00:00.000Z", to: "2026-10-09T00:00:00.000Z", asOf: "2026-10-10T00:00:00.000Z", components: components.map(component => ({ componentId: component.componentId, timingKind: "none", days: [] })) }) }));
  render(<PublicHistory publicKey="large-page" components={components} />);
  fireEvent.click(screen.getByRole("button", { name: "reliability.publicTitle" }));
  expect(await screen.findByRole("button", { name: "Public component 100" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
