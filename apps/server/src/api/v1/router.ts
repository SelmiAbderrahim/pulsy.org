// ---------------------------------------------------------------------------
// Public REST API — `/api/v1`.
//
// External callers authenticate with an API key (`Authorization: Bearer pul_…`)
// — never the session cookie. The surface delegates to the uptime services so
// it shares behavior with the tRPC dashboard API. Read-scoped keys can read;
// full-scoped keys can also write. Every route is scoped to the key owner.
//
// Mounted in `index.ts` BEFORE credentialed CORS and the general JSON parser.
// This router owns its noncredentialed CORS, parsing and error boundaries. The
// rate limiter is per-key and in-memory (single-replica deploy).
// ---------------------------------------------------------------------------

import {
	apiCreateUptimeMonitor,
	apiUpdateUptimeMonitor,
	uptimeMonitor,
	uptimeIncident,
	uptimeHeartbeat,
	type uptimeCheckLog as UptimeCheckLogTable,
	type uptimeIncident as UptimeIncidentTable,
} from "@pulsy/db";
import { TRPCError } from "@trpc/server";
import cors from "cors";
import { type Request, type Response, Router, json as parseJson } from "express";
import { z } from "zod";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@pulsy/db";
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
	getOwnedUptimeAggregates,
} from "../../services/uptime";
import { resolveApiKey as defaultResolveApiKey } from "../../services/api-keys/api-key-service";
import { sendApiError, sendApiErrorMessage } from "../http";
import { apiJsonErrorHandler } from "../json-body";
import { apiKeyAuth, requireApiScope } from "../middleware";
import { createRateLimiter, type RateLimiterOptions } from "../rate-limit";
import "../types";
import { manifestTextInput, manifestExportInput, manifestApplyInput } from "../../trpc/routers/monitor-portability";
import { exportMonitorConfiguration, previewMonitorConfiguration, applyMonitorConfiguration } from "../../services/uptime/monitor-portability";
import { apiReliabilityAnnotation, apiReliabilityWindow } from "@pulsy/db";
import { annotateReliability, listReliabilityAnnotations, readReliability } from "../../services/uptime/reliability-service";
import { reliabilityAnnotationListInput } from "../../trpc/routers/reliability";
import { checkErrorCodeOf } from "@pulsy/db/check-error";
import { describeCheckReason } from "../../services/uptime/check-error";
import type { Translator } from "../../lib/i18n";

type CheckLogRow = typeof UptimeCheckLogTable.$inferSelect;
type IncidentRow = typeof UptimeIncidentTable.$inferSelect;

// --- Serializers (stable public DTOs; no userId / status-page internals) -----

/** Rolling-30-day check success per monitor, scoped to the key owner. */
async function checkSuccessFor(userId: string, monitors: UptimeMonitor[]): Promise<Map<string, number>> {
	const rows = await getOwnedUptimeAggregates(userId, 30, monitors.map((m) => m.uptimeMonitorId));
	return new Map([...rows].map(([id, value]) => [id, value.uptimePercentage]));
}

/** `uptimePercentage` is rolling-30-day check success (see checkSuccessPercent), not availability. */
function toApiMonitor(m: UptimeMonitor, checkSuccess: number | null) {
	return {
		id: m.uptimeMonitorId,
		name: m.name,
		monitorType: m.monitorType,
		url: m.url,
		method: m.method,
		expectedStatus: m.expectedStatus,
    expectedStatuses: m.expectedStatuses, tlsMonitoringEnabled: m.tlsMonitoringEnabled,
		httpAssertions: m.httpAssertions,
		redirectPolicy: m.redirectPolicy,
		requestConfigured: Boolean(m.requestCipher),
		latencyPolicy: m.latencyPolicy,
		consecutiveSlow: m.consecutiveSlow,
		consecutiveHealthy: m.consecutiveHealthy,
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
		uptimePercentage: checkSuccess,
		tags: m.tags ?? [],
		createdAt: m.createdAt,
	};
}

/** `errorCode` is the stable taxonomy code; `errorLabel` its label in the request language. */
function toApiCheckLog(l: CheckLogRow, t: Translator, timeoutMs: number) {
	return {
		id: l.checkLogId,
		status: l.status,
		httpStatus: l.httpStatus,
		responseTime: l.responseTime,
		errorMessage: l.errorMessage,
		errorCode: checkErrorCodeOf(l.errorMessage),
		errorLabel: describeCheckReason(l.errorMessage, t, { httpStatus: l.httpStatus, timeoutMs }),
		createdAt: l.createdAt,
	};
}

