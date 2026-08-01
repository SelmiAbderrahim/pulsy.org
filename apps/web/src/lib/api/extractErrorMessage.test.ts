import { describe, expect, it } from "vitest";
import { extractErrorMessage } from "./extractErrorMessage";

describe("extractErrorMessage()", () => {
	const fallback = "Something went wrong";

	it("returns the message from an Error instance", () => {
		expect(extractErrorMessage(new Error("boom"), fallback)).toBe("boom");
	});

	it("falls back when an Error has a blank message", () => {
		expect(extractErrorMessage(new Error("   "), fallback)).toBe(fallback);
		expect(extractErrorMessage(new Error(""), fallback)).toBe(fallback);
	});

	it("reads a string `message` from a plain object", () => {
		expect(extractErrorMessage({ message: "plain object error" }, fallback)).toBe(
			"plain object error",
		);
	});

	it("falls back when the object message is blank", () => {
		expect(extractErrorMessage({ message: "   " }, fallback)).toBe(fallback);
	});

	it("falls back when the object message is not a string", () => {
		expect(extractErrorMessage({ message: 42 }, fallback)).toBe(fallback);
	});

	it("falls back when there is no `message` property", () => {
		expect(extractErrorMessage({ code: "X" }, fallback)).toBe(fallback);
	});

	it("falls back for null, undefined, and primitive errors", () => {
		expect(extractErrorMessage(null, fallback)).toBe(fallback);
		expect(extractErrorMessage(undefined, fallback)).toBe(fallback);
		expect(extractErrorMessage("string error", fallback)).toBe(fallback);
		expect(extractErrorMessage(123, fallback)).toBe(fallback);
	});
});
