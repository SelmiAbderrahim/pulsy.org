import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter, rateLimitFromEnv } from "./rate-limit";

const originalEnv = { ...process.env };

afterEach(() => {
	process.env = { ...originalEnv };
});

function mockRes() {
	const state = {
		statusCode: 0,
		body: undefined as unknown,
		headers: {} as Record<string, string>,
	};
	const res = {
		setHeader(name: string, value: string) {
			state.headers[name] = value;
		},
		status(code: number) {
			state.statusCode = code;
			return res;
		},
		json(body: unknown) {
			state.body = body;
			return res;
		},
	} as unknown as Response;
	return { res, state };
}

function mockReq(overrides: Partial<Request> = {}): Request {
	return { headers: {}, ...overrides } as unknown as Request;
}

describe("rateLimitFromEnv", () => {
	it("defaults when unset", () => {
		delete process.env.API_RATE_LIMIT_PER_MIN;
		expect(rateLimitFromEnv()).toBe(60);
	});

	it("defaults when non-numeric", () => {
		process.env.API_RATE_LIMIT_PER_MIN = "abc";
		expect(rateLimitFromEnv()).toBe(60);
	});

	it("defaults when zero or negative", () => {
		process.env.API_RATE_LIMIT_PER_MIN = "0";
		expect(rateLimitFromEnv()).toBe(60);
	});

	it("uses a valid positive value", () => {
		process.env.API_RATE_LIMIT_PER_MIN = "10";
		expect(rateLimitFromEnv()).toBe(10);
	});
});

describe("createRateLimiter", () => {
	it("allows up to the limit then 429s with Retry-After", () => {
		let now = 1_000_000;
		const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => now });
		const req = mockReq({ apiKeyId: "key_1" } as Partial<Request>);

		const first = mockRes();
		const n1 = vi.fn();
		limiter(req, first.res, n1 as NextFunction);
		expect(n1).toHaveBeenCalledOnce();
		expect(first.state.headers["X-RateLimit-Remaining"]).toBe("1");

		const second = mockRes();
		const n2 = vi.fn();
		limiter(req, second.res, n2 as NextFunction);
		expect(n2).toHaveBeenCalledOnce();
		expect(second.state.headers["X-RateLimit-Remaining"]).toBe("0");

		const third = mockRes();
		const n3 = vi.fn();
		limiter(req, third.res, n3 as NextFunction);
		expect(n3).not.toHaveBeenCalled();
		expect(third.state.statusCode).toBe(429);
		expect(third.state.headers["Retry-After"]).toBe("60");
		expect((third.state.body as { error: { code: string } }).error.code).toBe(
			"rate_limited",
		);
	});

	it("starts a fresh window after the previous one elapses", () => {
		let now = 1_000_000;
		const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now });
		const req = mockReq({ apiKeyId: "key_2" } as Partial<Request>);

		const a = mockRes();
		const na = vi.fn();
		limiter(req, a.res, na as NextFunction);
		expect(na).toHaveBeenCalledOnce();

		// Same window → blocked.
		const b = mockRes();
		const nb = vi.fn();
		limiter(req, b.res, nb as NextFunction);
		expect(b.state.statusCode).toBe(429);

		// Advance past the window → allowed again.
		now += 2_000;
		const c = mockRes();
		const nc = vi.fn();
		limiter(req, c.res, nc as NextFunction);
		expect(nc).toHaveBeenCalledOnce();
	});

	it("buckets per key, falling back to user id then anonymous", () => {
		const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 5 });

		// Key A and key B are independent buckets.
		const a1 = mockRes();
		const na1 = vi.fn();
		limiter(mockReq({ apiKeyId: "A" } as Partial<Request>), a1.res, na1 as NextFunction);
		expect(na1).toHaveBeenCalledOnce();

		const b1 = mockRes();
		const nb1 = vi.fn();
		limiter(
			mockReq({ apiUser: { id: "B" } } as Partial<Request>),
			b1.res,
			nb1 as NextFunction,
		);
		expect(nb1).toHaveBeenCalledOnce();

		// No key and no user → the shared "anonymous" bucket.
		const anon1 = mockRes();
		const nAnon1 = vi.fn();
		limiter(mockReq(), anon1.res, nAnon1 as NextFunction);
		expect(nAnon1).toHaveBeenCalledOnce();
		const anon2 = mockRes();
		const nAnon2 = vi.fn();
		limiter(mockReq(), anon2.res, nAnon2 as NextFunction);
		expect(anon2.state.statusCode).toBe(429);
	});

	it("reads the limit from env when not provided", () => {
		process.env.API_RATE_LIMIT_PER_MIN = "1";
		const limiter = createRateLimiter({ now: () => 0 });
		const req = mockReq({ apiKeyId: "envkey" } as Partial<Request>);
		const first = mockRes();
		limiter(req, first.res, vi.fn() as NextFunction);
		expect(first.state.headers["X-RateLimit-Limit"]).toBe("1");
		const second = mockRes();
		limiter(req, second.res, vi.fn() as NextFunction);
		expect(second.state.statusCode).toBe(429);
	});
});
