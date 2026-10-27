import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { HeartbeatCreateControl } from "./heartbeat-controls";
vi.mock("react-i18next", () => reactI18nextMock());
const create = vi.hoisted(() => vi.fn());
vi.mock("@/services/uptime/heartbeatService", () => ({ HeartbeatService: { create } }));


vi.mock("@/lib/api/trpc", () => ({ SERVER_URL: "" }));
describe("heartbeat deliberate one-time reveal", () => {
  it("creates only on submit, keeps the one-time token masked, and forgets it after closing", async () => {
    create.mockResolvedValue({ monitor: { uptimeMonitorId: "job" }, token: "fixture-token-never-in-url" });
    render(<QueryClientProvider client={new QueryClient()}><HeartbeatCreateControl /></QueryClientProvider>);
    await userEvent.click(screen.getByRole("button", { name: "heartbeat.add" }));
    await userEvent.type(screen.getByLabelText("heartbeat.name"), "Backup"); expect(create).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "heartbeat.create" }));
    await screen.findByRole("region", { name: "heartbeat.endpoint" });
    expect(document.body.textContent).not.toContain("fixture-token-never-in-url");
    expect(screen.getByText(/curl/).textContent).not.toContain("fixture-token-never-in-url");
    await userEvent.click(screen.getByRole("button", { name: "heartbeat.reveal" })); expect(document.body.textContent).toContain("fixture-token-never-in-url");
    await userEvent.click(screen.getByRole("button", { name: "heartbeat.done" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "heartbeat.endpoint" })).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "heartbeat.add" }));
    expect(screen.queryByRole("region", { name: "heartbeat.endpoint" })).not.toBeInTheDocument(); expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("heartbeat deadline explanation", () => {
  it("states the final deadline from the entered interval and grace, and updates as they change", async () => {
    render(<QueryClientProvider client={new QueryClient()}><HeartbeatCreateControl /></QueryClientProvider>);
    await userEvent.click(screen.getByRole("button", { name: "heartbeat.add" }));
    expect(screen.getByText("heartbeat.deadlineExample")).toBeInTheDocument();
    const interval = screen.getByLabelText("heartbeat.interval");
    await userEvent.clear(interval); await userEvent.type(interval, "10");
    expect(screen.queryByText("heartbeat.deadlineExample")).not.toBeInTheDocument();
  });
});

it("uses the standard create dialog width and an example name", async () => {
  render(<QueryClientProvider client={new QueryClient()}><HeartbeatCreateControl /></QueryClientProvider>);
  await userEvent.click(screen.getByRole("button", { name: "heartbeat.add" }));
  expect(screen.getByRole("dialog")).toHaveClass("max-w-[var(--dialog-standard)]");
  expect(screen.getByLabelText("heartbeat.name")).toHaveAttribute("placeholder", "formUX.example");
});

it("converts interval and grace units to seconds without changing deadlines when only the unit changes", async () => {
  create.mockClear(); create.mockResolvedValue({ monitor: { uptimeMonitorId: "units" }, token: "fixture" });
  render(<QueryClientProvider client={new QueryClient()}><HeartbeatCreateControl /></QueryClientProvider>);
  await userEvent.click(screen.getByRole("button", { name: "heartbeat.add" }));
  await userEvent.type(screen.getByLabelText("heartbeat.name"), "Units");
  await userEvent.click(screen.getByRole("combobox", { name: "heartbeat.intervalUnit" }));
  await userEvent.click(screen.getByRole("option", { name: "heartbeat.units.minutes" }));
  expect(screen.getByLabelText("heartbeat.interval")).toHaveValue(5);
  await userEvent.clear(screen.getByLabelText("heartbeat.interval"));
  await userEvent.type(screen.getByLabelText("heartbeat.interval"), "10");
  await userEvent.click(screen.getByRole("combobox", { name: "heartbeat.graceUnit" }));
  await userEvent.click(screen.getByRole("option", { name: "heartbeat.units.minutes" }));
  expect(screen.getByLabelText("heartbeat.grace")).toHaveValue(1);
  await userEvent.click(screen.getByRole("button", { name: "heartbeat.create" }));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ interval: 600, graceSeconds: 60 }));
});

it("preserves decimal hours while typing and rejects fractional seconds instead of rounding", async () => {
  create.mockClear(); create.mockResolvedValue({ monitor: { uptimeMonitorId: "fraction" }, token: "fixture" });
  render(<QueryClientProvider client={new QueryClient()}><HeartbeatCreateControl /></QueryClientProvider>);
  await userEvent.click(screen.getByRole("button", { name: "heartbeat.add" }));
  await userEvent.type(screen.getByLabelText("heartbeat.name"), "Fractional units");
  const interval = screen.getByLabelText("heartbeat.interval");
  await userEvent.clear(interval); await userEvent.type(interval, "29.9");
  expect(interval).toHaveValue(29.9);
  await userEvent.click(screen.getByRole("button", { name: "heartbeat.create" }));
  expect(create).not.toHaveBeenCalled();
  await userEvent.clear(interval); await userEvent.type(interval, "30.5");
  await userEvent.click(screen.getByRole("button", { name: "heartbeat.create" }));
  expect(screen.getByRole("link", { name: /heartbeat.wholeSeconds/ })).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("combobox", { name: "heartbeat.intervalUnit" }));
  await userEvent.click(screen.getByRole("option", { name: "heartbeat.units.hours" }));
  await userEvent.clear(interval); await userEvent.type(interval, "0.0125");
  expect(interval).toHaveValue(0.0125);
  await userEvent.click(screen.getByRole("button", { name: "heartbeat.create" }));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ interval: 45 }));
});


it("maps rejected heartbeat fields to the shared summary, descriptions and focus", async () => {
  create.mockClear(); create.mockRejectedValue({ data: { validationErrors: { fieldErrors: { graceSeconds: ["Grace exceeds the allowed duration"] } } } });
  render(<QueryClientProvider client={new QueryClient()}><HeartbeatCreateControl /></QueryClientProvider>);
  await userEvent.click(screen.getByRole("button", { name: "heartbeat.add" }));
  await userEvent.type(screen.getByLabelText("heartbeat.name"), "Rejected grace");
  await userEvent.click(screen.getByRole("button", { name: "heartbeat.create" }));
  const issue = await screen.findByRole("link", { name: "heartbeat.grace: Grace exceeds the allowed duration" });
  const field = screen.getByLabelText("heartbeat.grace");
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field.getAttribute("aria-describedby")).toContain(issue.id);
  await waitFor(() => expect(field).toHaveFocus());
  expect(screen.queryByText("heartbeat.error")).not.toBeInTheDocument();
});
