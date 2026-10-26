import { afterEach, describe, expect, it, vi } from "vitest";
import { getTranslator } from "../lib/i18n";
import { authRateLimitPolicy, authRateLimitResponse } from "./rate-limit-response";

// better-auth throttling responses: every 429 gets Retry-After + RateLimit-*
// headers and a localized JSON message with no framework internals; every other
// response passes through untouched.

const request = (path: string, acceptLanguage?: string) => new Request(`http://localhost:4000/api/auth${path}`, { method: "POST", headers: acceptLanguage ? { "Accept-Language": acceptLanguage } : {} });
const throttled = (headers: Record<string, string> = {}, body: unknown = { message: "Too many requests. Please try again later." }) => new Response(JSON.stringify(body), { status: 429, headers: { "Content-Type": "application/json", ...headers } });

describe("authRateLimitPolicy", () => {
	it.each([
		["/sign-in/email", { window: 10, max: 3 }],
		["/sign-up/email", { window: 10, max: 3 }],
		["/change-password", { window: 10, max: 3 }],
		["/change-email", { window: 10, max: 3 }],
		["/request-password-reset", { window: 60, max: 3 }],
		["/send-verification-email", { window: 60, max: 3 }],
		["/forget-password/email-otp", { window: 60, max: 3 }],
		["/request-password-reset/", { window: 60, max: 3 }],
		["/get-session", { window: 10, max: 100 }],
		["/sign-out", { window: 10, max: 100 }],
	])("%s -> %j", (path, expected) => {
		expect(authRateLimitPolicy(request(path))).toEqual(expected);
	});

	it("falls back to the default limit for a malformed escape instead of throwing", () => {
		expect(authRateLimitPolicy(request("/%E0%A4%A"))).toEqual({ window: 10, max: 100 });
	});

	it("is not bypassed by percent-encoding the path", () => {
		expect(authRateLimitPolicy(request("/sign%2Din/email"))).toEqual({ window: 10, max: 3 });
		expect(authRateLimitPolicy(request("/%73ign-in/email"))).toEqual({ window: 10, max: 3 });
	});
});

describe("authRateLimitResponse", () => {
	afterEach(() => vi.restoreAllMocks());

	it("passes non-429 responses through unchanged (same object)", () => {
		for (const status of [200, 201, 302, 400, 401, 403, 500]) {
			const original = new Response("{}", { status });
			expect(authRateLimitResponse(request("/sign-in/email"), original)).toBe(original);
		}
	});

	it("adds Retry-After and RateLimit headers from the endpoint policy", async () => {
		const response = authRateLimitResponse(request("/sign-in/email"), throttled());
		expect(response.status).toBe(429);
		expect(response.headers.get("Retry-After")).toBe("10");
		expect(response.headers.get("RateLimit-Limit")).toBe("3");
		expect(response.headers.get("RateLimit-Remaining")).toBe("0");
		expect(response.headers.get("RateLimit-Reset")).toBe("10");
		expect(response.headers.get("RateLimit-Policy")).toBe("3;w=10");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
	});

	it("uses the 60 second window for password-reset throttling", () => {
		const response = authRateLimitResponse(request("/request-password-reset"), throttled());
		expect(response.headers.get("Retry-After")).toBe("60");
		expect(response.headers.get("RateLimit-Policy")).toBe("3;w=60");
	});

	it.each([
		[{ "X-Retry-After": "7" }, "7"],
		[{ "Retry-After": "12" }, "12"],
		[{ "X-Retry-After": "4.2" }, "5"],
		[{ "X-Retry-After": "0" }, "10"],
		[{ "X-Retry-After": "-3" }, "10"],
		[{ "X-Retry-After": "soon" }, "10"],
		[{}, "10"],
	])("derives the retry delay from %j as %s", (headers, expected) => {
		const response = authRateLimitResponse(request("/sign-in/email"), throttled(headers));
		expect(response.headers.get("Retry-After")).toBe(expected);
		expect(response.headers.get("RateLimit-Reset")).toBe(expected);
	});

	it.each([
		["en", "en"], ["ar", "ar"], ["fr", "fr"], ["de", "de"], ["es", "es"],
		["fr-CA,fr;q=0.9,en;q=0.5", "fr"],
		["de-DE", "de"],
		["es-MX,es;q=0.8", "es"],
		["ar-EG", "ar"],
		["ja,en;q=0.2", "en"],
		["", "en"],
		[undefined, "en"],
	] as const)("localizes the body for Accept-Language %j", async (header, language) => {
		const body = await authRateLimitResponse(request("/sign-in/email", header), throttled({ "X-Retry-After": "7" })).json() as { message: string };
		expect(body.message).toBe(getTranslator(language)("errors.rateLimited", { retryAfter: 7 }));
		expect(body.message).toContain("7");
		expect(body.message).not.toContain("{{");
	});

	it("each locale's message differs from English (no untranslated fallback)", async () => {
		const english = getTranslator("en")("errors.rateLimited", { retryAfter: 7 });
		for (const language of ["ar", "fr", "de", "es"] as const) expect(getTranslator(language)("errors.rateLimited", { retryAfter: 7 })).not.toBe(english);
	});

	it("replaces the upstream body: no stack trace, error code or framework message leaks", async () => {
		const leaky = { message: "Too many requests", code: "RATE_LIMITED", stack: "Error: boom\n    at /app/node_modules/better-auth/dist/index.js:1:1", cause: { path: "/app/apps/server/src/auth/auth.ts" } };
		const response = authRateLimitResponse(request("/sign-in/email"), throttled({ "X-Retry-After": "3" }, leaky));
		const text = await response.text();
		expect(Object.keys(JSON.parse(text))).toEqual(["message"]);
		for (const needle of ["stack", "node_modules", "/app/", "better-auth", "RATE_LIMITED", "boom"]) expect(text).not.toContain(needle);
	});

	it("drops a stale Content-Length so the replaced body is not truncated", async () => {
		const response = authRateLimitResponse(request("/sign-in/email"), throttled({ "Content-Length": "5" }));
		expect(response.headers.get("Content-Length")).toBeNull();
		expect((await response.json() as { message: string }).message.length).toBeGreaterThan(5);
	});

	it("preserves unrelated headers such as Set-Cookie and Vary", () => {
		const response = authRateLimitResponse(request("/sign-in/email"), throttled({ Vary: "Origin", "X-Custom": "kept" }));
		expect(response.headers.get("Vary")).toBe("Origin");
		expect(response.headers.get("X-Custom")).toBe("kept");
	});
});
