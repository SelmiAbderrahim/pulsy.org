import { formattingLocale } from "@/lib/formatting-locale";
import type { ReactElement } from "react";
import { dateTimeFormat, formatTimezone } from "@/lib/date-format";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ServerState, ServerConfiguration, ServerMetric } from "@/types/server-health";
import type { UptimeMonitor } from "@/types/uptime";
import { ServerForm, ServerPanel, ServerSetup } from "./server-health-controls";
const fixture = vi.hoisted(() => ({ state: null as ServerState | null, history: [] as ServerMetric[], language: "en", rotate: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: fixture.language } }) }));

vi.mock("@/hooks/uptime/useServerHealth", () => ({ useServerHealth: () => ({ data: fixture.state, isPending: false }), useServerHistory: () => ({ data: fixture.history, isPending: false }) }));
vi.mock("@/services/uptime/serverHealthService", () => ({ ServerHealthService: { rotate: fixture.rotate } }));
vi.mock("./maintenance-controls", () => ({ MaintenanceControls: () => null }));
const state: ServerState = { monitorId: "server", thresholds: { cpu: 90, memory: 90, disk: 90 }, excludedFilesystems: [], conditions: [], interval: 60, active: true, createdAt: new Date(Date.now() - 3600000).toISOString(), retentionDays: 30, lastReceivedAt: null, nextDeadline: null, agent: null, latest: null, installation: { origin: "https://pulsy.example", installerUrl: "https://pulsy.example/api/agent/releases/v1.0.0/install.sh", requiresHttps: false, systemdCommand: "curl https://pulsy.example/api/agent/releases/v1.0.0/install.sh -o /tmp/install.sh && sudo bash /tmp/install.sh https://pulsy.example", composeCommand: "sudo bash /tmp/install.sh --compose https://pulsy.example", systemdCredentialCommand: "printf '%s\\n' '__PULSY_AGENT_CREDENTIAL__' | sudo bash /tmp/install.sh --credential-stdin https://pulsy.example", composeCredentialCommand: "printf '%s\\n' '__PULSY_AGENT_CREDENTIAL__' | sudo bash /tmp/install.sh --compose --credential-stdin https://pulsy.example" } };
const initial: ServerConfiguration = { name: "Host", interval: 60, active: true, thresholds: state.thresholds, tags: [], channelIds: [], excludedFilesystems: [] };
const monitor: UptimeMonitor = { userId: "owner", consecutiveFailures: 0, url: "", method: "GET", expectedStatus: 200, timeout: 10000, interval: 60, httpStatus: null, responseTime: null, lastCheckedAt: null, nextCheckAt: null, tlsExpiresAt: null, tlsExpiresInDays: null, failureThreshold: 3, uptimePercentage: null, isPublic: false, statusPageTitle: null, statusPageDescription: null, createdAt: new Date().toISOString(), uptimeMonitorId: "server", monitorType: "server", name: "Host", active: true, status: "pending", tags: [] };
function panel(editing = false, overrides: Partial<UptimeMonitor> = {}) { return render(<QueryClientProvider client={new QueryClient()}><ServerPanel monitor={{ ...monitor, ...overrides }} editing={editing} /></QueryClientProvider>); }
beforeEach(() => { fixture.state = state; fixture.history = []; fixture.language = "en"; fixture.rotate.mockReset(); });
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
afterEach(() => { cleanup(); Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight); });
describe("server setup, metrics and credentials", () => {
  it("masks credentials, uses configured origin, and never embeds credentials in installation commands", () => {
    render(<ServerSetup state={state} token="secret-fixture" />);
    expect(screen.getByLabelText("server.credential")).toHaveAttribute("type", "password");
    expect(screen.getByRole("region", { name: "server.systemd" })).toHaveTextContent("https://pulsy.example");
    expect(screen.getByRole("region", { name: "server.systemd" })).not.toHaveTextContent("secret-fixture");
    fireEvent.click(screen.getByText("server.reveal")); expect(screen.getByLabelText("server.credential")).toHaveAttribute("type", "text");
  });
  it("copies an unattended command with the one-time credential without rendering it", async () => {
    const credential = "A".repeat(40) + "b_-"; const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ServerSetup state={state} token={credential} />);
    expect(screen.getByText("server.commandContainsCredential")).toBeVisible();
    const compose = screen.getByRole("region", { name: "server.compose" });
    expect(compose).toHaveTextContent("--compose --credential-stdin"); expect(compose).not.toHaveTextContent(credential); expect(compose).not.toHaveTextContent("__PULSY_AGENT_CREDENTIAL__");
    fireEvent.click(screen.getByRole("button", { name: "server.copy: server.compose" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`printf '%s\\n' '${credential}' | sudo bash /tmp/install.sh --compose --credential-stdin https://pulsy.example`));
  });
  it("keeps the hidden-prompt commands once the one-time credential is gone", () => {
    render(<ServerSetup state={state} />);
    expect(screen.queryByText("server.commandContainsCredential")).toBeNull();
    expect(screen.getByRole("region", { name: "server.compose" })).not.toHaveTextContent("--credential-stdin");
  });
  it("explains HTTPS configuration instead of offering an insecure agent command", () => {
    render(<ServerSetup state={{ ...state, installation: { ...state.installation, requiresHttps: true } }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("server.httpsRequired"); expect(screen.queryByRole("region", { name: "server.systemd" })).toBeNull();
  });
  it("keeps pending metrics unavailable and offers troubleshooting after the initial connection window", () => {
    panel(); expect(screen.getByText("server.pending")).toBeVisible(); expect(screen.getByText("server.troubleshooting")).toBeVisible(); expect(screen.getAllByText("server.unavailable")).toHaveLength(6); expect(screen.getByText("server.noHistory")).toBeVisible();
  });
  it("distinguishes disconnected and paused states while retaining the last known values", () => {
    fixture.state = { ...state, lastReceivedAt: new Date(Date.now() - 3600000).toISOString(), latest: { receivedAt: new Date().toISOString(), sample: { cpuPercent: null, memoryPercent: 40, swapPercent: null, load: [1, 2, 3], uptimeSeconds: 500, filesystems: [{ path: "/data", usedPercent: 95 }], agent: { version: "1.0.0", arch: "amd64" }, sampledAt: new Date().toISOString() } } };
    const view = panel(false, { status: "down" }); expect(screen.getByText("server.disconnected")).toBeVisible(); expect(screen.getByText("40.00%")).toBeVisible(); expect(screen.getByText("/data")).toBeVisible(); view.unmount(); panel(false, { active: false }); expect(screen.getByText("server.paused")).toBeVisible();
  });
  it("requires explicit rotation and forgets the one-time credential when the dialog closes", async () => {
    fixture.rotate.mockResolvedValue({ token: "rotated-fixture" }); panel(true); fireEvent.click(screen.getByRole("button", { name: "server.rotate" })); expect(fixture.rotate).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "server.confirmRotate" }));
    const credential = await screen.findByLabelText("server.credential"); expect(credential).toHaveValue("rotated-fixture"); expect(credential).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "server.done" })); await waitFor(() => expect(screen.queryByLabelText("server.credential")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "server.rotate" })); expect(screen.queryByLabelText("server.credential")).toBeNull(); expect(fixture.rotate).toHaveBeenCalledTimes(1);
  });
});
describe("server validation", () => {
  it("marks CPU and RAM threshold range errors on the same field validation path", async () => {
    const save = vi.fn();
    render(<ServerForm initial={initial} onSave={save} />);
    const cpu = screen.getByLabelText("server.cpu (%)");
    const memory = screen.getByLabelText("server.memory (%)");
    fireEvent.change(cpu, { target: { value: "9050" } });
    fireEvent.change(memory, { target: { value: "905" } });
    fireEvent.click(screen.getByRole("button", { name: "server.save" }));
    await waitFor(() => {
      expect(cpu).toHaveAttribute("aria-invalid", "true");
      expect(memory).toHaveAttribute("aria-invalid", "true");
      expect(cpu).toHaveAttribute("aria-describedby");
      expect(memory).toHaveAttribute("aria-describedby");
    });
    expect(save).not.toHaveBeenCalled();
  });


  it("rejects malformed filesystem exclusions and preserves the technical interval", async () => {
    const save = vi.fn(); render(<ServerForm initial={initial} onSave={save} />);
    fireEvent.change(screen.getByLabelText("server.exclusions"), { target: { value: "relative/path" } }); fireEvent.click(screen.getByText("server.save")); expect(await screen.findByRole("alert")).toHaveTextContent("server.exclusionsHelp"); expect(save).not.toHaveBeenCalled();
    const exclusions = screen.getByLabelText("server.exclusions");
    expect(exclusions).toHaveFocus();
    expect(exclusions).toHaveAttribute("aria-invalid", "true");
    expect(exclusions).toHaveAccessibleDescription(/server.exclusionsHelp/);
    expect(exclusions.nextElementSibling).toHaveTextContent("server.exclusionsHelp");
    fireEvent.change(screen.getByLabelText("server.exclusions"), { target: { value: "/data\n/data" } }); fireEvent.click(screen.getByText("server.save")); await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ interval: 60, excludedFilesystems: ["/data"] })));
  });
});
it("puts one installation section before pending metrics and exposes deliberate credential generation", () => {
  panel();
  const setup = screen.getByRole("region", { name: "server.install" });
  expect(screen.getAllByRole("heading", { name: "server.install" })).toHaveLength(1);
  expect(setup.compareDocumentPosition(screen.getByText("server.pending")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"server.generate"}));
  expect(screen.getByRole("dialog")).toHaveTextContent("server.rotateConfirm");
  expect(fixture.rotate).not.toHaveBeenCalled();
});

