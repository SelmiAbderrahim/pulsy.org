import { createPublicStatusRouter } from "./api/status-route";
import { startStatusSubscriptionWorker, stopStatusSubscriptionWorker } from "./services/uptime/status-subscription";
import { cleanupReliabilityHistory } from "./services/uptime/cleanup-service";
import { startIncidentEscalationWorker, stopIncidentEscalationWorker } from "./services/uptime/incident-escalation";
import { startMaintenanceWorker, stopMaintenanceWorker, cleanupMaintenanceHistory } from "./services/uptime/maintenance-service";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { toNodeHandler } from "better-auth/node";
import { scheduleJob, scheduledJobs } from "node-schedule";
import { auth } from "./auth/auth";
import { createContext } from "./trpc/trpc";
import { appRouter } from "./trpc/router";
import { closeDb } from "@pulsy/db";
import {
	cleanupOldCheckLogs,
	cleanupOldIncidents,
	cleanupOldNotificationLogs,
	cleanupOldStatusChanges,
	initializeAllMonitors,
	migrateLegacyNotificationChannelSecrets,
	runMonthlySlaReports,
	shutdownScheduler,
} from "./services/uptime";
import { PUBLIC_WEB_URL } from "./lib/auth-config";
import { authRateLimitFromEnv, createIpRateLimiter } from "./lib/ip-rate-limit";
import { describeEgressPolicy } from "./lib/ssrf";
import { parseTrustProxyHops } from "./lib/trust-proxy";
import { OriginNotAllowedError, originDeniedHandler } from "./lib/origin-denied";
import { createApiJsonParser, apiJsonErrorHandler } from "./api/json-body";
import { authRateLimitResponse } from "./auth/rate-limit-response";
import { startSchedulerLeadership, cancelAllMonitorChecks, reconcileScheduledMonitors, setSchedulingEnabled } from "./services/uptime";
import { safeErrorSummary } from "./lib/safe-error";
import { slaReportPdfHandler } from "./reports/sla-report-route";
import { createV1Router } from "./api/v1/router";
import { createHeartbeatRouter } from "./api/heartbeat-route";
import { startHeartbeatWorker, stopHeartbeatWorker } from "./services/uptime/heartbeat-service";
import { createServerHealthRouter } from "./api/server-health-route";
import { createAgentReleaseRouter } from "./api/agent-release-route";
import { startServerHealthWorker, stopServerHealthWorker } from "./services/uptime/server-health-alerts";
import { cleanupServerMetrics } from "./services/uptime/server-health-service";

// ---------------------------------------------------------------------------
// Express bootstrap. Env comes from the process / docker compose (no dotenv).
// ---------------------------------------------------------------------------

const PORT = Number(process.env.SERVER_PORT ?? 4000);
// The public REST API can be disabled with API_V1_ENABLED=false.
const API_V1_ENABLED = process.env.API_V1_ENABLED !== "false";
const RETENTION_DAYS = Number(process.env.CHECK_LOG_RETENTION_DAYS ?? 30);

function splitOrigins(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((origin) => origin.trim())
		.filter((origin): origin is string => origin.length > 0);
}

function localLoopbackAliases(origin: string): string[] {
	try {
		const url = new URL(origin);
		if (url.hostname === "localhost") {
			url.hostname = "127.0.0.1";
			return [url.toString().replace(/\/$/, "")];
		}
		if (url.hostname === "127.0.0.1") {
			url.hostname = "localhost";
			return [url.toString().replace(/\/$/, "")];
		}
	} catch {
		return [];
	}
	return [];
}

const allowedOrigins = new Set(
	[PUBLIC_WEB_URL, ...splitOrigins(process.env.TRUSTED_ORIGINS)]
		.filter((origin): origin is string => Boolean(origin))
		.flatMap((origin) => [origin, ...localLoopbackAliases(origin)])
		.map((origin) => origin.replace(/\/$/, "")),
);

const app = express();

// Always deployed behind the web container's nginx (or an operator's reverse
// proxy): trust the first proxy hop so `req.ip` reflects X-Forwarded-For.
app.set("trust proxy", parseTrustProxyHops(process.env.TRUST_PROXY_HOPS ?? "1"));