/** Explicit API projection; internal policy ownership stays inside the service. */
function toApiReliability(view: Awaited<ReturnType<typeof readReliability>>) {
  return {
    monitorId: view.monitorId, monitorType: view.monitorType, from: view.from, to: view.to, asOf: view.asOf,
    retainedFrom: view.retainedFrom, retentionClipped: view.retentionClipped, boundaryLimited: view.boundaryLimited,
    raw: view.raw, maintenanceAdjusted: view.maintenanceAdjusted, checks: view.checks,
    checkSuccessPercent: view.checkSuccessPercent, averageTimingMs: view.averageTimingMs, policyIds: view.policyIds,
    policy: view.policy ? { id: view.policy.id, version: view.policy.version, availabilityTargetBps: view.policy.availabilityTargetBps,
      latencyTargetMs: view.policy.latencyTargetMs, excludeMaintenance: view.policy.excludeMaintenance,
      createdAt: view.policy.createdAt, firstObservedAt: view.policy.firstObservedAt } : null,
    series: view.series,
  };
}

/** Annotation DTO: no owner/actor ids (rows are stored with them). */
function toApiAnnotation(row: { id: string; monitorId: string; at: string; environment: string; version: string; text: string; link: string | null; createdAt: string }) {
	return { id: row.id, monitorId: row.monitorId, at: row.at, environment: row.environment, version: row.version, text: row.text, link: row.link, createdAt: row.createdAt };
}

