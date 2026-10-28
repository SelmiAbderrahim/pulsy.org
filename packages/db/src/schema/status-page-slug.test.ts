import { describe, expect, it } from "vitest";
import { statusPageSlugSchema } from "./status-page-slug";
import { apiCreateUptimeStatusPage, apiUpdateUptimeStatusPage, apiResolveStatusPageBySlug } from "./validation";

describe("shared browser and API slug policy", () => {
	it.each(["Status-123", "  Status-123  ", "status-123"])("normalizes %j for create, update and resolve", slug => {
		expect(statusPageSlugSchema.parse(slug)).toBe("status-123");
		expect(apiCreateUptimeStatusPage.parse({ title: "Status", slug }).slug).toBe("status-123");
		expect(apiUpdateUptimeStatusPage.parse({ statusPageId: "p1", slug }).slug).toBe("status-123");
		expect(apiResolveStatusPageBySlug.parse({ userId: "u1", slug }).slug).toBe("status-123");
	});
	it.each(["Bad Slug--!!", "has space", "bad_slug", "-leading", "trailing-", "double--dash", "", "   ", "a".repeat(64), "é"])("rejects %j in browser and API", slug => {
		expect(statusPageSlugSchema.safeParse(slug).success).toBe(false);
		expect(apiCreateUptimeStatusPage.safeParse({ title: "Status", slug }).success).toBe(false);
		expect(apiUpdateUptimeStatusPage.safeParse({ statusPageId: "p1", slug }).success).toBe(false);
		expect(apiResolveStatusPageBySlug.safeParse({ userId: "u1", slug }).success).toBe(false);
	});
	it("applies the length limit after trimming", () => {
		expect(statusPageSlugSchema.parse(`  ${"A".repeat(63)}  `)).toBe("a".repeat(63));
	});
});
