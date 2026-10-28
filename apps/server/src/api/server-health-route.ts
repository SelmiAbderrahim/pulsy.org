import express, { type ErrorRequestHandler } from "express";
import { createIpRateLimiter } from "../lib/ip-rate-limit";
import { receiveServerSample } from "../services/uptime/server-health-service";

const WINDOW_MS = 60_000;
const GLOBAL_LIMIT = 12_000;
const MAX_IN_FLIGHT = 16;

/** Fixed-path agent ingress; mount before the app's general JSON parser. */
export function createServerHealthRouter(): express.Router {
	const router = express.Router();
	let globalResetAt = 0;
	let globalCount = 0;
	let inFlight = 0;

	router.use((_req, res, next) => {
		res.setHeader("Cache-Control", "no-store");
		const now = Date.now();
		if (globalResetAt <= now) {
			globalResetAt = now + WINDOW_MS;
			globalCount = 0;
		}
		if (globalCount >= GLOBAL_LIMIT) {
			res.setHeader("Retry-After", String(Math.max(1, Math.ceil((globalResetAt - now) / 1000))));
			res.status(429).json({ outcome: "limited" });
			return;
		}
		globalCount++;
		next();
	});
	// Reuse the single IP limiter, including IPv6 /64 grouping and bounded storage.
	router.use(createIpRateLimiter({
		limit: 1200,
		windowMs: WINDOW_MS,
		maxBuckets: 1024,
		failClosed: true,
		onLimited: res => { res.json({ outcome: "limited" }); },
	}));
	router.use(express.json({ limit: "48kb", strict: true, inflate: false, type: "application/json" }));

	router.post("/metrics", async (req, res) => {
		const payload: unknown = req.body;
		if (Object.keys(req.query).length || !req.is("application/json") || payload === undefined) {
			res.status(400).json({ outcome: "invalid" });
			return;
		}
		const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get("Authorization") ?? "")?.[1];
		if (!token) {
			res.status(401).json({ outcome: "unavailable" });
			return;
		}
		if (inFlight >= MAX_IN_FLIGHT) {
			res.setHeader("Retry-After", "1");
			res.status(503).json({ outcome: "busy" });
			return;
		}
		inFlight++;
		try {
			const result = await receiveServerSample(token, payload);
			if (result.retryAfter !== undefined) res.setHeader("Retry-After", String(result.retryAfter));
			// Keep this allowlist explicit: future service fields remain private.
			res.status(result.statusCode).json({
				outcome: result.outcome,
				...(result.interval !== undefined ? { interval: result.interval } : {}),
				...(result.excludedFilesystems !== undefined ? { excludedFilesystems: result.excludedFilesystems } : {}),
			});
		} catch {
			// Never log a request, credential, body or underlying database error.
			res.setHeader("Retry-After", "1");
			res.status(503).json({ outcome: "unavailable" });
		} finally {
			inFlight--;
		}
	});
	router.use((_req, res) => {
		res.status(404).json({ outcome: "unavailable" });
	});
	const parserError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
		const oversized = error !== null && typeof error === "object" && "type" in error && error.type === "entity.too.large";
		res.status(oversized ? 413 : 400).json({ outcome: "invalid" });
	};
	router.use(parserError);
	return router;
}