function toApiIncident(i: IncidentRow, t: Translator) {
	return {
		id: i.incidentId,
		status: i.status,
		startedAt: i.startedAt,
		resolvedAt: i.resolvedAt,
		durationSeconds: i.durationSeconds,
		cause: i.cause,
		causeCode: checkErrorCodeOf(i.cause),
		causeLabel: describeCheckReason(i.cause, t),
		expectedAt: i.expectedAt,
		notifiedAt: i.notifiedAt,
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
	// Bounded so an absurd cursor cannot reach SQL OFFSET as 1e+22 (a 500).
	return Number.isSafeInteger(decoded) && decoded >= 0 && decoded <= 10_000_000 ? decoded : 0;
}

function encodeCursor(offset: number): string {
	return Buffer.from(String(offset), "utf8").toString("base64url");
}

// REST update body: monitor *config* only — no status-page fields, so the
// REST updates do not modify status-page membership.
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
 * Map a thrown error to a localized JSON envelope. Controlled service
 * `BAD_REQUEST`s and unowned-reference `NOT_FOUND`s reach here: routes verify ownership (404) and validate input
 * (422) before delegating, and the access gate 403s in middleware — so the
 * generic 500 tail is a defensive backstop.
 */
function handleRouteError(req: Request, res: Response, err: unknown): void {
  if (err instanceof TRPCError && err.code === "TOO_MANY_REQUESTS") { sendApiErrorMessage(res, "rate_limited", err.message); return; }
	if (err instanceof TRPCError && err.code === "BAD_REQUEST") {
		sendApiErrorMessage(res, "validation_error", err.message);
		return;
	}
	// e.g. `channelIds` naming a channel the caller does not own, or one deleted mid-request.
	if (err instanceof TRPCError && err.code === "NOT_FOUND") {
		sendApiErrorMessage(res, "not_found", err.message);
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
	const monitor = await findOwnedMonitor(typeof req.params.id === "string" ? req.params.id : "", req.apiUser!.id);
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

	// Normal REST bodies retain the general parser's default bound. Configuration
	// keeps its separate authenticated 1 MiB parser below; never parse it twice.
	const normalJson = parseJson();
	router.use((req, res, next) => /^\/configuration(?:\/|$)/i.test(req.path)
		? next() : normalJson(req, res, next));
	router.use(apiJsonErrorHandler);

	const readAccess = requireApiScope("read");
	const writeAccess = requireApiScope("full");
  // Native manifests have their own authenticated byte bound. The application
  // skips its smaller default JSON parser for this prefix only.
  router.use("/configuration", readAccess, parseJson({ limit: "1mb", inflate: false, strict: true }));
  router.use("/configuration", (error: unknown, req: Request, res: Response, _next: import("express").NextFunction) => {
    const type = error && typeof error === "object" && "type" in error ? error.type : "";
    res.status(type === "entity.too.large" ? 413 : type === "encoding.unsupported" ? 415 : 400).json({ error: { code: "validation_error", message: req.apiTranslator!("errors.manifestInvalid") } });
  });

  const configurationRoute = (kind: "export" | "preview" | "apply") => wrap(async (req, res) => {
    const schema = kind === "export" ? manifestExportInput : kind === "preview" ? manifestTextInput : manifestApplyInput;
    if (!schema.safeParse(req.body).success) { sendApiError(res, req.apiTranslator!, "validation_error", "errors.manifestInvalid"); return; }
    try {
      const result = kind === "export" ? await exportMonitorConfiguration(req.apiUser!.id, manifestExportInput.parse(req.body).monitorIds, req.apiTranslator!)
        : kind === "preview" ? await previewMonitorConfiguration(req.apiUser!.id, manifestTextInput.parse(req.body).text, req.apiTranslator!)
        : await applyMonitorConfiguration(req.apiUser!.id, manifestApplyInput.parse(req.body).text, manifestApplyInput.parse(req.body).revision, req.apiTranslator!);
      res.setHeader("Cache-Control", "no-store"); res.json(result);
    } catch (error) {
      if (error instanceof TRPCError && error.code === "NOT_FOUND") { sendApiErrorMessage(res, "not_found", error.message); return; }
      if (error instanceof TRPCError && error.code === "CONFLICT") { res.status(409).json({ error: { code: "conflict", message: error.message } }); return; }
      throw error;
    }
  });
  router.post("/configuration/export", readAccess, configurationRoute("export"));
  router.post("/configuration/preview", readAccess, configurationRoute("preview"));
  router.post("/configuration/apply", writeAccess, configurationRoute("apply"));

	// Stored-state exporter: one bounded monitor query plus a heartbeat deadline
	// batch when needed, no probe, no arbitrary labels.
	// Technical work bound: 1,000 monitors per scrape; shard with monitorIds when an
	// unlimited self-hosted installation grows beyond this query/output bound.
	router.get("/metrics", readAccess, wrap(async (req, res) => {
		const query = z.object({
			monitorIds: z.string().max(13000).transform(v => v.split(","))
				.pipe(z.array(z.string().min(1).max(64).regex(/^[\w-]+$/)).min(1).max(200)).optional(),
		}).strict().safeParse(req.query);
		if (!query.success) {
			sendApiError(res, req.apiTranslator!, "validation_error", "errors.invalidInput");
			return;
		}
		const rows = await db.select({
			id: uptimeMonitor.uptimeMonitorId,
			monitorType: uptimeMonitor.monitorType,
			status: uptimeMonitor.status,
			active: uptimeMonitor.active,
			interval: uptimeMonitor.interval,
			timeout: uptimeMonitor.timeout,
			lastCheckedAt: uptimeMonitor.lastCheckedAt,
			responseTime: uptimeMonitor.responseTime,
			tlsExpiresAt: uptimeMonitor.tlsExpiresAt,
			openIncident: count(uptimeIncident.incidentId),
		}).from(uptimeMonitor)
			.leftJoin(uptimeIncident, and(eq(uptimeIncident.uptimeMonitorId, uptimeMonitor.uptimeMonitorId), eq(uptimeIncident.status, "ongoing")))
			.where(and(eq(uptimeMonitor.userId, req.apiUser!.id), query.data.monitorIds ? inArray(uptimeMonitor.uptimeMonitorId, query.data.monitorIds) : undefined))
			.groupBy(uptimeMonitor.uptimeMonitorId).orderBy(uptimeMonitor.uptimeMonitorId).limit(1001);
		if (rows.length > 1000) {
			sendApiError(res, req.apiTranslator!, "validation_error", "errors.invalidInput");
			return;
		}
		const heartbeatIds = rows.filter(row => row.monitorType === "heartbeat").map(row => row.id);
		const deadlines = new Map(heartbeatIds.length ? (await db.select({ id: uptimeHeartbeat.monitorId, next: uptimeHeartbeat.nextDeadline }).from(uptimeHeartbeat)
			.where(and(eq(uptimeHeartbeat.userId, req.apiUser!.id), inArray(uptimeHeartbeat.monitorId, heartbeatIds)))).map(row => [row.id, row.next]) : []);
		const descriptions = {
			status: "Stored health: -1 unknown, 0 down, 1 up, 2 degraded. Use fresh to exclude stale state.",
			fresh: "1 when active with a known recent observation; heartbeats also require a next deadline not overdue by more than 10 seconds. Otherwise 0.",
			active: "1 when checking is enabled, otherwise 0.",
			last_check_timestamp_seconds: "Server last check Unix time in seconds; NaN when missing.",
			duration_seconds: "Last stored HTTP request, DNS resolution or TCP connection duration in seconds; NaN for heartbeats, servers or missing values.",
			open_incident: "1 when a measured incident remains open, otherwise 0.",
			tls_expiry_timestamp_seconds: "Last observed TLS certificate expiry Unix time; NaN when unavailable.",
		};
		const lines = Object.entries(descriptions).flatMap(([name, description]) => [
			`# HELP pulsy_monitor_${name} ${description}`, `# TYPE pulsy_monitor_${name} gauge`,
		]);
		const timestamp = (value: string | null) => value === null ? NaN : Date.parse(value) / 1000;
		const now = Date.now() / 1000;
		for (const row of rows) {
			const last = timestamp(row.lastCheckedAt);
			const next = deadlines.get(row.id);
			const recent = row.active && row.status !== "pending" && now >= last && now - last <= row.interval * 2 + row.timeout / 1000;
			const heartbeatFresh = row.status !== "pending" && deadlines.has(row.id) && (next == null || now <= timestamp(next) + 10);
			const values = {
				status: row.status === "pending" || !Number.isFinite(last) ? -1 : row.status === "up" ? 1 : row.status === "down" ? 0 : 2,
				fresh: Number(recent && (row.monitorType !== "heartbeat" || heartbeatFresh)),
				active: Number(row.active),
				last_check_timestamp_seconds: last,
				duration_seconds: row.monitorType === "heartbeat" || row.monitorType === "server" || row.responseTime === null ? NaN : row.responseTime / 1000,
				open_incident: Number(row.openIncident > 0),
				tls_expiry_timestamp_seconds: row.monitorType === "http" ? timestamp(row.tlsExpiresAt) : NaN,
			};
			// IDs are generated locally, but escape even legacy/imported values.
			const id = row.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
			for (const [name, value] of Object.entries(values)) lines.push(`pulsy_monitor_${name}{monitor_id="${id}"} ${value}`);
		}
		res.setHeader("Cache-Control", "private, no-store");
		res.type("text/plain; version=0.0.4; charset=utf-8").send(`${lines.join("\n")}\n`);
	}));

	// --- List monitors -------------------------------------------------------
	router.get(
		"/monitors",
		readAccess,
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
			const success = await checkSuccessFor(req.apiUser!.id, page);
			res.json({
				data: page.map((m) => toApiMonitor(m, success.get(m.uptimeMonitorId) ?? null)),
				nextCursor: hasMore ? encodeCursor(offset + limit) : null,
			});
		}),
	);

	// --- Get one monitor -----------------------------------------------------
	router.get("/monitors/:id/reliability", readAccess, wrap(async (req, res) => {
    const monitor = await loadOwnedMonitor(req, res); if (!monitor) return;
    const window = apiReliabilityWindow.safeParse(req.query);
    if (!window.success) { sendApiError(res, req.apiTranslator!, "validation_error", "errors.reliabilityInvalid"); return; }
    res.json({ data: toApiReliability(await readReliability(req.apiUser!.id, monitor.uptimeMonitorId, window.data, req.apiTranslator!)) });
  }));
  router.post("/monitors/:id/annotations", writeAccess, wrap(async (req, res) => {
    const monitor = await loadOwnedMonitor(req, res); if (!monitor) return;
    const annotation = apiReliabilityAnnotation.safeParse(req.body);
    if (!annotation.success) { sendApiError(res, req.apiTranslator!, "validation_error", "errors.reliabilityInvalid"); return; }
    res.status(201).json({ data: toApiAnnotation(await annotateReliability(req.apiUser!.id, monitor.uptimeMonitorId, annotation.data, req.apiTranslator!)) });
  }));
  router.get("/monitors/:id/annotations", readAccess, wrap(async (req, res) => {
    const monitor = await loadOwnedMonitor(req, res); if (!monitor) return;
    const query = z.object({ from: z.string().max(40), to: z.string().max(40), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(512).optional() }).strict().safeParse(req.query);
    if (!query.success) { sendApiError(res, req.apiTranslator!, "validation_error", "errors.reliabilityInvalid"); return; }
    let cursor: unknown;
    try { cursor = query.data.cursor ? JSON.parse(Buffer.from(query.data.cursor, "base64url").toString("utf8")) : undefined; } catch { sendApiError(res, req.apiTranslator!, "validation_error", "errors.reliabilityInvalid"); return; }
    const parsed = reliabilityAnnotationListInput.safeParse({ window: { from: query.data.from, to: query.data.to }, limit: query.data.limit, cursor });
    if (!parsed.success) { sendApiError(res, req.apiTranslator!, "validation_error", "errors.reliabilityInvalid"); return; }
    const result = await listReliabilityAnnotations(req.apiUser!.id, monitor.uptimeMonitorId, parsed.data, req.apiTranslator!);
    res.json({ data: result.data.map(toApiAnnotation), nextCursor: result.nextCursor ? Buffer.from(JSON.stringify(result.nextCursor)).toString("base64url") : null });
  }));
	router.get(
		"/monitors/:id",
		readAccess,
		wrap(async (req, res) => {
			const monitor = await loadOwnedMonitor(req, res);
			if (!monitor) {
				return;
			}
			res.json({ data: toApiMonitor(monitor, (await checkSuccessFor(req.apiUser!.id, [monitor])).get(monitor.uptimeMonitorId) ?? null) });
		}),
	);

	// --- Check logs ----------------------------------------------------------
	router.get(
		"/monitors/:id/checks",
		readAccess,
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
			const { logs, total } = await getCheckLogs(monitor.uptimeMonitorId, req.apiUser!.id, {
				limit,
				offset,
			});
			res.json({
				data: logs.map(log => toApiCheckLog(log, req.apiTranslator!, monitor.timeout)),
				nextCursor: offset + limit < total ? encodeCursor(offset + limit) : null,
			});
		}),
	);

	// --- Incidents -----------------------------------------------------------
	router.get(
		"/monitors/:id/incidents",
		readAccess,
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
				data: page.map(incident => toApiIncident(incident, req.apiTranslator!)),
				nextCursor: hasMore ? encodeCursor(offset + limit) : null,
			});
		}),
	);

	// --- Stats ---------------------------------------------------------------
	router.get(
		"/monitors/:id/stats",
		readAccess,
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
		writeAccess,
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
			const monitor = await createMonitorForUser(
				body.data,
				req.apiUser!.id,
				req.apiTranslator!,
			);
			if (monitor.active) {
				scheduleMonitorCheck(monitor, { checkIfDue: true });
			}
			res.status(201).json({ data: toApiMonitor(monitor, null) }); // brand new: no checks yet
		}),
	);

	// --- Update monitor ------------------------------------------------------
	router.patch(
		"/monitors/:id",
		writeAccess,
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


			const updated = await updateUptimeMonitor({
				...body.data,
				uptimeMonitorId: monitor.uptimeMonitorId,
			}, req.apiUser!.id, req.apiTranslator!);
			if (updated.active) {
				rescheduleMonitorCheck(updated);
			} else {
				cancelMonitorCheck(updated.uptimeMonitorId);
			}
			res.json({ data: toApiMonitor(updated, (await checkSuccessFor(req.apiUser!.id, [updated])).get(updated.uptimeMonitorId) ?? null) });
		}),
	);

	// --- Delete monitor ------------------------------------------------------
	router.delete(
		"/monitors/:id",
		writeAccess,
		wrap(async (req, res) => {
			const monitor = await loadOwnedMonitor(req, res);
			if (!monitor) {
				return;
			}
			cancelMonitorCheck(monitor.uptimeMonitorId);
			await deleteUptimeMonitor(monitor.uptimeMonitorId, req.apiUser!.id);
			res.json({ data: { id: monitor.uptimeMonitorId, deleted: true } });
		}),
	);

	// --- Check now -----------------------------------------------------------
	router.post(
		"/monitors/:id/check-now",
		writeAccess,
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
			res.json({ data: toApiMonitor(updated, (await checkSuccessFor(req.apiUser!.id, [updated])).get(updated.uptimeMonitorId) ?? null) });
		}),
	);

	// Unknown REST paths must not fall through to credentialed cookie CORS.
	router.use((req, res) => {
		sendApiError(res, req.apiTranslator!, "not_found", "errors.notFound", {
			vars: { resource: "API route" },
		});
	});

	return router;
}
