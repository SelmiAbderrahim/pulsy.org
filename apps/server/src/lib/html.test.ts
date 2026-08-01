import { describe, expect, it } from "vitest";
import { escapeHtml } from "./html";

describe("escapeHtml", () => {
	it("escapes every HTML-significant character", () => {
		expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
	});

	it("escapes ampersands first so existing entities are not double-decoded", () => {
		// & is replaced before <,>,",' so the output is unambiguous.
		expect(escapeHtml("a & b < c")).toBe("a &amp; b &lt; c");
	});

	it("neutralizes a script/img injection payload", () => {
		expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
			"&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
		);
		expect(escapeHtml("<script>alert(1)</script>")).not.toContain("<script>");
	});

	it("leaves a benign string untouched", () => {
		expect(escapeHtml("Prod API monitor")).toBe("Prod API monitor");
	});
});
