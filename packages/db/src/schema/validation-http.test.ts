import { describe, expect, it } from "vitest";
import { apiHttpAssertion, apiHttpAssertions, apiHttpRequest, httpPathTokens } from "./validation-http";
import { apiCreateUptimeMonitor } from "./validation";

const create = (patch: Record<string, unknown> = {}) => apiCreateUptimeMonitor.safeParse({ name: "API", url: "https://example.com/health", ...patch });

describe("typed JSON assertions keep 0, false, null and empty distinct", () => {
	it.each([0, false, null, "", "0", [], [0, false, null, ""]])("accepts %j as an exact expected value", (expected) => {
		expect(apiHttpAssertion.safeParse({ type: "json", path: "$.value", op: "equals", value: expected }).success).toBe(true);
		expect(apiHttpAssertion.safeParse({ type: "json", path: "$.value", op: "not_equals", value: expected }).success).toBe(true);
	});
	it("does not coerce: the parsed rule hands back exactly what was entered", () => {
		for (const expected of [0, false, null, ""]) {
			const parsed = apiHttpAssertion.parse({ type: "json", path: "$.value", op: "equals", value: expected });
			expect((parsed as { value: unknown }).value).toBe(expected);
		}
	});
	it("requires a value for equality but not for exists, and numbers for ordering", () => {
		expect(apiHttpAssertion.safeParse({ type: "json", path: "$.a", op: "exists" }).success).toBe(true);
		expect(apiHttpAssertion.safeParse({ type: "json", path: "$.a", op: "equals" }).success).toBe(false);
		expect(apiHttpAssertion.safeParse({ type: "json", path: "$.a", op: "gt", value: "5" }).success).toBe(false);
		expect(apiHttpAssertion.safeParse({ type: "json", path: "$.a", op: "gte", value: 0 }).success).toBe(true);
		expect(apiHttpAssertion.safeParse({ type: "json", path: "$.a", op: "lt", value: Number.NaN }).success).toBe(false);
		expect(apiHttpAssertion.safeParse({ type: "json", path: "$.a", op: "lt", value: Number.POSITIVE_INFINITY }).success).toBe(false);
	});
	it.each(["$", "$.a", "$.a.b_c", "$.items[0]", "$.items[10].name", "$[3]"])("accepts the path %s", (path) => {
		expect(httpPathTokens(path)).not.toBeNull();
	});
	it.each(["", "a.b", "$..a", "$.a[01]", "$.a[-1]", "$.a[*]", "$.a b", "$.__proto__", "$.a.constructor", "$.prototype", `$.${"a".repeat(260)}`, "$.a[100000]", "$['a']"])("rejects the unsupported or dangerous path %j", (path) => {
		expect(httpPathTokens(path)).toBeNull();
		expect(apiHttpAssertion.safeParse({ type: "json", path, op: "exists" }).success).toBe(false);
	});
	it("bounds the rule count and the size of a value list", () => {
		expect(apiHttpAssertions.safeParse(Array.from({ length: 20 }, () => ({ type: "body_contains", value: "ok" }))).success).toBe(true);
		expect(apiHttpAssertions.safeParse(Array.from({ length: 21 }, () => ({ type: "body_contains", value: "ok" }))).success).toBe(false);
		expect(apiHttpAssertion.safeParse({ type: "json", path: "$.a", op: "equals", value: Array.from({ length: 51 }, () => 1) }).success).toBe(false);
		expect(apiHttpAssertion.safeParse({ type: "body_contains", value: "" }).success).toBe(false);
	});
});

describe("request configuration limits", () => {
	it("rejects hop-by-hop headers, duplicate names, CR/LF injection and auth that collides with an Authorization header", () => {
		const bad = (headers: { name: string; value: string }[], extra: Record<string, unknown> = {}) => apiHttpRequest.safeParse({ headers, ...extra }).success;
		expect(bad([{ name: "Host", value: "evil.example" }])).toBe(false);
		expect(bad([{ name: "X-A", value: "1" }, { name: "x-a", value: "2" }])).toBe(false);
		expect(bad([{ name: "X-A", value: "ok\r\nInjected: 1" }])).toBe(false);
		expect(bad([{ name: "Authorization", value: "x" }], { auth: { type: "bearer", token: "t" } })).toBe(false);
		expect(bad([{ name: "X-A", value: "1" }])).toBe(true);
	});
	it("requires a syntactically valid, bounded JSON body when the content type says JSON", () => {
		expect(apiHttpRequest.safeParse({ headers: [], body: "{not json", contentType: "application/json" }).success).toBe(false);
		expect(apiHttpRequest.safeParse({ headers: [], body: '{"ok":true}', contentType: "application/json" }).success).toBe(true);
		expect(apiHttpRequest.safeParse({ headers: [], body: "plain text", contentType: "text/plain" }).success).toBe(true);
		expect(apiHttpRequest.safeParse({ headers: [], body: "x".repeat(65537) }).success).toBe(false);
		const deep = `${"[".repeat(40)}${"]".repeat(40)}`;
		expect(apiHttpRequest.safeParse({ headers: [], body: deep, contentType: "application/json" }).success).toBe(false);
	});
});

describe("monitor create input: schemes, hosts, finite bounds", () => {
	it("normalizes a bare hostname to an HTTPS destination", () => {
		expect(apiCreateUptimeMonitor.parse({ name: "API", url: "example.com" }).url).toBe("https://example.com/");
	});
	it.each(["ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "data:text/plain,hi", "gopher://example.com", "//example.com", "http://", "https://user:pass@example.com/"])("rejects the destination %s", (url) => {
		expect(create({ url }).success).toBe(false);
	});
	it.each(["http://example.com", "https://example.com:8443/health?x=1", "https://[2001:db8::1]/", "https://münchen.example/"])("accepts the destination %s", (url) => {
		expect(create({ url }).success).toBe(true);
	});
	it.each([[1000, true], [999, false], [60000, true], [60001, false], [10000.5, false], [Number.NaN, false], [Number.POSITIVE_INFINITY, false], ["10000", false]])("timeout %j → %s", (timeout, ok) => {
		expect(create({ timeout }).success).toBe(ok);
	});
	it.each([[99, false], [100, true], [599, true], [600, false], [200.5, false], [Number.NaN, false]])("expected status %j → %s", (expectedStatus, ok) => {
		expect(create({ expectedStatus }).success).toBe(ok);
	});
	it.each([[0, false], [1, true], [10, true], [11, false], [1.5, false]])("failure threshold %j → %s", (failureThreshold, ok) => {
		expect(create({ failureThreshold }).success).toBe(ok);
	});
	it.each([[30, true], [60, true], [45, false], [0, false], [86400, false]])("interval %j → %s", (interval, ok) => {
		expect(create({ interval }).success).toBe(ok);
	});
	it("allows 10 tags of at most 50 characters and no more", () => {
		expect(create({ tags: Array.from({ length: 10 }, (_, i) => `t${i}`) }).success).toBe(true);
		expect(create({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }).success).toBe(false);
		expect(create({ tags: ["x".repeat(51)] }).success).toBe(false);
		expect(create({ tags: [""] }).success).toBe(false);
	});
});
