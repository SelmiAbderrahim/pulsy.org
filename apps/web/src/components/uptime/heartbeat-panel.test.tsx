import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { UptimeMonitor } from "@/types/uptime";
import { HeartbeatPanel } from "./heartbeat-controls";
vi.mock("react-i18next", () => reactI18nextMock());
const one = vi.hoisted(() => vi.fn());
const runs = vi.hoisted(() => vi.fn());
vi.mock("@/services/uptime/heartbeatService", () => ({ HeartbeatService: { one, runs } }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner" } } }) }));
vi.mock("./maintenance-controls", () => ({ MaintenanceControls: () => null }));
vi.mock("@/components/ui/docs-help-link", () => ({ DocsHelpLink: () => null }));


vi.mock("@/lib/api/trpc", () => ({ SERVER_URL: "" }));
const NOW = Date.parse("2026-10-11T12:00:00Z");
const monitor = (overrides: Partial<UptimeMonitor> = {}) => ({ uptimeMonitorId: "hb", name: "Job", monitorType: "heartbeat", active: true, status: "up", tags: [], ...overrides }) as UptimeMonitor;
const detail = (offsetToExpectedMs: number, extra: Record<string, unknown> = {}) => ({ monitorId: "hb", graceSeconds: 60, expectedAt: new Date(NOW + offsetToExpectedMs).toISOString(), nextDeadline: new Date(NOW + offsetToExpectedMs).toISOString(), lastReceivedAt: "2026-10-11T11:00:00Z", lastSuccessAt: "2026-10-11T11:00:00Z", lastFailAt: null, currentRunId: null, lastRunDurationMs: null, interval: 60, ...extra });
async function panel(data: object, m = monitor()) {
  one.mockResolvedValue(data); runs.mockResolvedValue([]);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><HeartbeatPanel monitor={m} /></QueryClientProvider>);
  await waitFor(() => expect(screen.queryByText("heartbeat.loading")).not.toBeInTheDocument());
  return screen.getByRole("status", { name: "heartbeat.title" });
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe("heartbeat deadline state is explicit and separate from when it was last evaluated", () => {
  it.each([
    ["before the first arrival", detail(120_000, { lastReceivedAt: null, lastSuccessAt: null }), monitor({ status: "pending" }), "heartbeat.stateNone"],
    ["start ping without a success", detail(120_000, { lastSuccessAt: null }), monitor({ status: "pending" }), "heartbeat.stateAwaitingSuccess"],
    ["on schedule", detail(120_000), monitor(), "heartbeat.stateOnTime"],
    ["late, inside grace", detail(-30_000), monitor({ status: "degraded" }), "heartbeat.stateLate"],
    ["overdue, past the grace deadline", detail(-18 * 3_600_000, { lastReceivedAt: null }), monitor({ status: "down" }), "heartbeat.overdueSince"],
    ["down and waiting (no further deadline)", detail(-18 * 3_600_000, { nextDeadline: null }), monitor({ status: "down" }), "heartbeat.overdueSince"],
    ["explicit failure before monitor status refetch", detail(120_000, { nextDeadline: null }), monitor(), "heartbeat.stateDown"],
    ["paused", detail(-18 * 3_600_000), monitor({ active: false }), "heartbeat.paused"],
  ])("%s", async (_name, data, m, expected) => {
    const status = await panel(data, m);
    expect(status).toHaveTextContent(expected);
    expect(screen.getByRole("heading", { name: "heartbeat.title", level: 2 })).toBeVisible();
  });
  it("still lists the absolute deadline and last-received facts separately", async () => {
    await panel(detail(-18 * 3_600_000, { lastReceivedAt: null }), monitor({ status: "down" }));
    expect(screen.getByText("heartbeat.finalDeadline")).toBeInTheDocument();
    expect(screen.getByText("heartbeat.received")).toBeInTheDocument();
    expect(screen.getByText("heartbeat.never")).toBeInTheDocument();
    expect(screen.getAllByText("heartbeat.none").length).toBeGreaterThan(0);
  });
});

 it("accepts refreshed pristine settings without turning them into an unsaved draft", async () => {
  one.mockResolvedValue(detail(120_000));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = (name: string) => <QueryClientProvider client={client}><HeartbeatPanel monitor={monitor({ name })} editing /></QueryClientProvider>;
  const view = render(content("Original"));
  await screen.findByLabelText("heartbeat.name");
  for (const name of ["Updated elsewhere", "Updated again"]) {
    view.rerender(content(name));
    await waitFor(() => expect(screen.getByLabelText("heartbeat.name")).toHaveValue(name));
    expect(screen.getByRole("button", { name: "heartbeat.save" })).toBeDisabled();
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  }
  fireEvent.change(screen.getByLabelText("heartbeat.name"), { target: { value: "Local draft" } });
  view.rerender(content("Another remote change"));
  expect(screen.getByLabelText("heartbeat.name")).toHaveValue("Local draft");
  expect(screen.getByRole("button", { name: "heartbeat.save" })).toBeEnabled();
 });
