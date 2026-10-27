import { MonitorQuickAdd } from "./monitor-quick-add";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { retireSessionClient } from "@/lib/session-query-client";
import { MonitorCreateDialog } from "./monitor-create-dialog";
import { MonitorBulkAddDialog } from "./monitor-bulk-add-dialog";
import { BulkEditSettingsDialog } from "./bulk-edit-settings-dialog";
import { SettingsTab } from "./monitor-detail/tabs/settings-tab";
import { MaintenanceControls } from "./maintenance-controls";
import type { UptimeMonitor } from "@/types/uptime";
const state = vi.hoisted(() => ({ send: vi.fn(), success: vi.fn(), error: vi.fn(), navigate: vi.fn() }));
vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("@/hooks/uptime", () => ({ useCreateUptimeMonitor: () => ({ mutateAsync: state.send, isPending: false }), useCreateUptimeMonitorsBulk: () => ({ mutateAsync: state.send, isPending: false }), useBulkUpdateUptimeSettings: () => ({ mutateAsync: state.send, isPending: false }), useUpdateUptimeMonitor: () => ({ mutateAsync: state.send, isPending: false }) }));
vi.mock("@/hooks/uptime/useUptimeMonitors", () => ({ useUptimeMonitors: () => ({ data: [] }) }));
vi.mock("@/hooks/uptime/useMaintenance", () => ({ useMaintenance: () => ({ data: [] }), useMaintenanceActions: () => Object.fromEntries(["create", "update", "snooze", "cancel", "resume", "preview"].map(key => [key, { isPending: false, mutateAsync: state.send }])) }));
vi.mock("@/lib/toast", () => ({ toast: { success: state.success, error: state.error } }));
const monitor: UptimeMonitor = { userId: "owner-a", active: true, status: "up", httpStatus: 200, responseTime: 5, lastCheckedAt: null, nextCheckAt: null, tlsExpiresAt: null, tlsExpiresInDays: null, consecutiveFailures: 0, uptimePercentage: 100, isPublic: false, statusPageTitle: null, statusPageDescription: null, createdAt: "2026-10-01T00:00:00.000Z", uptimeMonitorId: "a-monitor", name: "Owner A", url: "https://a.example", method: "GET", expectedStatus: 200, timeout: 10000, interval: 300, failureThreshold: 3, tags: [], monitorType: "http" };
beforeEach(() => vi.clearAllMocks());
function fixture(kind: string) {
  const client = new QueryClient();
  const component = kind === "quick" ? <MonitorQuickAdd open onOpenChange={vi.fn()} /> : kind === "create" ? <MonitorCreateDialog open onOpenChange={vi.fn()} /> : kind === "bulk" ? <MonitorBulkAddDialog open onOpenChange={vi.fn()} /> : kind === "edit" ? <BulkEditSettingsDialog open onOpenChange={vi.fn()} monitors={[monitor]} /> : kind === "settings" ? <SettingsTab monitor={monitor} /> : <MaintenanceControls monitorIds={[monitor.uptimeMonitorId]} />;
  render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
  if (kind === "create" || kind === "quick") { fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://a.example" } }); }
  if (kind === "bulk") fireEvent.change(screen.getByLabelText("URLs"), { target: { value: "https://a.example" } });
  if (kind === "edit") fireEvent.click(screen.getAllByRole("checkbox")[0]!);
  if (kind === "settings") fireEvent.change(screen.getByLabelText("create.fields.name"), { target: { value: "Changed owner A" } });
  return client;
}
for (const kind of ["create", "quick", "bulk", "edit", "settings", "maintenance"]) {
  it.each([false, true])(`${kind} suppresses a retired owner's completion effects (failure=%s)`, async failure => {
    let release!: (value: unknown) => void, reject!: (error: Error) => void;
    state.send.mockImplementation(() => new Promise((resolve, fail) => { release = resolve; reject = fail; }));
    const client = fixture(kind);
    if (kind === "maintenance") fireEvent.click(screen.getByRole("button", { name: "maintenanceUX.snooze15" }));
    else fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(state.send).toHaveBeenCalledOnce());
    retireSessionClient(client);
    const result = kind === "create" || kind === "quick" ? monitor : kind === "bulk" ? [monitor] : kind === "edit" ? { updated: [monitor], results: [] } : {};
    await act(async () => { if (failure) reject(new Error("Owner A private failure")); else release(result); });
    expect(state.success).not.toHaveBeenCalled(); expect(state.error).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent("Owner A private failure");
  });
}
it("does not let a retained completion toast action navigate after its owner retires", async () => {
  state.send.mockResolvedValue(monitor);
  const client = fixture("create");
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() => expect(state.success).toHaveBeenCalledOnce());
  const action = state.success.mock.calls[0]![1].action;
  retireSessionClient(client); action.onClick();
  expect(state.navigate).not.toHaveBeenCalled();
});
