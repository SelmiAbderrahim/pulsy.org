import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { initializeTheme, ThemeToggle } from "./theme-toggle";
vi.mock("react-i18next", () => reactI18nextMock());
beforeEach(() => { localStorage.clear(); document.documentElement.classList.remove("dark"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });
function systemTheme(dark = false) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const media = { matches: dark, addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener), removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener) };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  return { listeners, change(matches: boolean) { act(() => { media.matches = matches; for (const listener of listeners) listener({ matches }); }); } };
}
describe("theme action", () => {
  it.each(["light", "dark"])("shows the next action from %s and toggles with one click", theme => {
    localStorage.setItem("pulsy-theme", theme);
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: theme === "light" ? "Switch to dark mode" : "Switch to light mode" });
    expect(button.querySelector(theme === "light" ? ".lucide-moon" : ".lucide-sun")).not.toHaveClass("hidden");
    expect(button.querySelectorAll("svg")).toHaveLength(1);
    fireEvent.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(theme === "light");
    expect(localStorage.getItem("pulsy-theme")).toBe(theme === "light" ? "dark" : "light");
    expect(button).toHaveAccessibleName(theme === "light" ? "Switch to light mode" : "Switch to dark mode");
    expect(button.querySelector(theme === "light" ? ".lucide-sun" : ".lucide-moon")).toBeInTheDocument();
  });
  it.each(["/", "/dashboard"])("follows changing system preference without storing it on %s", path => {
    window.history.replaceState(null, "", path);
    const system = systemTheme();
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Switch to dark mode");
    system.change(true);
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByRole("button")).toHaveAccessibleName("Switch to light mode");
    expect(localStorage.getItem("pulsy-theme")).toBeNull();
    system.change(false);
    expect(document.documentElement).not.toHaveClass("dark");
  });
  it("synchronizes both toggles immediately and keeps the explicit choice through OS changes", () => {
    const system = systemTheme();
    render(<><ThemeToggle /><ThemeToggle /></>);
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getAllByRole("button", { name: "Switch to light mode" })).toHaveLength(2);
    system.change(true); system.change(false);
    expect(document.documentElement).toHaveClass("dark");
    fireEvent.click(screen.getAllByRole("button")[1]!);
    expect(screen.getAllByRole("button", { name: "Switch to dark mode" })).toHaveLength(2);
  });
  it("reacts to another tab's stored choice and resumes OS following after storage clears", () => {
    const system = systemTheme(true);
    localStorage.setItem("pulsy-theme", "light");
    render(<ThemeToggle />);
    act(() => { localStorage.setItem("pulsy-theme", "dark"); window.dispatchEvent(new StorageEvent("storage", { key: "pulsy-theme", newValue: "dark" })); });
    expect(screen.getByRole("button")).toHaveAccessibleName("Switch to light mode");
    system.change(false);
    expect(document.documentElement).toHaveClass("dark");
    act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null })); });
    expect(document.documentElement).not.toHaveClass("dark");
    system.change(true);
    expect(document.documentElement).toHaveClass("dark");
  });
  it("initializes a shared observer even with no toggle and cleans up mounted subscriptions", () => {
    const system = systemTheme();
    const dispose = initializeTheme();
    const view = render(<><ThemeToggle /><ThemeToggle /></>);
    expect(system.listeners.size).toBe(1);
    view.unmount(); system.change(true);
    expect(document.documentElement).toHaveClass("dark");
    if (typeof dispose === "function") dispose();
    expect(system.listeners.size).toBe(0);
  });
  it("keeps an explicit session choice when localStorage is blocked", () => {
    const system = systemTheme();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    render(<><ThemeToggle /><ThemeToggle /></>);
    fireEvent.click(screen.getAllByRole("button")[0]!);
    system.change(true); system.change(false);
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getAllByRole("button", { name: "Switch to light mode" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button")[1]!);
    expect(document.documentElement).not.toHaveClass("dark");
  });
});
