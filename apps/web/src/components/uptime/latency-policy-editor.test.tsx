import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import type { LatencyPolicy } from "@/types/uptime";
import { LatencyPolicyEditor } from "./latency-policy-editor";
vi.mock("react-i18next", () => reactI18nextMock());
function Fixture({ changed = vi.fn() }) {
  const [value, setValue] = useState<LatencyPolicy | null>(null);
  return <form><LatencyPolicyEditor value={value} onChange={next => { changed(next); setValue(next); }} /></form>;
}
describe("operating policy configuration", () => {
  it("keeps legacy defaults until enabled and permits quiet recovery without latency thresholds", async () => {
    const changed = vi.fn(); render(<Fixture changed={changed} />);
    await userEvent.click(screen.getByText("latency.title"));
    expect(changed).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("switch", { name: "latency.enabled" }));
    expect(changed.mock.lastCall?.[0]).toMatchObject({ thresholdMs: null, recoveryThresholdMs: null, recoveryCount: 2, importance: "critical" });
    await userEvent.click(screen.getByRole("combobox", { name: "latency.importance" }));
    await userEvent.click(screen.getByRole("option", { name: "latency.informational" }));
    expect(changed.mock.lastCall?.[0].importance).toBe("informational");
    await userEvent.click(screen.getByRole("switch", { name: "latency.enabled" }));
    expect(changed).toHaveBeenLastCalledWith(null);
  });
  it("blocks recovery above the slow threshold and preserves an exact zero recovery threshold", async () => {
    const changed = vi.fn(); render(<Fixture changed={changed} />);
    await userEvent.click(screen.getByText("latency.title"));
    await userEvent.click(screen.getByRole("switch", { name: "latency.enabled" }));
    await userEvent.click(screen.getByRole("switch", { name: "latency.slowEnabled" }));
    const recovery = screen.getByLabelText("latency.recoveryThreshold");
    fireEvent.change(recovery, { target: { value: "501" } });
    expect(recovery).toBeInvalid();
    fireEvent.change(recovery, { target: { value: "0" } });
    expect(recovery).toBeValid();
    expect(changed.mock.lastCall?.[0].recoveryThresholdMs).toBe(0);
    await userEvent.click(screen.getByRole("switch", { name: "latency.slowEnabled" }));
    expect(changed.mock.lastCall?.[0]).toMatchObject({ thresholdMs: null, recoveryThresholdMs: null });
  });
});

it("keeps an empty numeric draft without replacing it with zero, and accepts threshold equality", async () => {
  const changed = vi.fn(); render(<Fixture changed={changed} />);
  await userEvent.click(screen.getByText("latency.title"));
  await userEvent.click(screen.getByRole("switch", { name: "latency.enabled" }));
  await userEvent.click(screen.getByRole("switch", { name: "latency.slowEnabled" }));
  const threshold = screen.getByLabelText("latency.threshold");
  fireEvent.change(threshold, { target: { value: "" } });
  expect(threshold).toHaveValue(null); expect(threshold).toBeInvalid();
  expect(changed.mock.lastCall?.[0].thresholdMs).toBe(500);
  fireEvent.change(threshold, { target: { value: "300" } });
  expect(screen.getByLabelText("latency.recoveryThreshold")).toBeValid();
  expect(changed.mock.lastCall?.[0]).toMatchObject({ thresholdMs: 300, recoveryThresholdMs: 300 });
});
