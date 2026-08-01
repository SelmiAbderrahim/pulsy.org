import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn()", () => {
	it("joins plain class names", () => {
		expect(cn("a", "b", "c")).toBe("a b c");
	});

	it("drops falsy / conditional values", () => {
		const active = false;
		const disabled = true;
		expect(cn("base", active && "active", disabled && "disabled")).toBe(
			"base disabled",
		);
	});

	it("supports object and array syntax (clsx)", () => {
		expect(cn(["a", "b"], { c: true, d: false })).toBe("a b c");
	});

	it("merges conflicting Tailwind utilities, last one wins (tailwind-merge)", () => {
		expect(cn("p-2", "p-4")).toBe("p-4");
		expect(cn("text-start", "text-end")).toBe("text-end");
	});

	it("keeps non-conflicting Tailwind utilities", () => {
		expect(cn("px-2", "py-4")).toBe("px-2 py-4");
	});

	it("returns an empty string for no/empty input", () => {
		expect(cn()).toBe("");
		expect(cn(false, null, undefined, "")).toBe("");
	});
});
