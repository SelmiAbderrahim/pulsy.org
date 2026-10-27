import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { IncidentResponsePanel } from "./incident-workspace";
vi.mock("react-i18next", async () => { const { reactI18nextMock } = await import("@/test/i18n-mock"); return reactI18nextMock(); });
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner" } } }) }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
const service = vi.hoisted(() => ({ one: vi.fn(), acknowledge: vi.fn(), unacknowledge: vi.fn(), note: vi.fn(), runbook: vi.fn(), channels: vi.fn(), escalation: vi.fn() }));
vi.mock("@/services/uptime/incidentWorkspaceService", () => ({ IncidentWorkspaceService: service }));
const detail = { incident: { incidentId: "incident", uptimeMonitorId: "monitor", status: "ongoing", startedAt: "2026-10-09T12:00:00Z", cause: "HTTP 503", severity: "critical" }, monitor: { id: "monitor", name: "API", status: "down" }, response: { acknowledgedAt: null, acknowledgedBy: null, runbookDescription: "", runbookUrl: null, group: null, escalationSteps: null, escalationDisabled: false }, timeline: [], timelineTruncated: false };
describe("personal incident response controls", () => {
  beforeEach(() => { vi.clearAllMocks(); service.channels.mockResolvedValue({ items: [], nextCursor: null }); });
  it("configures only the explicitly selected channel after deliberate submission", async () => {
    service.one.mockResolvedValue(detail); service.escalation.mockResolvedValue({ configured: true });
    service.channels.mockResolvedValue({ items: [{ id: "owned-channel", type: "webhook", host: "fixtures.invalid", monitorName: "Other API", notifyOnDown: true, notifyOnDegraded: true }], nextCursor: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IncidentResponsePanel incidentId="incident" onClose={() => {}} /></QueryClientProvider>);
    await screen.findByText("API"); await userEvent.click(screen.getByRole("button", { name: "workspace.escalation.title" })); await waitFor(() => expect(screen.getByLabelText("workspace.escalation.primary")).toBeEnabled()); await userEvent.click(screen.getByRole("combobox", { name: "workspace.escalation.primary" })); await userEvent.click(await screen.findByRole("option", { name: /fixtures.invalid/ }));
    expect(service.escalation).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "workspace.escalation.configure" }));
    await waitFor(() => expect(service.escalation).toHaveBeenCalledWith("incident", [{ channelId: "owned-channel", afterSeconds: 300 }]));
  });
  it("retains a runbook draft and its baseline through polling and a rejected concurrent save", async () => {
    service.one.mockResolvedValue(detail); service.runbook.mockRejectedValue(new Error("Concurrent runbook edit"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><IncidentResponsePanel incidentId="incident" onClose={() => {}} /></QueryClientProvider>);
    await screen.findByText("API"); await userEvent.click(screen.getByRole("button", { name: "incidentUX.runbook" }));
    await userEvent.type(screen.getByLabelText("workspace.runbookDescription"), "My unsaved procedure");
    service.one.mockResolvedValue({ ...detail, response: { ...detail.response, runbookDescription: "Another saved procedure" } });
    await client.invalidateQueries({ queryKey: uptimeKeys.incidents.all() });
    await screen.findByText("incidentUX.runbookChanged");
    expect(screen.getByLabelText("workspace.runbookDescription")).toHaveValue("My unsaved procedure");
    await userEvent.click(screen.getByRole("button", { name: "workspace.saveRunbook" }));
    await waitFor(() => expect(service.runbook).toHaveBeenCalledWith("incident", "My unsaved procedure", "", { description: "", url: null }));
    expect(screen.getByLabelText("workspace.runbookDescription")).toHaveValue("My unsaved procedure");
  });
  it("treats a runbook edit that was typed back as no draft: a newer saved version is shown, not flagged as a conflict", async () => {
    service.one.mockResolvedValue(detail);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><IncidentResponsePanel incidentId="incident" onClose={() => {}} /></QueryClientProvider>);
    await screen.findByText("API"); await userEvent.click(screen.getByRole("button", { name: "incidentUX.runbook" }));
    const field = screen.getByLabelText("workspace.runbookDescription");
    await userEvent.type(field, "abc"); await userEvent.clear(field);
    service.one.mockResolvedValue({ ...detail, response: { ...detail.response, runbookDescription: "Saved elsewhere" } });
    await client.invalidateQueries({ queryKey: uptimeKeys.incidents.all() });
    await waitFor(() => expect(screen.getByLabelText("workspace.runbookDescription")).toHaveValue("Saved elsewhere"));
    expect(screen.queryByText("incidentUX.runbookChanged")).not.toBeInTheDocument();
  });
  it("keeps the cause the incident opened with and shows a later, different observation separately", async () => {
    const event = (id: string, text: string, createdAt: string) => ({ id, kind: "check", text, status: "down", createdAt, actorId: null });
    service.one.mockResolvedValue({ ...detail, incident: { ...detail.incident, cause: "heartbeat_late" }, timeline: [event("2", "heartbeat_missed", "2026-10-09T12:05:00Z"), event("1", "heartbeat_late", "2026-10-09T12:00:00Z")] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IncidentResponsePanel incidentId="incident" onClose={() => {}} /></QueryClientProvider>);
    await screen.findByText("workspace.openedBecause", { exact: false });
    expect(screen.getByText("workspace.latestCause", { exact: false })).toBeInTheDocument();
  });
  it("labels expected, grace-end and notified times separately for a heartbeat incident", async () => {
    service.one.mockResolvedValue({ ...detail, incident: { ...detail.incident, cause: "heartbeat_missed", expectedAt: "2026-10-09T11:59:00Z", startedAt: "2026-10-09T12:00:00Z", notifiedAt: "2026-10-09T12:00:07Z" } });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IncidentResponsePanel incidentId="incident" onClose={() => {}} /></QueryClientProvider>);
    await screen.findByText("workspace.expectedAt");
    expect(screen.getByText("workspace.graceEndsAt")).toBeInTheDocument();
    expect(screen.getByText("workspace.notifiedAt")).toBeInTheDocument();
    expect(screen.queryByText("workspace.started")).not.toBeInTheDocument();
    expect(screen.queryByText("workspace.notNotified")).not.toBeInTheDocument();
  });
  it("shows a plain start time and an explicit not-notified state for a measured (non-heartbeat) incident", async () => {
    service.one.mockResolvedValue({ ...detail, incident: { ...detail.incident, expectedAt: null, notifiedAt: null } });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IncidentResponsePanel incidentId="incident" onClose={() => {}} /></QueryClientProvider>);
    await screen.findByText("workspace.started");
    expect(screen.queryByText("workspace.expectedAt")).not.toBeInTheDocument();
    expect(screen.queryByText("workspace.graceEndsAt")).not.toBeInTheDocument();
    expect(screen.getByText("workspace.notNotified")).toBeInTheDocument();
  });
  it("shows no second cause line while the latest observation is still the opening one", async () => {
    service.one.mockResolvedValue({ ...detail, incident: { ...detail.incident, cause: "HTTP 503" }, timeline: [{ id: "1", kind: "check", text: "HTTP 503", status: "down", createdAt: "2026-10-09T12:00:00Z", actorId: null }] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IncidentResponsePanel incidentId="incident" onClose={() => {}} /></QueryClientProvider>);
    await screen.findByText("workspace.openedBecause", { exact: false });
    expect(screen.queryByText("workspace.latestCause", { exact: false })).not.toBeInTheDocument();
  });
  it("acknowledges deliberately without changing the displayed measured health", async () => {
    service.one.mockResolvedValue(detail); service.acknowledge.mockResolvedValue({ acknowledged: true });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IncidentResponsePanel incidentId="incident" onClose={() => {}} /></QueryClientProvider>);
    await screen.findByText("API"); expect(service.acknowledge).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "workspace.acknowledge" }));
    await waitFor(() => expect(service.acknowledge).toHaveBeenCalledWith("incident"));
    expect(screen.getByText("workspace.measuredHealth")).toBeInTheDocument(); expect(screen.getByText("status.down")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "workspace.resolve" })).not.toBeInTheDocument();
  });
  it("preserves the draft on a rejected note and displays an actionable error", async () => {
    service.one.mockResolvedValue(detail); service.note.mockRejectedValue(new Error("Fixture rejection"));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IncidentResponsePanel incidentId="incident" onClose={() => {}} /></QueryClientProvider>);
    await screen.findByText("API"); await userEvent.type(screen.getByLabelText("workspace.note"), "Investigating deployment");
    await userEvent.click(screen.getByRole("button", { name: "workspace.saveNote" }));
    await screen.findByRole("alert"); expect(screen.getByLabelText("workspace.note")).toHaveValue("Investigating deployment");
    expect(service.note).toHaveBeenCalledWith("incident", "Investigating deployment");
  });
});

