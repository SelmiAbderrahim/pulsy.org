import { describe, expect, it } from "vitest";
import { addTagEntry, hasTagSeparator, MAX_MONITOR_TAGS, MAX_TAG_LENGTH, splitPendingTagInput } from "./tag-input";

describe("addTagEntry", () => {
	it("adds a plain tag trimmed", () => {
		expect(addTagEntry([], "  prod  ")).toMatchObject({ tags: ["prod"], added: ["prod"], split: false, duplicates: 0 });
	});

	it.each([",", "،", "，"])("splits on the %s separator so no tag ever contains a comma", separator => {
		const result = addTagEntry([], `api${separator} web ${separator}db`);
		expect(result.tags).toEqual(["api", "web", "db"]);
		expect(result.split).toBe(true);
		expect(result.tags.some(tag => /[,،，]/.test(tag))).toBe(false);
	});

	it("drops empty parts and de-duplicates against the list and within the entry", () => {
		const result = addTagEntry(["prod"], "prod,, a, a ,b");
		expect(result.tags).toEqual(["prod", "a", "b"]);
		expect(result.added).toEqual(["a", "b"]);
		expect(result.duplicates).toBe(2);
	});

	it("does not rewrite stored tags", () => {
		expect(addTagEntry(["legacy, tag"], "new").tags).toEqual(["legacy, tag", "new"]);
	});

	it("stops at the tag limit and reports the overflow", () => {
		const full = Array.from({ length: MAX_MONITOR_TAGS - 1 }, (_, i) => `t${i}`);
		const result = addTagEntry(full, "x,y,z");
		expect(result.tags).toHaveLength(MAX_MONITOR_TAGS);
		expect(result.added).toEqual(["x"]);
		expect(result.overflow).toBe(2);
	});

	it("truncates an over-long tag", () => {
		expect(addTagEntry([], "a".repeat(MAX_TAG_LENGTH + 20)).tags[0]).toHaveLength(MAX_TAG_LENGTH);
	});

	it("ignores blank input", () => {
		expect(addTagEntry(["a"], "  , ").added).toEqual([]);
	});
});

describe("typed input", () => {
	it("detects separators in all three scripts", () => {
		expect(hasTagSeparator("a,b")).toBe(true);
		expect(hasTagSeparator("a،b")).toBe(true);
		expect(hasTagSeparator("a，b")).toBe(true);
		expect(hasTagSeparator("ab")).toBe(false);
	});

	it("keeps the text after the last separator as the pending entry", () => {
		expect(splitPendingTagInput("api,web,d")).toEqual({ complete: "api,web", pending: "d" });
		expect(splitPendingTagInput("api,")).toEqual({ complete: "api", pending: "" });
	});
});