it("offers schema-valid reporting intervals and preserves an existing custom interval", async () => {
  const save = vi.fn();
  render(<ServerForm initial={{ ...initial, interval: 90 }} onSave={save} />);
  const interval = screen.getByRole("combobox", { name: "server.interval" });
  expect(interval.tagName).toBe("BUTTON");
  expect(screen.getByRole("button", { name: "server.save" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("server.name"), { target: { value: "Updated server" } });
  fireEvent.click(screen.getByRole("button", { name: "server.save" }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ interval: 90 })));
  await userEvent.click(interval);
  const choices = screen.getAllByRole("option");
  expect(choices).toHaveLength(7);
  await userEvent.click(choices[choices.length - 1]!);
  fireEvent.click(screen.getByRole("button", { name: "server.save" }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ interval: 3600 })));
});

vi.mock("@/components/account-timezone", () => ({ useAccountTimezone: () => "Africa/Tunis" }));
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  const { cloneElement } = await vi.importActual<typeof import("react")>("react");
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 600, height: 300 }) };
});

function activeMetrics() {
  // The global jsdom fixture gives every element a 400px height. A real one-row
  // legend is shorter; otherwise it consumes the entire fixed chart viewport.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return this.classList.contains("recharts-legend-wrapper") ? 24 : 400; } });
  fixture.history = ["2026-10-14T11:00:00Z", "2026-10-14T10:00:00Z"].map(receivedAt => ({ receivedAt, sample: { cpuPercent: 25.5, memoryPercent: 40, swapPercent: null, load: null, uptimeSeconds: 500, filesystems: [{ path: "/data", usedPercent: 95 }], agent: { version: "1.0.0", arch: "amd64" }, sampledAt: receivedAt } }));
  fixture.state = { ...state, lastReceivedAt: fixture.history[0]!.receivedAt, latest: fixture.history[0]! };
}

