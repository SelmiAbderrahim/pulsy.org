// Per-key fixed-window rate limiter for the public REST API.
//
// In-memory and therefore scoped to a single server replica — Pulsy deploys as
// one server process, so this is sufficient; a horizontally-scaled deployment
// would need a shared store (Redis). Each limiter instance owns its own bucket
// map, so the `/api/v1` router factory yields an isolated limiter per app.

import type { NextFunction, Request, Response } from "express";
import { getRequestTranslator, sendApiError } from "./http";
import "./types";

const DEFAULT_LIMIT_PER_MIN = 60;
const WINDOW_MS = 60_000;

interface Bucket {
	count: number;
	/** Epoch ms at which the window resets. */
	resetAt: number;
}

/** Read the per-minute limit from env, falling back to the default. */
export function rateLimitFromEnv(): number {
	const raw = process.env.API_RATE_LIMIT_PER_MIN;
	if (!raw) {
		return DEFAULT_LIMIT_PER_MIN;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isInteger(parsed) && parsed > 0
		? parsed
		: DEFAULT_LIMIT_PER_MIN;
}

export interface RateLimiterOptions {
	limit?: number;
	windowMs?: number;
	/** Injectable clock for deterministic tests. */
	now?: () => number;
}

/**
 * Create a fixed-window limiter middleware. Buckets are keyed by the
 * authenticating API key id (set `apiKeyAuth` before this), so each key gets
 * its own window. Sets `X-RateLimit-*` headers and, on breach, `429` +
 * `Retry-After`.
 */
export function createRateLimiter(opts: RateLimiterOptions = {}) {
	const limit = opts.limit ?? rateLimitFromEnv();
	const windowMs = opts.windowMs ?? WINDOW_MS;
	const now = opts.now ?? (() => Date.now());
	const buckets = new Map<string, Bucket>();

	return (req: Request, res: Response, next: NextFunction): void => {
		const id = req.apiKeyId ?? req.apiUser?.id ?? "anonymous";
		const ts = now();

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
			const t = req.apiTranslator ?? getRequestTranslator(req);
			sendApiError(res, t, "rate_limited", "errors.rateLimited", {
				vars: { retryAfter },
				headers: { "Retry-After": String(retryAfter) },
			});
			return;
		}

		next();
	};
}
