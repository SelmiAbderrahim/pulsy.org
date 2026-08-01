import { describe, expect, it } from "vitest";
import { extractNameFromUrl } from "./extract-name";

describe("extractNameFromUrl()", () => {
	it("returns the hostname for a valid URL", () => {
		expect(extractNameFromUrl("https://api.example.com/health")).toBe(
			"api.example.com",
		);
		expect(extractNameFromUrl("http://example.com")).toBe("example.com");
		expect(extractNameFromUrl("https://example.com:8443/path")).toBe(
			"example.com",
		);
	});

	it("returns an empty string for an invalid URL", () => {
		expect(extractNameFromUrl("not a url")).toBe("");
		expect(extractNameFromUrl("")).toBe("");
		expect(extractNameFromUrl("example.com")).toBe("");
	});
});
