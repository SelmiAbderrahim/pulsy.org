import type { NextFunction, Request, Response } from "express";

// ---------------------------------------------------------------------------
// Per-IP fixed-window rate limiter for browser-facing surfaces (`/api/trpc`,
// including the public status/share procedures).
//
// In-memory and single-replica by design — the same model as the per-key
// limiter in `api/rate-limit.ts`. `app.set("trust proxy", 1)` in index.ts
// makes `req.ip` the real client address behind the nginx proxy.
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT_PER_MIN = 300;
const DEFAULT_AUTH_LIMIT_PER_MIN = 10;
const WINDOW_MS = 60_000;
// Bucket-map cap so a spoofed-source flood cannot grow memory unboundedly.
const MAX_BUCKETS = 10_000;

interface Bucket {
	count: number;
	/** Epoch ms at which the window resets. */
	resetAt: number;
}

/** Read the per-minute limit from env, falling back to the default. */
export function ipRateLimitFromEnv(): number {
	const raw = process.env.TRPC_RATE_LIMIT_PER_MIN;
	if (!raw) {
		return DEFAULT_LIMIT_PER_MIN;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isInteger(parsed) && parsed > 0
		? parsed
		: DEFAULT_LIMIT_PER_MIN;
}

/**
 * Read the per-minute limit for `/api/auth/*` from env. Stricter default than
 * the general tRPC limiter — sign-in/sign-up/forgot-password are brute-force
 * and enumeration targets.
 */
export function authRateLimitFromEnv(): number {
	const raw = process.env.AUTH_RATE_LIMIT_PER_MIN;
	if (!raw) {
		return DEFAULT_AUTH_LIMIT_PER_MIN;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isInteger(parsed) && parsed > 0
		? parsed
		: DEFAULT_AUTH_LIMIT_PER_MIN;
}

export interface IpRateLimiterOptions {
	limit?: number;
	windowMs?: number;
	maxBuckets?: number;
	/** Injectable clock for deterministic tests. */
	now?: () => number;
}

/**
 * Create a fixed-window limiter middleware keyed by `req.ip`. Sets
 * `X-RateLimit-*` headers and, on breach, `429` + `Retry-After` with a plain
 * JSON body (this runs before tRPC, so there is no procedure-level i18n).
 */
export function createIpRateLimiter(opts: IpRateLimiterOptions = {}) {
	const limit = opts.limit ?? ipRateLimitFromEnv();
	const windowMs = opts.windowMs ?? WINDOW_MS;
	const maxBuckets = opts.maxBuckets ?? MAX_BUCKETS;
	const now = opts.now ?? (() => Date.now());
	const buckets = new Map<string, Bucket>();

	return (req: Request, res: Response, next: NextFunction): void => {
		const id = req.ip ?? "unknown";
		const ts = now();

		if (!buckets.has(id) && buckets.size >= maxBuckets) {
			// Drop expired windows first; if the map is still full, fail open for
			// this request rather than evicting a live window.
			for (const [key, bucket] of buckets) {
				if (bucket.resetAt <= ts) {
					buckets.delete(key);
				}
			}
			if (buckets.size >= maxBuckets) {
				next();
				return;
			}
		}

		let bucket = buckets.get(id);
		if (!bucket || bucket.resetAt <= ts) {
			bucket = { count: 0, resetAt: ts + windowMs };
			buckets.set(id, bucket);
		}
		bucket.count += 1;

		res.setHeader("X-RateLimit-Limit", String(limit));
		res.setHeader(
			"X-RateLimit-Remaining",
			String(Math.max(0, limit - bucket.count)),
		);
		res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

		if (bucket.count > limit) {
			const retryAfter = Math.ceil((bucket.resetAt - ts) / 1000);
			res.setHeader("Retry-After", String(retryAfter));
			res.status(429).json({ error: "rate_limited", retryAfter });
			return;
		}

		next();
	};
}