// Baseline security headers for every API response. The SPA's policy lives in
// nginx; these JSON/PDF responses need no active content, even when accessed
// directly or rendered by a browser after an error.
// HSTS is documented at the TLS-terminating reverse proxy instead of here —
// this container only ever speaks plain HTTP behind nginx.
app.use(
	helmet({
		contentSecurityPolicy: {
			useDefaults: false,
			directives: {
				defaultSrc: ["'none'"],
				baseUri: ["'none'"],
				frameAncestors: ["'none'"],
				formAction: ["'none'"],
			},
		},
		hsts: false,
		frameguard: { action: "deny" },
	}),
);

// Published page projections and body-only subscription capabilities precede cookie CORS/auth.
app.use("/api/status", createPublicStatusRouter());

// Bearer API keys have their own noncredentialed CORS and JSON boundaries.
// Complete enabled REST requests here, before the session-origin allowlist;
// disabled REST paths continue through the normal cookie-origin policy.
if (API_V1_ENABLED) {
	app.use("/api/v1", createV1Router());
}

app.use(
	cors({
		origin(origin, callback) {
			if (!origin || allowedOrigins.has(origin)) {
				callback(null, true);
				return;
			}
			callback(new OriginNotAllowedError());
		},
		credentials: true,
	}),
);

app.use(originDeniedHandler);

// better-auth handler MUST be mounted BEFORE any body parser.
// Express 5 (path-to-regexp v8): wildcards are named — "*splat", not "*".
// Strict per-IP limiter in front — sign-in/sign-up/forgot-password are
// brute-force and enumeration targets. Tune with AUTH_RATE_LIMIT_PER_MIN.
app.all(
	"/api/auth/*splat",
	createIpRateLimiter({ limit: authRateLimitFromEnv() }),
	toNodeHandler(async (request: Request) => authRateLimitResponse(request, await auth.handler(request))),
);

// Body parser for everything else (tRPC reads JSON bodies). Explicit limit —
// no legitimate Pulsy payload approaches 1 MB.
// Heartbeat ingress owns its token authentication and bounded raw parser.
app.use("/api/heartbeat", createHeartbeatRouter());
app.use("/api/agent/v1", createServerHealthRouter());
app.use("/api/agent/releases/v1.0.0", createAgentReleaseRouter());
app.use(createApiJsonParser());
app.use(apiJsonErrorHandler);

// tRPC. Per-IP fixed-window limiter in front — this is the surface that
// includes the unauthenticated public procedures (status pages, share links),
// so it must not be free to hammer. Tune with TRPC_RATE_LIMIT_PER_MIN.
app.use(
	"/api/trpc",
	createIpRateLimiter(),
	createExpressMiddleware({
		router: appRouter,
		createContext,
	}),
);

// Authenticated SLA-report PDF download. Mounted after `express.json()`; the
// handler re-resolves the session and re-runs the ownership guard before
// streaming the PDF.
app.get("/api/reports/sla/:monitorId.pdf", slaReportPdfHandler);

app.get("/health", (_req, res) => {
	res.json({ status: "ok" });
});

async function runDailyCleanup(): Promise<void> {
	try {
		const logs = await cleanupOldCheckLogs(RETENTION_DAYS);
		const serverMetrics = await cleanupServerMetrics();
    await cleanupMaintenanceHistory(RETENTION_DAYS);
    await cleanupReliabilityHistory(RETENTION_DAYS);
		const statusChanges = await cleanupOldStatusChanges(RETENTION_DAYS);
		const incidents = await cleanupOldIncidents(RETENTION_DAYS);
		const notificationLogs = await cleanupOldNotificationLogs(RETENTION_DAYS);
		console.info(
			`[cleanup] Removed ${logs} check log(s), ${serverMetrics} server metric(s), ${statusChanges} status change(s), ${incidents} incident(s), ${notificationLogs} notification log(s)`,
		);
	} catch (err) {
		console.error(`[cleanup] Daily cleanup failed: ${safeErrorSummary(err)}`);
	}
}

async function runMonthlySlaReportsJob(): Promise<void> {
	try {
		await runMonthlySlaReports();
		console.info("[sla-report] Monthly SLA report run complete");
	} catch (err) {
		console.error(
			`[sla-report] Monthly SLA report run failed: ${safeErrorSummary(err)}`,
		);
	}
}

