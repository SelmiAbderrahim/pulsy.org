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
	});

	it.each([
		["example.com", "example.com"],
		[" api.example.com/health ", "api.example.com"],
		["example.com:8443/path", "example.com"],
		["localhost:8080/health", "localhost"],
	])("normalizes the accepted monitor address %s before extracting its name", (input, expected) => {
		expect(extractNameFromUrl(input)).toBe(expected);
	});

	it.each(["ftp://example.com/file", "https://user:secret@example.com", "https://example.com/a b"])("does not name an unsupported monitor address: %s", (input) => {
		expect(extractNameFromUrl(input)).toBe("");
	});
});
