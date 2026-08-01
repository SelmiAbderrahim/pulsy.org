// ---------------------------------------------------------------------------
// Public REST API — `/api/v1`.
//
// External callers authenticate with an API key (`Authorization: Bearer pul_…`)
// — never the session cookie. The surface delegates to the uptime services so
// it shares behavior with the tRPC dashboard API. Every route is scoped to the
// key owner.
//
// Mounted in `index.ts` AFTER `express.json()` and BEFORE `/api/trpc`. The
// rate limiter is per-key and in-memory (single-replica deploy).
// ---------------------------------------------------------------------------

import {
	apiCreateUptimeMonitor,
	apiUpdateUptimeMonitor,
	type uptimeCheckLog as UptimeCheckLogTable,
	type uptimeIncident as UptimeIncidentTable,
} from "@pulsy/db";
import { TRPCError } from "@trpc/server";
import cors from "cors";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import {
	cancelMonitorCheck,
	createMonitorForUser,
	deleteUptimeMonitor,
	findIncidentsByMonitor,
	findOwnedMonitor,
	getCheckLogs,
	getMonitorStats,
	listOwnedMonitors,
	rescheduleMonitorCheck,
	runManualCheck,
	scheduleMonitorCheck,
	updateUptimeMonitor,
	type UptimeMonitor,
} from "../../services/uptime";
import { resolveApiKey as defaultResolveApiKey } from "../../services/api-keys/api-key-service";
import { sendApiError, sendApiErrorMessage } from "../http";
import { apiKeyAuth } from "../middleware";
import { createRateLimiter, type RateLimiterOptions } from "../rate-limit";
import "../types";

type CheckLogRow = typeof UptimeCheckLogTable.$inferSelect;
type IncidentRow = typeof UptimeIncidentTable.$inferSelect;

// --- Serializers (stable public DTOs; no userId / status-page internals) -----

function toApiMonitor(m: UptimeMonitor) {
	return {
		id: m.uptimeMonitorId,
		name: m.name,
		url: m.url,
		method: m.method,
		expectedStatus: m.expectedStatus,
		timeout: m.timeout,
		interval: m.interval,
		failureThreshold: m.failureThreshold,
		active: m.active,
		status: m.status,
		httpStatus: m.httpStatus,
		responseTime: m.responseTime,
		lastCheckedAt: m.lastCheckedAt,
		nextCheckAt: m.nextCheckAt,
		tlsExpiresAt: m.tlsExpiresAt,
		tlsExpiresInDays: m.tlsExpiresInDays,
		consecutiveFailures: m.consecutiveFailures,
		uptimePercentage: m.uptimePercentage,
		tags: m.tags ?? [],
		createdAt: m.createdAt,
	};
}

function toApiCheckLog(l: CheckLogRow) {
	return {
		id: l.checkLogId,
		status: l.status,
		httpStatus: l.httpStatus,
		responseTime: l.responseTime,
		errorMessage: l.errorMessage,
		createdAt: l.createdAt,
	};
}

function toApiIncident(i: IncidentRow) {
	return {
		id: i.incidentId,
		status: i.status,
		startedAt: i.startedAt,
		resolvedAt: i.resolvedAt,
		durationSeconds: i.durationSeconds,
		cause: i.cause,
	};
}

// --- Pagination (opaque offset cursor) ---------------------------------------

const listQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(20),
	cursor: z.string().optional(),
});

function decodeCursor(cursor: string | undefined): number {
	if (!cursor) {
		return 0;
	}
	const decoded = Number.parseInt(
		Buffer.from(cursor, "base64url").toString("utf8"),
		10,
	);
	return Number.isInteger(decoded) && decoded >= 0 ? decoded : 0;
}

function encodeCursor(offset: number): string {
	return Buffer.from(String(offset), "utf8").toString("base64url");
}

// REST update body: monitor *config* only — no status-page fields.
const apiRestUpdateMonitor = apiUpdateUptimeMonitor.omit({
	uptimeMonitorId: true,
	isPublic: true,
	statusPageTitle: true,
	statusPageDescription: true,
});

const statsQuerySchema = z.object({
	days: z.coerce.number().int().min(1).max(366).default(30),
});

