import { formattingLocale } from "@/lib/formatting-locale";
import { act, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelativeTime } from "./relative-time";

const stamp = "2026-10-14T12:00:00.000Z";
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function renderTime(locale: string, props: Partial<React.ComponentProps<typeof RelativeTime>> = {}) {
  const instance = i18next.createInstance();
  await instance.init({ lng: locale, resources: { [locale]: { common: {} } }, defaultNS: "common" });
  return render(<RelativeTime value={stamp} timezone="UTC" {...props} />, {
    wrapper: ({ children }) => <I18nextProvider i18n={instance}>{children}</I18nextProvider>,
  });
}

describe("RelativeTime", () => {
  it("reveals the absolute timestamp to keyboard users", async () => {
    await renderTime("en", { now: Date.parse(stamp) + 30_000 });
    const time = screen.getByText("30 seconds ago");
    expect(time).toHaveAttribute("tabindex", "0");
    fireEvent.focus(time);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(time.getAttribute("title")!);
  });
  it.each(["en", "ar", "fr", "de", "es"])("updates live in %s and exposes the same absolute source timestamp", async locale => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(stamp) + 11_000);
    const { unmount } = await renderTime(locale);
    const initial = new Intl.RelativeTimeFormat(formattingLocale(locale), { numeric: "auto" }).format(-11, "second");
    const element = screen.getByText(initial);
    expect(element.tagName).toBe("TIME");
    expect(element).toHaveAttribute("datetime", stamp);
    const absolute = new Intl.DateTimeFormat(formattingLocale(locale), { dateStyle: "full", timeStyle: "long", timeZone: "UTC" }).format(new Date(stamp));
    expect(element).toHaveAttribute("title", absolute);
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(element).toHaveTextContent(new Intl.RelativeTimeFormat(formattingLocale(locale), { numeric: "auto" }).format(-26, "second"));
    expect(element).toHaveAttribute("title", absolute);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts a collection clock without starting another timer", async () => {
    vi.useFakeTimers();
    const now = Date.parse(stamp) + 30_000;
    const { rerender } = await renderTime("en", { now, locale: "en" });
    expect(screen.getByText("30 seconds ago")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    rerender(<RelativeTime value={stamp} locale="en" timezone="UTC" now={now + 15_000} />);
    expect(screen.getByText("45 seconds ago")).toBeInTheDocument();
  });

  it.each([null, "invalid"])("renders %s as unavailable without an invalid datetime or running clock", async value => {
    vi.useFakeTimers();
    await renderTime("en", { value });
    const element = screen.getByText("—");
    expect(element).not.toHaveAttribute("datetime");
    expect(element).not.toHaveAttribute("title");
    expect(vi.getTimerCount()).toBe(0);
  });
});
