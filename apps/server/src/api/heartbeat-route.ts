import express, { type ErrorRequestHandler } from "express";
import { apiHeartbeatReceipt, type HeartbeatReceipt } from "@pulsy/db";
import { createIpRateLimiter } from "../lib/ip-rate-limit";
import { receiveHeartbeat } from "../services/uptime/heartbeat-service";

const WINDOW_MS = 60_000;
const GLOBAL_LIMIT = 12_000;
const MAX_IN_FLIGHT = 16;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Bare curl pings have no body. Form/text bodies are optional too: parse an
 * object when supplied, otherwise ignore non-JSON text. A declared JSON body
 * must contain a receipt object. No logs or arbitrary payload fields survive.
 */
export function receiptPayload(body: unknown, declaredJson: boolean): HeartbeatReceipt | undefined {
	const text = Buffer.isBuffer(body) ? body.toString("utf8").trim() : "";
	if (!text) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return declaredJson ? undefined : {};
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return declaredJson ? undefined : {};
	}
	const receipt = apiHeartbeatReceipt.safeParse(parsed);
	return receipt.success ? receipt.data : undefined;
}

/** Token-capability ingress; mount before the app's general JSON parser. */
export function createHeartbeatRouter(): express.Router {
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
	// One shared IP-limiter implementation owns both address normalization (/64
	// for IPv6) and the bounded bucket table. These are ingress safety bounds.
	router.use(createIpRateLimiter({
		limit: 1200,
		windowMs: WINDOW_MS,
		maxBuckets: 1024,
		failClosed: true,
		onLimited: res => { res.json({ outcome: "limited" }); },
	}));
	router.use(express.raw({ limit: "10kb", inflate: false, type: () => true }));

	router.all(["/:event", "/:token/:event"], async (req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
			res.setHeader("Allow", "GET, HEAD, POST");
			res.status(405).json({ outcome: "invalid" });
			return;
		}
		const event = req.params.event;
		if (event !== "start" && event !== "success" && event !== "fail") {
			res.status(404).json({ outcome: "unavailable" });
			return;
		}
		if (Object.keys(req.query).length) {
			res.status(400).json({ outcome: "invalid" });
			return;
		}
		const authorization = req.get("Authorization") ?? "";
		const pathToken = typeof req.params.token === "string" ? req.params.token : undefined;
		if (pathToken !== undefined && !TOKEN.test(pathToken)) {
			res.status(404).json({ outcome: "unavailable" });
			return;
		}
		if (pathToken !== undefined && authorization) {
			res.status(400).json({ outcome: "invalid" });
			return;
		}
		const token = pathToken ?? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1];
		if (!token) {
			res.status(404).json({ outcome: "unavailable" });
			return;
		}
		const payload = receiptPayload(req.body, Boolean(req.is("application/json")));
		if (payload === undefined) {
			res.status(400).json({ outcome: "invalid" });
			return;
		}
		if (inFlight >= MAX_IN_FLIGHT) {
			res.setHeader("Retry-After", "1");
			res.status(503).json({ outcome: "busy" });
			return;
		}
		inFlight++;
		try {
			const result = await receiveHeartbeat(token, event, payload);
			if (result.statusCode === 429) res.setHeader("Retry-After", "60");
			res.status(result.statusCode).json({
				outcome: result.outcome,
				...(result.runId ? { runId: result.runId } : {}),
			});
		} catch {
			// Requests, credentials, payloads and underlying errors are never logged.
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