it("keeps Help in the response header and gives note and acknowledgement actions natural desktop width", async () => {
  service.one.mockResolvedValue(detail);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IncidentResponsePanel incidentId="incident" onClose={() => {}} /></QueryClientProvider>);
  await screen.findByText("API");
  expect(screen.getByRole("link", { name: "help.title" }).closest("header")).toBeInTheDocument();
  for (const name of ["workspace.acknowledge", "workspace.saveNote"]) {
    expect(screen.getByRole("button", { name })).toHaveClass("w-full", "sm:w-auto", "sm:justify-self-end");
  }
  expect(screen.getByRole("button", { name: "workspace.saveNote" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "workspace.saveNote" })).toHaveClass("disabled:opacity-50", "disabled:cursor-not-allowed");
});


it("shows the acknowledgement actor/time and supports keyboard unacknowledgement", async () => {
  const acknowledgedAt = "2026-10-14T12:00:00.000Z";
  service.one.mockResolvedValue({ ...detail, response: { ...detail.response, acknowledgedAt, acknowledgedBy: "owner" } });
  service.unacknowledge.mockImplementation(async () => { service.one.mockResolvedValue(detail); return { acknowledged: false }; });
  const { container } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IncidentResponsePanel incidentId="incident" onClose={() => {}} /></QueryClientProvider>);
  const action = await screen.findByRole("button", { name: "workspace.unacknowledge" });
  expect(screen.getByText("workspace.acknowledgedBy", { exact: false })).toBeVisible();
  expect(container.querySelector(`time[datetime="${acknowledgedAt}"]`)).toBeVisible();
  expect(screen.queryByRole("button", { name: "workspace.acknowledge" })).not.toBeInTheDocument();
  action.focus(); await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(service.unacknowledge).toHaveBeenCalledWith("incident"));
  await screen.findByRole("button", { name: "workspace.acknowledge" });
  expect(screen.getByText("status.down")).toBeVisible();
});

