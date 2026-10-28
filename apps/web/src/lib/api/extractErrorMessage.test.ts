import i18n from "i18next";
import { describe, expect, it } from "vitest";
import { extractFieldErrors, extractErrorMessage } from "./extractErrorMessage";

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

describe("safe API errors", () => {
	it.each(['[{"code":"invalid_string","message":"secret","path":["slug"]}]', '{"issues":["secret"]}', "Error\n    at internal.ts:1", "ZodError: private issues", "x".repeat(501)])("does not render serialized issues or stack details", message => {
		expect(extractErrorMessage(new Error(message), "Localized fallback")).toBe("Localized fallback");
	});
	it("uses the caller's localized validation fallback even if message looks safe", () => {
		expect(extractErrorMessage({ message: "Review fields", data: { validationErrors: { fieldErrors: {}, formErrors: ["Invalid"] } } }, "Localized fallback")).toBe("Localized fallback");
	});
	it.each([["TIMEOUT", 408], ["BAD_GATEWAY", 502], ["SERVICE_UNAVAILABLE", 503]])("treats %s (%i) as a server problem and hides its message", (code, httpStatus) => {
		expect(extractErrorMessage({ message: "upstream detail", data: { code, httpStatus } }, "Fallback")).toBe(i18n.t("common:states.serverProblem"));
	});
	it("masks internal failure details and preserves useful non-validation errors", () => {
		expect(extractErrorMessage({ message: "DB credentials", data: { code: "INTERNAL_SERVER_ERROR" } }, "Fallback")).toBe(i18n.t("common:states.serverProblem"));
		expect(extractErrorMessage({ message: "Reload before saving", data: { code: "CONFLICT", validationErrors: null } }, "Fallback")).toBe("Reload before saving");
	});
});


describe("structured field mapping", () => {
  it("maps only known fields with safe human-readable messages", () => {
    const error = { data: { validationErrors: { fieldErrors: { slug: ["Choose another slug"], title: ['[{"secret":"value"}]', "Title required"], private: ["Do not show"] }, formErrors: ["Review fields"] } } };
    expect(extractFieldErrors(error, ["slug", "title", "description"] as const)).toEqual({ slug: "Choose another slug", title: "Title required" });
  });
  it.each([null, undefined, "error", {}, { data: null }, { data: { validationErrors: {} } }, { data: { validationErrors: { fieldErrors: { slug: 123, title: [null, {}, ""] } } } }])("ignores malformed data", error => {
    expect(extractFieldErrors(error, ["slug", "title"])).toEqual({});
  });
});