it.each(["en", "ar", "fr", "de", "es"])("renders active server metrics with semantic colors and localized %s axes and tooltips", async locale => {
  fixture.language = locale;
  activeMetrics();
  const { container } = panel();
  const rtl = locale === "ar";
  expect(screen.getByRole("img", { name: "server.chartLabel" })).toHaveAttribute("dir", rtl ? "rtl" : "ltr");
  const curves = container.querySelectorAll(".recharts-line-curve");
  expect([...curves].map(curve => curve.getAttribute("stroke"))).toEqual(["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))"]);
  const values = [...container.querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value")];
  expect(values.length).toBeGreaterThan(0);
  expect(values.at(-1)?.textContent).toBe(new Intl.NumberFormat(formattingLocale(locale), { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1));
  for (const tick of values) {
    if (rtl) expect(Number(tick.getAttribute("x"))).toBeGreaterThan(500);
    else expect(Number(tick.getAttribute("x"))).toBeLessThan(100);
    expect(tick).toHaveStyle({ whiteSpace: "nowrap" });
    expect(tick).toHaveAttribute("fill", "hsl(var(--muted-foreground))");
  }
  expect(Number(values.at(-1)!.getAttribute("y"))).toBeGreaterThanOrEqual(24);
  const times = [...container.querySelectorAll(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value")];
  expect(times[0]).toHaveTextContent(dateTimeFormat(locale, "Africa/Tunis", { hour: "2-digit", minute: "2-digit" }).format(new Date("2026-10-14T10:00:00Z")));
  const firstX = Number(times[0]!.getAttribute("x")), lastX = Number(times.at(-1)!.getAttribute("x"));
  if (rtl) expect(firstX).toBeGreaterThan(lastX); else expect(firstX).toBeLessThan(lastX);
  // Recharts 3 computes pointer scale from the HTML wrapper; jsdom has no layout.
  const wrapper = container.querySelector(".recharts-wrapper")!;
  Object.defineProperties(wrapper, { offsetWidth: { configurable: true, value: 600 }, offsetHeight: { configurable: true, value: 300 }, getBoundingClientRect: { configurable: true, value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 300, width: 600, height: 300, toJSON: () => ({}) }) } });
  const surface = container.querySelector(".recharts-surface")!;
  fireEvent.mouseOver(surface, { clientX: 300, clientY: 150 });
  fireEvent.mouseMove(surface, { clientX: 300, clientY: 150 });
  const tooltip = container.querySelector(".recharts-tooltip-wrapper")!;
  await waitFor(() => expect(tooltip.textContent).toContain(new Intl.NumberFormat(formattingLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2, style: "percent" }).format(0.255)));
  expect(tooltip.textContent).toContain(formatTimezone("Africa/Tunis", locale, new Date("2026-10-14T10:00:00Z")));
  expect(tooltip.querySelector(".recharts-default-tooltip")).toHaveStyle({ backgroundColor: "hsl(var(--card))", color: "hsl(var(--foreground))" });
});

it("maps rejected server fields to the summary and inline field, retaining the draft", async () => {
  const save = vi.fn().mockRejectedValue({ data: { validationErrors: { fieldErrors: { excludedFilesystems: ["Path rejected"] } } } });
  render(<ServerForm initial={initial} onSave={save} />);
  const exclusions = screen.getByLabelText("server.exclusions");
  fireEvent.change(exclusions, { target: { value: "/data" } });
  fireEvent.click(screen.getByRole("button", { name: "server.save" }));
  await waitFor(() => expect(exclusions).toHaveFocus());
  expect(screen.getByRole("alert")).toHaveTextContent("server.exclusions: Path rejected");
  expect(exclusions).toHaveValue("/data");
  expect(exclusions).toHaveAttribute("aria-invalid", "true");
  expect(exclusions).toHaveAccessibleDescription(/Path rejected/);
  expect(exclusions.nextElementSibling).toHaveTextContent("Path rejected");
  expect(screen.getByRole("button", { name: "server.save" })).toBeEnabled();
});
