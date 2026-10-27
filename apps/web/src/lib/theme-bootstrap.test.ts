import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const shell = new DOMParser().parseFromString(html, "text/html");
const firstScript = shell.head.querySelector("script")!;
const source = firstScript.getAttribute("src");
const bootstrap = source
  ? readFileSync(resolve(process.cwd(), "public", source.slice(1)), "utf8")
  : firstScript.textContent!;

describe("theme before first paint under the OSS content security policy", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("loads a synchronous same-origin script before locale and application startup", () => {
    expect(source).toBe("/theme-bootstrap.js");
    expect(firstScript.hasAttribute("async")).toBe(false);
    expect(firstScript.hasAttribute("defer")).toBe(false);
    expect(firstScript.getAttribute("type")).not.toBe("module");
    const scripts = [...shell.querySelectorAll("script")];
    expect(scripts.indexOf(firstScript)).toBeLessThan(scripts.findIndex(script => script.getAttribute("src") === "/locale-bootstrap.js"));
    expect(scripts.filter(script => !script.src && script.type !== "application/json")).toHaveLength(0);
  });

  it.each([
    ["dark", false, true], ["light", true, false],
    [null, true, true], [null, false, false], ["unknown", true, true],
  ])("honors stored %s and system dark=%s before React mounts", (stored, systemDark, expected) => {
    if (stored) localStorage.setItem("pulsy-theme", stored);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: systemDark }));
    window.eval(bootstrap);
    expect(document.documentElement.classList.contains("dark")).toBe(expected);
    expect(document.documentElement.style.colorScheme).toBe(expected ? "dark" : "light");
  });

  it("uses the system preference when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(() => window.eval(bootstrap)).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("defaults to light when system preference detection is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(() => window.eval(bootstrap)).not.toThrow();
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
