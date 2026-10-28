import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useElapsedClock } from "./useElapsedClock";
import { incidentDuration } from "@/lib/uptime/incident-duration";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("incident elapsed clock", () => {
  it("advances without network data changes, refreshes on resume and stops after resolution", () => {
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
    const { result, rerender, unmount } = renderHook(({ enabled }) => useElapsedClock(enabled), { initialProps: { enabled: true } });
    const initial = result.current;
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current - initial).toBe(30_000);
    vi.setSystemTime(initial + 600_000);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(result.current - initial).toBe(600_000);
    rerender({ enabled: false });
    const stopped = result.current;
    act(() => { vi.advanceTimersByTime(60_000);window.dispatchEvent(new Event("focus")); });
    expect(result.current).toBe(stopped);
    unmount();expect(vi.getTimerCount()).toBe(0);
  });

  it("uses absolute instants, clamps future starts and keeps missing timestamps unknown", () => {
    const now = Date.parse("2026-10-13T12:01:00Z");
    const open = { status: "ongoing", startedAt: "2026-10-13T14:00:00+02:00", durationSeconds: null };
    expect(incidentDuration(open, now)).toBe(60);
    expect(incidentDuration({ ...open, startedAt: "2026-10-13T12:02:00Z" }, now)).toBe(0);
    expect(incidentDuration({ ...open, startedAt: "" }, now)).toBeNull();
    expect(incidentDuration({ ...open, durationSeconds: 4 }, now)).toBe(60);
  });

  it("retains the final recorded duration and does not invent missing resolved history", () => {
    const resolved = { status: "resolved", startedAt: "2026-10-13T12:00:00Z", durationSeconds: 42 };
    expect(incidentDuration(resolved, Date.now())).toBe(42);
    expect(incidentDuration(resolved, Date.now() + 600_000)).toBe(42);
    expect(incidentDuration({ ...resolved, durationSeconds: null }, Date.now())).toBeNull();
    expect(incidentDuration({ ...resolved, durationSeconds: -1 }, Date.now())).toBeNull();
  });
});