// --- Error mapping -----------------------------------------------------------

/**
 * Map a thrown error to a localized JSON envelope. Routes verify ownership
 * (404) and validate input (422) before delegating, so the generic 500 tail is
 * a defensive backstop.
 */
function handleRouteError(req: Request, res: Response, err: unknown): void {
	if (err instanceof TRPCError && err.code === "BAD_REQUEST") {
		sendApiErrorMessage(res, "validation_error", err.message);
		return;
	}
	const t = req.apiTranslator;
	/* v8 ignore next -- defensive: the auth middleware always sets the translator */
	if (!t) return void res.status(500).json({ error: { code: "internal" } });
	sendApiError(res, t, "internal", "errors.internal");
}

/** Wrap an async route so thrown errors become JSON envelopes. */
function wrap(
	handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => void {
	return (req, res) => {
		handler(req, res).catch((err) => handleRouteError(req, res, err));
	};
}

/** Load the path-param monitor scoped to the caller, or 404. */
async function loadOwnedMonitor(
	req: Request,
	res: Response,
): Promise<UptimeMonitor | null> {
	// `:id` is guaranteed by the route and `apiUser` by the auth middleware.
	// (@types/express 5 widens param values to string | string[].)
	const idParam = req.params.id;
	const monitorId = typeof idParam === "string" ? idParam : "";
	const monitor = await findOwnedMonitor(monitorId, req.apiUser!.id);
	if (!monitor) {
		sendApiError(res, req.apiTranslator!, "not_found", "errors.notFound", {
			vars: { resource: "Monitor" },
		});
		return null;
	}
	return monitor;
}

export interface V1RouterOptions {
	resolve?: typeof defaultResolveApiKey;
	rateLimit?: RateLimiterOptions;
}

/** Build the `/api/v1` Express router. Options let tests inject fakes. */
export function createV1Router(options: V1RouterOptions = {}): Router {
	const router = Router();

	// CORS for the public API is independent of the credentialed cookie CORS:
	// any origin, Authorization allowed, no cookies.
	router.use(
		cors({
			origin: true,
			credentials: false,
			methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
			allowedHeaders: ["Authorization", "Content-Type", "Accept-Language"],
		}),
	);

	router.use(apiKeyAuth({ resolve: options.resolve }));
	router.use(createRateLimiter(options.rateLimit));

	// --- List monitors -------------------------------------------------------
	router.get(
		"/monitors",
		wrap(async (req, res) => {
			const query = listQuerySchema.safeParse(req.query);
			if (!query.success) {
				sendApiError(
					res,
					req.apiTranslator!,
					"validation_error",
					"errors.invalidInput",
				);
				return;
			}
			const { limit } = query.data;
			const offset = decodeCursor(query.data.cursor);
			const rows = await listOwnedMonitors(req.apiUser!.id, limit + 1, offset);
			const hasMore = rows.length > limit;
			const page = hasMore ? rows.slice(0, limit) : rows;
			res.json({
				data: page.map(toApiMonitor),
				nextCursor: hasMore ? encodeCursor(offset + limit) : null,
			});
		}),
	);

	// --- Get one monitor -----------------------------------------------------
	router.get(
		"/monitors/:id",
		wrap(async (req, res) => {
			const monitor = await loadOwnedMonitor(req, res);
			if (!monitor) {
				return;
			}
			res.json({ data: toApiMonitor(monitor) });
		}),
	);

	// --- Check logs ----------------------------------------------------------
	router.get(
		"/monitors/:id/checks",
		wrap(async (req, res) => {
			const monitor = await loadOwnedMonitor(req, res);
			if (!monitor) {
				return;
			}
			const query = listQuerySchema.safeParse(req.query);
			if (!query.success) {
				sendApiError(
					res,
					req.apiTranslator!,
					"validation_error",
					"errors.invalidInput",
				);
				return;
			}
			const { limit } = query.data;
			const offset = decodeCursor(query.data.cursor);
			const { logs, total } = await getCheckLogs(
				monitor.uptimeMonitorId,
				req.apiUser!.id,
				{
					limit,
					offset,
				},
			);
			res.json({
				data: logs.map(toApiCheckLog),
				nextCursor: offset + limit < total ? encodeCursor(offset + limit) : null,
			});
		}),
	);

	// --- Incidents -----------------------------------------------------------
	router.get(
		"/monitors/:id/incidents",
		wrap(async (req, res) => {
			const monitor = await loadOwnedMonitor(req, res);
			if (!monitor) {
				return;
			}
			const query = listQuerySchema.safeParse(req.query);
			if (!query.success) {
				sendApiError(
					res,
					req.apiTranslator!,
					"validation_error",
					"errors.invalidInput",
				);
				return;
			}
			const { limit } = query.data;
			const offset = decodeCursor(query.data.cursor);
			const rows = await findIncidentsByMonitor(
				monitor.uptimeMonitorId,
				req.apiUser!.id,
				limit + 1,
				offset,
			);
			const hasMore = rows.length > limit;
			const page = hasMore ? rows.slice(0, limit) : rows;
			res.json({
				data: page.map(toApiIncident),
				nextCursor: hasMore ? encodeCursor(offset + limit) : null,
			});
		}),
	);

	// --- Stats ---------------------------------------------------------------
	router.get(
		"/monitors/:id/stats",
		wrap(async (req, res) => {
			const monitor = await loadOwnedMonitor(req, res);
			if (!monitor) {
				return;
			}
			const query = statsQuerySchema.safeParse(req.query);
			if (!query.success) {
				sendApiError(
					res,
					req.apiTranslator!,
					"validation_error",
					"errors.invalidInput",
				);
				return;
			}
			const stats = await getMonitorStats(
				monitor.uptimeMonitorId,
				req.apiUser!.id,
				query.data.days,
			);
			res.json({ data: stats });
		}),
	);

	// --- Create monitor ------------------------------------------------------
	router.post(
		"/monitors",
		wrap(async (req, res) => {
			const body = apiCreateUptimeMonitor.safeParse(req.body);
			if (!body.success) {
				sendApiError(
					res,
					req.apiTranslator!,
					"validation_error",
					"errors.invalidInput",
				);
				return;
			}
			const monitor = await createMonitorForUser(body.data, req.apiUser!.id);
			if (monitor.active) {
				scheduleMonitorCheck(monitor);
			}
			res.status(201).json({ data: toApiMonitor(monitor) });
		}),
	);

	// --- Update monitor ------------------------------------------------------
	router.patch(
		"/monitors/:id",
		wrap(async (req, res) => {
			const monitor = await loadOwnedMonitor(req, res);
			if (!monitor) {
				return;
			}
			const body = apiRestUpdateMonitor.safeParse(req.body);
			if (!body.success) {
				sendApiError(
					res,
					req.apiTranslator!,
					"validation_error",
					"errors.invalidInput",
				);
				return;
			}

			const updated = await updateUptimeMonitor(
				{
					...body.data,
					uptimeMonitorId: monitor.uptimeMonitorId,
				},
				req.apiUser!.id,
			);
			if (updated.active) {
				rescheduleMonitorCheck(updated);
			} else {
				cancelMonitorCheck(updated.uptimeMonitorId);
			}
			res.json({ data: toApiMonitor(updated) });
		}),
	);

	// --- Delete monitor ------------------------------------------------------
	router.delete(
		"/monitors/:id",
		wrap(async (req, res) => {
			const monitor = await loadOwnedMonitor(req, res);
			if (!monitor) {
				return;
			}
			await deleteUptimeMonitor(monitor.uptimeMonitorId, req.apiUser!.id);
			cancelMonitorCheck(monitor.uptimeMonitorId);
			res.json({ data: { id: monitor.uptimeMonitorId, deleted: true } });
		}),
	);

	// --- Check now -----------------------------------------------------------
	router.post(
		"/monitors/:id/check-now",
		wrap(async (req, res) => {
			const monitor = await loadOwnedMonitor(req, res);
			if (!monitor) {
				return;
			}
			if (!monitor.active) {
				sendApiError(
					res,
					req.apiTranslator!,
					"validation_error",
					"errors.cannotCheckInactive",
				);
				return;
			}
			const updated = await runManualCheck(monitor);
			res.json({ data: toApiMonitor(updated) });
		}),
	);

	return router;
}
