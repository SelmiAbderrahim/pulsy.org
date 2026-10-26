import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	authRateLimitFromEnv,
	createIpRateLimiter,
	ipRateLimitFromEnv,
} from "./ip-rate-limit";

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

function mockReq(ip?: string): Request {
	return { ip, headers: {} } as unknown as Request;
}

describe("ipRateLimitFromEnv", () => {
	it("defaults when unset", () => {
		delete process.env.TRPC_RATE_LIMIT_PER_MIN;
		expect(ipRateLimitFromEnv()).toBe(300);
	});

	it("defaults when non-numeric", () => {
		process.env.TRPC_RATE_LIMIT_PER_MIN = "abc";
		expect(ipRateLimitFromEnv()).toBe(300);
	});

	it("defaults when zero or negative", () => {
		process.env.TRPC_RATE_LIMIT_PER_MIN = "-5";
		expect(ipRateLimitFromEnv()).toBe(300);
	});

	it("uses a valid positive value", () => {
		process.env.TRPC_RATE_LIMIT_PER_MIN = "42";
		expect(ipRateLimitFromEnv()).toBe(42);
	});
});

describe("authRateLimitFromEnv", () => {
	it("defaults when unset", () => {
		delete process.env.AUTH_RATE_LIMIT_PER_MIN;
		expect(authRateLimitFromEnv()).toBe(10);
	});

	it("defaults when non-numeric", () => {
		process.env.AUTH_RATE_LIMIT_PER_MIN = "abc";
		expect(authRateLimitFromEnv()).toBe(10);
	});

	it("defaults when zero or negative", () => {
		process.env.AUTH_RATE_LIMIT_PER_MIN = "-5";
		expect(authRateLimitFromEnv()).toBe(10);
	});

	it("uses a valid positive value", () => {
		process.env.AUTH_RATE_LIMIT_PER_MIN = "20";
		expect(authRateLimitFromEnv()).toBe(20);
	});
});