// Schema migrations add the version marker; payload encryption requires the
// application key, so legacy plaintext rows are upgraded here before the HTTP
// listener or scheduler can read them. The transaction is idempotent and a
// failure deliberately aborts startup rather than serving plaintext-backed
// channels.
const migratedNotificationChannels =
	await migrateLegacyNotificationChannelSecrets();
if (migratedNotificationChannels > 0) {
	console.info(
		`[server] Encrypted ${migratedNotificationChannels} legacy notification channel(s)`,
	);
}

const LEADER_JOBS = ["uptime-daily-cleanup", "uptime-monthly-sla", "uptime-heartbeat-deadlines", "uptime-server-deadlines", "uptime-maintenance-resume", "uptime-incident-escalations", "uptime-status-subscriptions", "uptime-status-subscription-retention"] as const;
let reconcileTimer: ReturnType<typeof setInterval> | undefined;

async function startLeaderWork(): Promise<void> {
  setSchedulingEnabled(true);
  await initializeAllMonitors();
  startHeartbeatWorker();
  startServerHealthWorker();
  startMaintenanceWorker();
  startIncidentEscalationWorker();
  startStatusSubscriptionWorker();
  reconcileTimer = setInterval(() => {
    void reconcileScheduledMonitors().catch(error => console.error(`[scheduler] Reconcile failed: ${safeErrorSummary(error)}`));
  }, 30_000);
  reconcileTimer.unref();
	// Daily cleanup at 03:00 server time.
	try {
		scheduleJob("uptime-daily-cleanup", "0 3 * * *", () => {
			void runDailyCleanup();
		});
	} catch (err) {
		console.error(
			`[server] Failed to schedule daily cleanup: ${safeErrorSummary(err)}`,
		);
	}

	// Monthly SLA reports at 06:00 on the 1st (prior calendar month).
	try {
		scheduleJob("uptime-monthly-sla", "0 6 1 * *", () => {
			void runMonthlySlaReportsJob();
		});
	} catch (err) {
		console.error(
			`[server] Failed to schedule monthly SLA reports: ${safeErrorSummary(err)}`,
		);
	}
}

async function stopLeaderWork(): Promise<void> {
  setSchedulingEnabled(false);
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = undefined;
  cancelAllMonitorChecks();
  for (const name of LEADER_JOBS) scheduledJobs[name]?.cancel();
  await stopHeartbeatWorker();
  await stopServerHealthWorker();
  await stopIncidentEscalationWorker();
  await stopStatusSubscriptionWorker();
  await stopMaintenanceWorker();
}

setSchedulingEnabled(false);
const leadership = startSchedulerLeadership({ onElected: startLeaderWork, onLost: stopLeaderWork });

const server = app.listen(PORT, () => {
  console.info(`[server] Pulsy server listening on :${PORT}`);
  for (const line of describeEgressPolicy()) console.warn(line);
});

// ---------------------------------------------------------------------------
// Graceful shutdown & global safety nets
//
// On SIGTERM/SIGINT (every container redeploy) we stop accepting new HTTP,
// cancel scheduled jobs, drain in-flight checks, and close the DB pool so no
// task is orphaned mid-write. uncaughtException/unhandledRejection are logged;
// an uncaught exception leaves the process in an undefined state, so we shut
// down and let the supervisor (`restart: unless-stopped`) start a clean one.
// ---------------------------------------------------------------------------

let shuttingDown = false;

async function gracefulShutdown(signal: string, exitCode = 0): Promise<void> {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	console.info(`[server] ${signal} received — shutting down gracefully`);

	// Force-exit if shutdown hangs (e.g. a stuck connection close).
	const forceExit = setTimeout(() => {
		console.error("[server] Graceful shutdown timed out — forcing exit");
		process.exit(1);
	}, 15000);
	forceExit.unref();

	try {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await leadership.stop();
		await shutdownScheduler();
		await closeDb();
		console.info("[server] Shutdown complete");
		clearTimeout(forceExit);
		process.exit(exitCode);
	} catch (err) {
		console.error(
			`[server] Error during shutdown: ${safeErrorSummary(err)}`,
		);
		clearTimeout(forceExit);
		process.exit(1);
	}
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
	console.error(
		`[server] Unhandled promise rejection: ${safeErrorSummary(reason)}`,
	);
});

process.on("uncaughtException", (err) => {
	console.error(`[server] Uncaught exception: ${safeErrorSummary(err)}`);
	void gracefulShutdown("uncaughtException", 1);
});
