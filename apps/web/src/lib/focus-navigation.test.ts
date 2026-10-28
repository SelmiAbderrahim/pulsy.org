import { describe, expect, it } from "vitest";
import { focusNavigationStart } from "./focus-navigation";

function drawer(html: string) {
	const element = document.createElement("div");
	element.innerHTML = html;
	document.body.append(element);
	return element;
}

describe("focusNavigationStart", () => {
	it("focuses the link of the current page, not the first button Radix would pick", () => {
		const root = drawer('<nav><a href="/a">Monitors</a><a href="/b" aria-current="page">Incidents</a><button>Contact support</button></nav>');
		expect(focusNavigationStart(root)).toBe(true);
		expect(document.activeElement?.textContent).toBe("Incidents");
		root.remove();
	});
	it("falls back to the first destination when no page is current", () => {
		const root = drawer('<nav><a href="/a">Monitors</a><a href="/b">Incidents</a><button>Contact support</button></nav>');
		focusNavigationStart(root);
		expect(document.activeElement?.textContent).toBe("Monitors");
		root.remove();
	});
	it("leaves default focus alone when there is no navigation", () => {
		const root = drawer("<p>nothing</p>");
		expect(focusNavigationStart(root)).toBe(false);
		expect(focusNavigationStart(null)).toBe(false);
		root.remove();
	});
});
