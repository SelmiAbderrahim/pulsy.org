import { afterEach, describe, expect, it, vi } from "vitest";
import { withMonitorCheckSlot } from "../scheduler-service";
afterEach(() => vi.useRealTimers());
describe("shared scheduled/manual network capacity", () => {
  it("shares the existing 20 slots and rejects extra manual waiters without running a probe", async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let active = 0, peak = 0;
    const work = async () => { active++; peak = Math.max(peak, active); try { await gate; } finally { active--; } };
    const held = Array.from({ length: 20 }, () => withMonitorCheckSlot(work, 30000));
    await Promise.resolve(); await Promise.resolve(); expect(active).toBe(20);
    const queued = Array.from({ length: 200 }, () => withMonitorCheckSlot(work, 30000)); const overflow = vi.fn();
    try { await expect(withMonitorCheckSlot(overflow, 30000)).rejects.toMatchObject({ code: "EPROBEBUSY" }); expect(overflow).not.toHaveBeenCalled(); }
    finally { release(); await Promise.all([...held, ...queued]); }
    expect(peak).toBe(20); expect(active).toBe(0);
  });
  it("expires a queued manual attempt without executing it and returns capacity after failures", async () => {
    vi.useFakeTimers(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const held = Array.from({ length: 20 }, () => withMonitorCheckSlot(() => gate, 30000)); await Promise.resolve(); await Promise.resolve();
    const probe = vi.fn(); const queued = withMonitorCheckSlot(probe, 50); const rejected = expect(queued).rejects.toMatchObject({ code: "EPROBEBUSY" });
    await vi.advanceTimersByTimeAsync(51); await rejected; expect(probe).not.toHaveBeenCalled();
    release(); await Promise.all(held);
    await expect(withMonitorCheckSlot(async () => { throw new Error("fixture failure"); }, 1000)).rejects.toThrow("fixture failure");
    await expect(withMonitorCheckSlot(async () => "next probe", 1000)).resolves.toBe("next probe");
  });
});
