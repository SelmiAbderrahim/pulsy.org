// Vitest setup for the web package.
// Adds jest-dom matchers (toBeInTheDocument, toHaveClass, ...) for component tests.
import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// Dialog-submit tests drive long userEvent interactions; on a loaded machine
// (Docker build stage, small CI runners) the default 1s findBy*/waitFor window
// flakes. Give async utils headroom — fast tests are unaffected.
configure({ asyncUtilTimeout: 10_000 });

// recharts' ResponsiveContainer relies on ResizeObserver, which jsdom does not
// implement. Provide a minimal no-op polyfill.
if (!globalThis.ResizeObserver) {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}

// Radix UI primitives (Select, etc.) call Pointer Capture and scrollIntoView
// APIs that jsdom does not implement. Provide no-op stubs so menus can open.
if (typeof Element !== "undefined") {
	if (!Element.prototype.hasPointerCapture) {
		Element.prototype.hasPointerCapture = () => false;
	}
	if (!Element.prototype.setPointerCapture) {
		Element.prototype.setPointerCapture = () => {};
	}
	if (!Element.prototype.releasePointerCapture) {
		Element.prototype.releasePointerCapture = () => {};
	}
	if (!Element.prototype.scrollIntoView) {
		Element.prototype.scrollIntoView = () => {};
	}
}

// recharts measures its container via getBoundingClientRect / offset sizes,
// which jsdom reports as 0. Force non-zero dimensions so charts render their
// SVG children in tests.
if (typeof HTMLElement !== "undefined") {
	Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
		configurable: true,
		value: 800,
	});
	Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
		configurable: true,
		value: 400,
	});
}