it("hides acknowledgement actions on resolved incidents", async () => {
  service.one.mockResolvedValue({ ...detail, incident: { ...detail.incident, status: "resolved" } });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IncidentResponsePanel incidentId="incident" onClose={() => {}} /></QueryClientProvider>);
  await screen.findByText("API");
  expect(screen.queryByRole("button", { name: "workspace.acknowledge" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "workspace.unacknowledge" })).not.toBeInTheDocument();
});


it.each(["note", "runbook"])("registers an incident %s draft for navigation and reload, then releases it after reverting", async kind => {
  const { hasRegisteredDraft } = await import("@/lib/draft-guards");
  const unload = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
  service.one.mockResolvedValue(detail);
  const view = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IncidentResponsePanel incidentId="incident" onClose={() => {}} /></QueryClientProvider>);
  await screen.findByText("API");
  expect(hasRegisteredDraft()).toBe(false); expect(unload()).toBe(false);
  if (kind === "runbook") await userEvent.click(screen.getByRole("button", { name: "incidentUX.runbook" }));
  const field = screen.getByLabelText(kind === "note" ? "workspace.note" : "workspace.runbookDescription");
  await userEvent.type(field, "Unsubmitted response");
  expect(hasRegisteredDraft()).toBe(true); expect(unload()).toBe(true);
  await userEvent.clear(field);
  expect(hasRegisteredDraft()).toBe(false); expect(unload()).toBe(false);
  await userEvent.type(field, "Another draft"); view.unmount();
  expect(hasRegisteredDraft()).toBe(false); expect(unload()).toBe(false);
});
