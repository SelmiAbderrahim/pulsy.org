import { formattingLocale } from "@/lib/formatting-locale";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime } from "@/lib/uptime/format";
import { useElapsedClock } from "./useElapsedClock";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const stamp = "2026-10-13T12:00:00Z";
function Collection({ locale = "en" }: { locale?: string }) {
  const now = useElapsedClock(true);
  return <>{Array.from({ length: 100 }, (_, index) => <time key={index}>{formatRelativeTime(stamp, locale, now)}</time>)}</>;
}

describe("relative time clock shared by a visible collection", () => {
  it("advances 100 timestamps for over a minute without interaction using one timer, then cleans up", () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.parse(stamp) + 11_000);
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Collection />);
    expect(screen.getAllByText("11 seconds ago")).toHaveLength(100);
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getAllByText("41 seconds ago")).toHaveLength(100);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getAllByText("2 minutes ago")).toHaveLength(100);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith("focus", expect.any(Function));
  });

  it.each(["en", "ar", "fr", "de", "es"])("formats null, invalid and future timestamps in %s", locale => {
    const now = Date.parse(stamp);
    expect(formatRelativeTime(null, locale, now)).toBe("—");
    expect(formatRelativeTime("invalid", locale, now)).toBe("—");
    expect(formatRelativeTime(stamp, locale, now - 30_000)).toBe(new Intl.RelativeTimeFormat(formattingLocale(locale), { numeric: "auto" }).format(0, "second"));
  });
});
