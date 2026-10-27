import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { HeartbeatEndpoint } from "./heartbeat-endpoint";
import { heartbeatExamples, heartbeatUrl } from "@/lib/uptime/heartbeat-url";
const { reveal } = vi.hoisted(() => ({ reveal: vi.fn() }));
vi.mock("react-i18next", () => reactI18nextMock());
vi.mock("@/lib/api/trpc", () => ({ SERVER_URL: "https://monitor.example" }));
vi.mock("@/services/uptime/heartbeatService", () => ({ HeartbeatService: { reveal } }));
const token = "a".repeat(43);
beforeEach(() => { reveal.mockReset().mockResolvedValue({ token }); });
describe("heartbeat capability URL", () => {
  it("derives body-less examples for every supported event and wget", () => {
    expect(heartbeatUrl("", "https://monitor.example", token)).toBe(`https://monitor.example/api/heartbeat/${token}/success`);
    const commands = heartbeatExamples("https://api.example/", "https://monitor.example", token);
    for (const event of ["start", "fail", "success"]) expect(commands).toContain(`/api/heartbeat/${token}/${event}`);
    expect(commands).toContain(`curl -fsS -m 10 --retry 3 "https://api.example/api/heartbeat/${token}/success"`);
    expect(commands).toContain(`wget -q -O /dev/null "https://api.example/api/heartbeat/${token}/success"`);
    expect(commands).not.toContain("Content-Type");
  });
  it("does not recover on mount; reveal, hide and copy are deliberate and masked copy stays masked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<HeartbeatEndpoint monitorId="job" />);
    expect(reveal).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain(token);
    await userEvent.click(screen.getByRole("button", { name: "heartbeat.reveal" }));
    expect(reveal).toHaveBeenCalledWith("job"); expect(document.body.textContent).toContain(token);
    await userEvent.click(screen.getByRole("button", { name: "heartbeat.hide" }));
    expect(document.body.textContent).not.toContain(token);
    await userEvent.click(screen.getByRole("button", { name: /statusUX.copyUrl/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`https://monitor.example/api/heartbeat/${token}/success`));
    expect(document.body.textContent).not.toContain(token);
  });
  it("never copies a fabricated URL for legacy hash-only tokens", async () => {
    reveal.mockResolvedValue({ token: null });
    const writeText = vi.fn(); Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<HeartbeatEndpoint monitorId="old-job" />);
    await userEvent.click(screen.getByRole("button", { name: /statusUX.copyUrl/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("heartbeat.rotateToReveal");
    expect(writeText).not.toHaveBeenCalled();
  });
});
