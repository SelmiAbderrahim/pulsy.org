import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReliabilityPanel } from "./reliability-panel";
const timezone = vi.hoisted(() => ({ value: "UTC" }));
vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => timezone.value }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), configure: vi.fn(), annotate: vi.fn(), annotations: vi.fn(), policies: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/services/uptime/reliabilityService", () => ({ ReliabilityService: mocks }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owned" } } }) }));
vi.mock("@/components/ui/docs-help-link", () => ({ DocsHelpLink: () => <a href="/docs/reliability">Help</a> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }), useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({ data: queryKey.includes("annotations") ? { data: [], nextCursor: null } : queryKey.includes("policies") ? { data: [], nextVersion: null } : { monitorType: "heartbeat", from: "2026-10-09T00:00:00.000Z", to: "2026-10-10T00:00:00.000Z", asOf: "2026-10-10T00:00:00.000Z", raw: { availabilityPercent: null, coveragePercent: 0, unknownMs: 86400000, observedMs: 0, consumedDowntimeMs: 2092125, allowedDowntimeMs: null, remainingBudgetMs: null, latencyPercent: null }, maintenanceAdjusted: null, checkSuccessPercent: null, policy: null, series: [], checks: 0 }, isPending: false, error: null, refetch: mocks.read }) }));
beforeEach(() => { vi.clearAllMocks(); timezone.value = "UTC"; });
describe("reliability history controls", () => {
  it.each([["UTC", "2026-07-01T12:34:00.000Z"], ["Europe/Berlin", "2026-07-01T10:34:00.000Z"]])("submits marker wall time in account zone %s", async (zone, instant) => {
    timezone.value = zone;
    render(<ReliabilityPanel monitorId="one" />);
    fireEvent.click(screen.getByRole("button", { name: "reliability.addAnnotation" }));
    fireEvent.change(screen.getByLabelText("reliability.at"), { target: { value: "2026-07-01T12:34" } });
    fireEvent.change(screen.getByLabelText("reliability.annotationText"), { target: { value: "Account timezone marker" } });
    fireEvent.click(screen.getAllByRole("button", { name: "reliability.addAnnotation" }).find(button => button.getAttribute("type") === "submit")!);
    await waitFor(() => expect(mocks.annotate).toHaveBeenCalledWith("one", expect.objectContaining({ at: instant })));
  });
  it.each(["2026-03-29T02:30", "2026-10-25T02:30"])("blocks invalid custom and marker wall time %s at the relevant field", async local => {
    timezone.value = "Europe/Berlin";
    render(<ReliabilityPanel monitorId="one" />);
    fireEvent.click(screen.getByRole("button", { name: "reliability.custom" }));
    const from = screen.getByLabelText("reliability.from");
    fireEvent.change(from, { target: { value: local } });
    fireEvent.click(screen.getByRole("button", { name: "reliability.applyWindow" }));
    expect(from).toHaveAttribute("aria-invalid", "true");
    expect(from).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "reliability.addAnnotation" }));
    const at = screen.getByLabelText("reliability.at");
    fireEvent.change(at, { target: { value: local } });
    fireEvent.change(screen.getByLabelText("reliability.annotationText"), { target: { value: "Marker" } });
    fireEvent.click(screen.getAllByRole("button", { name: "reliability.addAnnotation" }).find(button => button.getAttribute("type") === "submit")!);
    await waitFor(() => expect(at).toHaveAttribute("aria-invalid", "true"));
    expect(at).toHaveFocus();
    expect(mocks.annotate).not.toHaveBeenCalled();
  });
  it("preserves selected instants when the account timezone loads after the browser default", async () => {
    const { rerender } = render(<ReliabilityPanel monitorId="one" />);
    fireEvent.click(screen.getByRole("button", { name: "reliability.custom" }));
    const from = screen.getByLabelText("reliability.from");
    fireEvent.change(from, { target: { value: "2026-07-01T12:34" } });
    timezone.value = "Europe/Berlin";
    rerender(<ReliabilityPanel monitorId="one" />);
    await waitFor(() => expect(from).toHaveValue("2026-07-01T14:34"));
  });
  it("associates a reversed custom range with the end field and focuses it without fragment navigation", async () => {
    render(<ReliabilityPanel monitorId="one" />);
    fireEvent.click(screen.getByRole("button", { name: "reliability.custom" }));
    const from = screen.getByLabelText("reliability.from"), to = screen.getByLabelText("reliability.to");
    fireEvent.change(from, { target: { value: "2026-10-10T12:00" } });
    fireEvent.change(to, { target: { value: "2026-10-09T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "reliability.applyWindow" }));
    await waitFor(() => expect(to).toHaveAttribute("aria-invalid", "true"));
    expect(to).toHaveFocus();
    const link = screen.getByRole("link", { name: "reliability.to: reliability.invalidWindow" });
    expect(to.getAttribute("aria-describedby")?.split(" ")).toContain(link.id);
    const hash = window.location.hash;
    act(() => from.focus()); await userEvent.click(link);
    expect(to).toHaveFocus();
    expect(window.location.hash).toBe(hash);
    fireEvent.change(to, { target: { value: "2026-10-11T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "reliability.applyWindow" }));
    await waitFor(() => expect(to).not.toHaveAttribute("aria-invalid", "true"));
    expect(screen.queryByRole("link", { name: "reliability.to: reliability.invalidWindow" })).not.toBeInTheDocument();
  });
  it("keeps missing observations neutral and shows coverage independently of availability", () => {
    render(<ReliabilityPanel monitorId="one" monitorType="heartbeat" />);
    expect(screen.getAllByText("reliability.availability").length).toBeGreaterThan(0); expect(screen.getAllByText("reliability.coverage").length).toBeGreaterThan(0);
    expect(screen.queryByText("100.00%")).not.toBeInTheDocument(); expect(screen.queryByLabelText("reliability.latencyTarget")).not.toBeInTheDocument();
  });
  it("saves owner goal settings without testing or changing health", async () => {
    render(<ReliabilityPanel monitorId="one" monitorType="heartbeat" />);
    fireEvent.click(screen.getByRole("button", { name: "historyUX.setGoal" }));
    fireEvent.change(screen.getByLabelText("reliability.availabilityTarget"), { target: { value: "99.9" } });
    fireEvent.click(screen.getByText("reliability.saveGoals"));
    await waitFor(() => expect(mocks.configure).toHaveBeenCalledWith("one", { availabilityTargetBps: 9990, latencyTargetMs: null, excludeMaintenance: false }));
    expect(mocks.annotate).not.toHaveBeenCalled();
  });
  it("adds an explicit private timestamped marker and retains the window while paging", async () => {
    render(<ReliabilityPanel monitorId="one" monitorType="heartbeat" />);
    fireEvent.click(screen.getByRole("button", { name: "reliability.addAnnotation" }));
    fireEvent.change(screen.getByLabelText("reliability.annotationText"), { target: { value: "Release changed" } });
    fireEvent.click(screen.getAllByRole("button", { name: "reliability.addAnnotation" }).find(button => button.getAttribute("type") === "submit")!);
    await waitFor(() => expect(mocks.annotate).toHaveBeenCalledWith("one", expect.objectContaining({ text: "Release changed", link: null })));
  });
});

it("shows compact consumed downtime with raw seconds and keeps Help beside the heading", () => {
  render(<ReliabilityPanel monitorId="one" />);
  const consumed = screen.getAllByText("34m 52s")[0]!;
  expect(consumed).toHaveAttribute("title", "2,092.125 seconds");
  expect(consumed).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("heading", { name: "reliability.title" }).parentElement?.parentElement).toContainElement(screen.getByRole("link", { name: "Help" }));
});


it.each(["goal", "annotation"])("protects a changed reliability %s from navigation/reload and stops warning after revert", async kind => {
  const { hasRegisteredDraft } = await import("@/lib/draft-guards");
  const unload = () => { const event = new Event("beforeunload", { cancelable: true }); globalThis.window.dispatchEvent(event); return event.defaultPrevented; };
  const view = render(<ReliabilityPanel monitorId="one" monitorType="heartbeat" />);
  expect(hasRegisteredDraft()).toBe(false); expect(unload()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: kind === "goal" ? "historyUX.setGoal" : "reliability.addAnnotation" }));
  const field = screen.getByLabelText(kind === "goal" ? "reliability.availabilityTarget" : "reliability.annotationText");
  fireEvent.change(field, { target: { value: kind === "goal" ? "99.9" : "Unsubmitted marker" } });
  expect(hasRegisteredDraft()).toBe(true); expect(unload()).toBe(true);
  fireEvent.change(field, { target: { value: "" } });
  expect(hasRegisteredDraft()).toBe(false); expect(unload()).toBe(false);
  view.unmount(); expect(hasRegisteredDraft()).toBe(false);
});