describe("createIpRateLimiter", () => {
	it("supports a surface-specific limited response without counting a request twice", () => {
		const limiter = createIpRateLimiter({ limit: 2, now: () => 0,
			onLimited: (res: Response) => { res.json({ outcome: "limited" }); },
		});
		const next = vi.fn();
		runOnce(limiter, mockReq("10.0.0.1"), next);
		runOnce(limiter, mockReq("10.0.0.1"), next);
		const { state } = runOnce(limiter, mockReq("10.0.0.1"), next);
		expect(next).toHaveBeenCalledTimes(2);
		expect(state).toMatchObject({ statusCode: 429, body: { outcome: "limited" }, headers: { "Retry-After": "60" } });
	});

	it("can reject new addresses at capacity while retaining existing windows and admitting expired buckets", () => {
		let ts = 0;
		const limiter = createIpRateLimiter({ limit: 2, maxBuckets: 1, failClosed: true, now: () => ts,
			onLimited: (res: Response) => { res.json({ outcome: "limited" }); },
		});
		const next = vi.fn();
		runOnce(limiter, mockReq("10.0.0.1"), next);
		expect(runOnce(limiter, mockReq("10.0.0.2"), next).state).toMatchObject({ statusCode: 429, body: { outcome: "limited" } });
		expect(runOnce(limiter, mockReq("10.0.0.1"), next).state.statusCode).toBe(0);
		expect(runOnce(limiter, mockReq("10.0.0.1"), next).state.statusCode).toBe(429);
		ts = 60_001;
		expect(runOnce(limiter, mockReq("10.0.0.2"), next).state.statusCode).toBe(0);
		expect(next).toHaveBeenCalledTimes(3);
	});

	it("allows up to the limit then 429s with Retry-After", () => {
		const limiter = createIpRateLimiter({ limit: 2, now: () => 1_000 });
		const next = vi.fn() as unknown as NextFunction;

		for (let i = 0; i < 2; i++) {
			const { state } = runOnce(limiter, mockReq("1.1.1.1"), next);
			expect(state.statusCode).toBe(0);
		}
		expect(next).toHaveBeenCalledTimes(2);

		const { state } = runOnce(limiter, mockReq("1.1.1.1"), next);
		expect(state.statusCode).toBe(429);
		expect(state.headers["Retry-After"]).toBe("60");
		expect(state.body).toEqual({ error: "rate_limited", retryAfter: 60 });
		expect(next).toHaveBeenCalledTimes(2);
	});

	it("sets X-RateLimit-* headers", () => {
		const limiter = createIpRateLimiter({ limit: 5, now: () => 60_000 });
		const next = vi.fn() as unknown as NextFunction;
		const { state } = runOnce(limiter, mockReq("2.2.2.2"), next);

		expect(state.headers["X-RateLimit-Limit"]).toBe("5");
		expect(state.headers["X-RateLimit-Remaining"]).toBe("4");
		expect(state.headers["X-RateLimit-Reset"]).toBe(String((60_000 + 60_000) / 1000));
	});

	it("keeps distinct IPs in independent windows", () => {
		const limiter = createIpRateLimiter({ limit: 1, now: () => 0 });
		const next = vi.fn() as unknown as NextFunction;

		expect(runOnce(limiter, mockReq("3.3.3.3"), next).state.statusCode).toBe(0);
		expect(runOnce(limiter, mockReq("4.4.4.4"), next).state.statusCode).toBe(0);
		expect(runOnce(limiter, mockReq("3.3.3.3"), next).state.statusCode).toBe(429);
	});

	it("resets the window after it expires", () => {
		let ts = 0;
		const limiter = createIpRateLimiter({ limit: 1, now: () => ts });
		const next = vi.fn() as unknown as NextFunction;

		expect(runOnce(limiter, mockReq("5.5.5.5"), next).state.statusCode).toBe(0);
		expect(runOnce(limiter, mockReq("5.5.5.5"), next).state.statusCode).toBe(429);

		ts = 61_000; // past the 60s window
		expect(runOnce(limiter, mockReq("5.5.5.5"), next).state.statusCode).toBe(0);
	});

	it("buckets requests without an ip under 'unknown'", () => {
		const limiter = createIpRateLimiter({ limit: 1, now: () => 0 });
		const next = vi.fn() as unknown as NextFunction;

		expect(runOnce(limiter, mockReq(undefined), next).state.statusCode).toBe(0);
		expect(runOnce(limiter, mockReq(undefined), next).state.statusCode).toBe(429);
	});

	it("evicts expired buckets when the map is full", () => {
		let ts = 0;
		const limiter = createIpRateLimiter({
			limit: 1,
			maxBuckets: 2,
			now: () => ts,
		});
		const next = vi.fn() as unknown as NextFunction;

		runOnce(limiter, mockReq("6.6.6.1"), next);
		runOnce(limiter, mockReq("6.6.6.2"), next);

		// Both existing windows expire; a new IP evicts them and gets a bucket.
		ts = 61_000;
		const { state } = runOnce(limiter, mockReq("6.6.6.3"), next);
		expect(state.statusCode).toBe(0);
		expect(state.headers["X-RateLimit-Remaining"]).toBe("0");
		// The new bucket is live: a second call within the window is limited.
		expect(runOnce(limiter, mockReq("6.6.6.3"), next).state.statusCode).toBe(429);
	});

	it("fails open for new IPs when the map is full of live windows", () => {
		const limiter = createIpRateLimiter({
			limit: 1,
			maxBuckets: 2,
			now: () => 0,
		});
		const next = vi.fn() as unknown as NextFunction;

		runOnce(limiter, mockReq("7.7.7.1"), next);
		runOnce(limiter, mockReq("7.7.7.2"), next);

		// Map full, nothing expired: the overflow IP passes through unlimited
		// (no X-RateLimit headers, no bucket created).
		const { state } = runOnce(limiter, mockReq("7.7.7.3"), next);
		expect(state.statusCode).toBe(0);
		expect(state.headers["X-RateLimit-Limit"]).toBeUndefined();
		// Existing buckets keep enforcing.
		expect(runOnce(limiter, mockReq("7.7.7.1"), next).state.statusCode).toBe(429);
	});

	it("uses the env-derived default limit when none is given", () => {
		process.env.TRPC_RATE_LIMIT_PER_MIN = "1";
		const limiter = createIpRateLimiter({ now: () => 0 });
		const next = vi.fn() as unknown as NextFunction;

		expect(runOnce(limiter, mockReq("8.8.8.8"), next).state.statusCode).toBe(0);
		expect(runOnce(limiter, mockReq("8.8.8.8"), next).state.statusCode).toBe(429);
	});
});

function runOnce(
	limiter: ReturnType<typeof createIpRateLimiter>,
	req: Request,
	next: NextFunction,
) {
	const { res, state } = mockRes();
	limiter(req, res, next);
	return { res, state };
}
