import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkForm } from "./network-controls";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));


vi.mock("./latency-policy-editor", () => ({ LatencyPolicyEditor: () => null }));
afterEach(() => { cleanup(); });
const initial = { name: "Verification", configuration: { type: "dns" as const, hostname: "_acme-challenge.example.invalid", recordType: "TXT" as const, mode: "matches" as const, expected: ["Case Sensitive", ""] }, interval: 300 as const, timeout: 1000, failureThreshold: 1, active: false, tags: ["client,one"] };
it("validates timeout on blur and updates its error on every subsequent change", () => {
  render(<NetworkForm initial={initial} onSave={vi.fn()} label="Save" />);
  const timeout = screen.getByLabelText("network.timeout");
  fireEvent.change(timeout, { target: { value: "500" } });
  fireEvent.blur(timeout);
  expect(timeout).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(timeout, { target: { value: "600" } });
  expect(timeout).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(timeout, { target: { value: "1000" } });
  expect(timeout).not.toHaveAttribute("aria-invalid", "true");
});
describe("typed network configuration controls", () => {
  it.each([
    ["A", '["999.1.1.1"]'], ["AAAA", '["192.0.2.1"]'],
    ["CNAME", '["https://example.invalid/path"]'], ["MX", '[{"exchange":"mail.example.invalid","priority":"10"}]'],
    ["TXT", '[false]'],
  ])("identifies invalid %s record types without changing the valid fields", async (recordType, value) => {
    const save = vi.fn(); render(<NetworkForm initial={initial} onSave={save} label="Save network" />);
    await userEvent.click(screen.getByRole("combobox", { name: "network.recordType" }));
    await userEvent.click(screen.getByRole("option", { name: recordType }));
    fireEvent.change(screen.getByLabelText("network.expected"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save network" }));
    expect(await screen.findByRole("link", { name: new RegExp(`network.validation.records_${recordType}`) })).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText("network.expected")).toHaveFocus());
    expect(screen.getByLabelText("network.expected")).toHaveValue(value);
    expect(screen.getByLabelText("network.hostname")).toHaveValue(initial.configuration.hostname);
    expect(save).not.toHaveBeenCalled();
  });
  it.each([['[]', 'empty'], ['{bad', 'json'], ['[12]', 'records_TXT']])("identifies and focuses invalid expected records: %s", async (value, reason) => {
    const save = vi.fn(); render(<NetworkForm initial={initial} onSave={save} label="Save network" />);
    const expected = screen.getByLabelText("network.expected");
    fireEvent.change(expected, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save network" }));
    expect(await screen.findByRole("link", { name: new RegExp(`network.validation.${reason}`) })).toBeVisible();
    expect(expected).toHaveAttribute("aria-invalid", "true");
    expect(expected).toHaveAttribute("aria-describedby", "network-expected-error");
    await waitFor(() => expect(expected).toHaveFocus());
    expect(expected).toHaveValue(value);
    expect(screen.getByLabelText("network.hostname")).toHaveValue(initial.configuration.hostname);
    expect(save).not.toHaveBeenCalled();
  });
  it("reports multiple invalid TCP fields and focuses the first in form order", async () => {
    const save = vi.fn(); render(<NetworkForm initial={{ ...initial, configuration: { type: "tcp", hostname: "example.invalid", port: 443 } }} onSave={save} label="Save network" />);
    fireEvent.change(screen.getByLabelText("network.hostname"), { target: { value: 'https://bad/path' } });
    fireEvent.change(screen.getByLabelText("network.port"), { target: { value: '65536' } });
    fireEvent.change(screen.getByLabelText("network.timeout"), { target: { value: '999' } });
    fireEvent.click(screen.getByRole("button", { name: "Save network" }));
    await waitFor(() => expect(screen.getByLabelText("network.hostname")).toHaveFocus());
    expect(screen.getByRole("link", { name: /network.validation.port/ })).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: /network.validation.port/ }));
    expect(screen.getByLabelText("network.port")).toHaveFocus();
    expect(screen.getByRole("link", { name: /network.validation.timeout/ })).toBeVisible();
    expect(screen.getByLabelText("network.timeout")).toHaveAttribute("aria-describedby", "network-timeout-help network-timeout-error");
    expect(save).not.toHaveBeenCalled();
  });

  it("preserves TXT case/empty values and tag boundaries and saves only on explicit submit", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<NetworkForm initial={initial} onSave={save} label="Save network" />);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save network" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("network.name"), { target: { value: "Updated job" } });
    fireEvent.click(screen.getByRole("button", { name: "Save network" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ configuration: initial.configuration, tags: ["client,one"], active: false })));
  });
  it("rejects invalid typed expectations without submitting or silently replacing the baseline", async () => {
    const save = vi.fn(); render(<NetworkForm initial={initial} onSave={save} label="Save network" />);
    await userEvent.click(screen.getByRole("combobox", { name: "network.recordType" }));
    await userEvent.click(screen.getByRole("option", { name: "MX" }));
    fireEvent.click(screen.getByRole("button", { name: "Save network" }));
    await screen.findByRole("link", { name: /network.validation/ }); expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText("network.expected")).toHaveValue(JSON.stringify(initial.configuration.expected, null, 2));
  });
  it("discloses TCP reachability limits and preserves the explicit hostname/port/timeout", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<NetworkForm initial={{ ...initial, configuration: { type: "tcp", hostname: "localhost", port: 5432 } }} onSave={save} label="Save network" />);
    expect(screen.getByText("network.tcpMeaning")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save network" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("network.name"), { target: { value: "Updated TCP" } });
    fireEvent.click(screen.getByRole("button", { name: "Save network" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ configuration: { type: "tcp", hostname: "localhost", port: 5432 }, timeout: 1000 })));
  });
});

it.each(["dns", "tcp"] as const)("submits the shared 60-second timeout for %s with Example placeholders", async type => {
  const save = vi.fn();
  const configuration = type === "dns" ? initial.configuration : { type, hostname: "example.invalid", port: 443 };
  render(<NetworkForm initial={{ ...initial, configuration }} onSave={save} label="Save network" />);
  const timeout = screen.getByLabelText("network.timeout");
  expect(timeout).toHaveAttribute("max", "60000");
  expect(screen.getByLabelText("network.name")).toHaveAttribute("placeholder");
  expect(screen.getByLabelText("network.hostname")).toHaveAttribute("placeholder");
  fireEvent.change(timeout, { target: { value: "60000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save network" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ timeout: 60000 })));
  save.mockClear();
  fireEvent.change(timeout, { target: { value: "60001" } });
  fireEvent.click(screen.getByRole("button", { name: "Save network" }));
  expect(timeout).toHaveAttribute("aria-invalid", "true");
  expect(save).not.toHaveBeenCalled();
});
