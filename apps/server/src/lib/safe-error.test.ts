import { describe, expect, it } from "vitest";
import { safeErrorSummary } from "./safe-error";

describe("safeErrorSummary", () => {
	it("does not expose an error message or stack", () => {
		const error = new Error("secret-token-value");
		expect(safeErrorSummary(error)).toBe("Error");
		expect(safeErrorSummary(error)).not.toContain("secret-token-value");
	});

	it("retains a safe transport code", () => {
		const error = Object.assign(new Error("private host"), {
			code: "ECONNREFUSED",
		});
		expect(safeErrorSummary(error)).toBe("Error (ECONNREFUSED)");
	});

	it("handles arbitrary thrown values", () => {
		expect(safeErrorSummary("secret-token-value")).toBe("Unknown error");
	});
});
