import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormFooter } from "./form-footer";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("updates the form's reserved height when the sticky actions wrap and cleans up", () => {
  let resize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  let height = 80;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ height }) as DOMRect);
  const { rerender } = render(<form aria-label="Settings"><FormFooter sticky>Save</FormFooter></form>);
  const form = screen.getByRole("form");
  expect(form.style.getPropertyValue("--sticky-footer-height")).toBe("80px");
  height = 132;
  act(resize);
  expect(form.style.getPropertyValue("--sticky-footer-height")).toBe("132px");
  rerender(<form aria-label="Settings"><FormFooter>Save</FormFooter></form>);
  expect(form.style.getPropertyValue("--sticky-footer-height")).toBe("");
  expect(disconnect).toHaveBeenCalledOnce();
});
