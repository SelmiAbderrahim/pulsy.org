// End-to-end tests for the public REST API:
// a real `app.listen` socket + Node's built-in `fetch`, so the full middleware
// chain (CORS → API-key auth → rate limit → access gate → route) is exercised.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHeartbeatForUser, receiveHeartbeat } from "../../services/uptime/heartbeat-service";
import { getTranslator } from "../../lib/i18n";
import { apiJsonErrorHandler } from "../json-body";
import { type AddressInfo } from "node:net";
import { db, uptimeCheckLog, uptimeIncident, uptimeMonitor, uptimeReliabilityPolicy } from "@pulsy/db";
import { eq } from "drizzle-orm";
import * as uptimeServices from "../../services/uptime";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestApiKey,
	createTestDefaultChannel,
	createTestMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../test/db";
import type { ResolvedApiKey } from "../../services/api-keys/api-key-service";

// fetch's `.json()` is typed `unknown`; tests read loosely-shaped envelopes.
// biome-ignore lint/suspicious/noExplicitAny: test-only JSON body reader
async function jsonBody(res: Response): Promise<any> {
	return res.json();
}

/**
 * Mock only OUTBOUND fetches (the monitor's HTTP probe). Requests the test
 * client makes to the local server (127.0.0.1) pass through to real fetch.
 */
function mockOutboundFetch(): void {
	const realFetch = globalThis.fetch;
	vi.spyOn(globalThis, "fetch").mockImplementation(
		async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
			const url = typeof input === "string" ? input : (input as Request).url;
			if (url.includes("127.0.0.1")) {
				return realFetch(input, init);
			}
			return new Response("ok", { status: 200 });
		},
	);
}

// Mock only the scheduler side-effects; the rest of the uptime services
// (createMonitorForUser, runManualCheck, stats, …) run for real.
const { scheduleMonitorCheck, rescheduleMonitorCheck, cancelMonitorCheck } =
	vi.hoisted(() => ({
		scheduleMonitorCheck: vi.fn(),
		rescheduleMonitorCheck: vi.fn(),
		cancelMonitorCheck: vi.fn(),
	}));

vi.mock("../../services/uptime", async (importActual) => {
	const actual = await importActual<typeof import("../../services/uptime")>();
	return {
		...actual,
		scheduleMonitorCheck,
		rescheduleMonitorCheck,
		cancelMonitorCheck,
	};
});

// Imported AFTER the mock so the router picks up the mocked scheduler.
const { createV1Router } = await import("./router");

useCleanDatabase();

const originalEnv = { ...process.env };
const openServers: Array<{ close: (cb: () => void) => void }> = [];

beforeEach(() => {
	scheduleMonitorCheck.mockClear();
	rescheduleMonitorCheck.mockClear();
	cancelMonitorCheck.mockClear();
});

afterEach(async () => {
	process.env = { ...originalEnv };
	vi.restoreAllMocks();
	while (openServers.length > 0) {
		const s = openServers.pop();
		if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
	}
});

type ResolveFn = (token: string) => Promise<ResolvedApiKey>;

/** Resolver that maps a token → owning user, or rejects unknown tokens. */
function fakeResolve(map: Record<string, { userId: string; scope?: "read" | "full" }>): ResolveFn {
	return async (token) => {
		const entry = map[token];
		if (!entry) {
			return { ok: false, reason: "invalid" };
		}
		return {
			ok: true,
			user: { id: entry.userId },
			apiKeyId: `k_${token}`,
      scope: entry.scope ?? "full",
		};
	};
}

function buildApp(
	options: Parameters<typeof createV1Router>[0] = {},
): Promise<string> {
	const app = express();
	const defaultJson = express.json({ limit: "1mb", inflate: false, strict: true });
  app.use((req, res, next) => /^\/api\/v1\/configuration(?:\/|$)/i.test(req.path) ? next() : defaultJson(req, res, next));
	app.use("/api/v1", createV1Router(options));
  app.use("/api/v1", apiJsonErrorHandler);
	return new Promise<string>((resolve) => {
		const server = app.listen(0, () => {
			const { port } = server.address() as AddressInfo;
			openServers.push(server);
			resolve(`http://127.0.0.1:${port}`);
		});
	});
}

function authHeaders(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

describe("authentication", () => {
	it("401s without an Authorization header", async () => {
		const base = await buildApp({ resolve: fakeResolve({}) });
		const res = await fetch(`${base}/api/v1/monitors`);
		expect(res.status).toBe(401);
		const body = await jsonBody(res);
		expect(body.error.code).toBe("unauthorized");
	});

	it("401s for an unknown key", async () => {
		const base = await buildApp({ resolve: fakeResolve({}) });
		const res = await fetch(`${base}/api/v1/monitors`, {
			headers: authHeaders("nope"),
		});
		expect(res.status).toBe(401);
	});
});

describe("monitor CRUD", () => {
	async function fullApp(userId: string): Promise<string> {
		return buildApp({
			resolve: fakeResolve({ tok: { userId } }),
		});
	}

	it("creates a monitor and schedules it", async () => {
		const user = await createTestUser();
		const base = await fullApp(user.id);
		const res = await fetch(`${base}/api/v1/monitors`, {
			method: "POST",
			headers: authHeaders("tok"),
			body: JSON.stringify({ name: "Prod", url: "https://prod.test" }),
		});
		expect(res.status).toBe(201);
		const body = await jsonBody(res);
		expect(body.data.name).toBe("Prod");
		expect(body.data.id).toBeTruthy();
		expect(scheduleMonitorCheck).toHaveBeenCalledOnce();
	});

	it("422s on an invalid create body", async () => {
		const user = await createTestUser();
		const base = await fullApp(user.id);
		const res = await fetch(`${base}/api/v1/monitors`, {
			method: "POST",
			headers: authHeaders("tok"),
			body: JSON.stringify({ name: "" }),
		});
		expect(res.status).toBe(422);
		expect((await jsonBody(res)).error.code).toBe("validation_error");
	});

	it("gets, updates and deletes a monitor", async () => {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id, { name: "Orig" });
		const base = await fullApp(user.id);

		const get = await fetch(`${base}/api/v1/monitors/${monitor.uptimeMonitorId}`, {
			headers: authHeaders("tok"),
		});
		expect(get.status).toBe(200);
		expect((await jsonBody(get)).data.name).toBe("Orig");

		const patch = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}`,
			{
				method: "PATCH",
				headers: authHeaders("tok"),
				body: JSON.stringify({ name: "Renamed" }),
			},
		);
		expect(patch.status).toBe(200);
		expect((await jsonBody(patch)).data.name).toBe("Renamed");
		expect(rescheduleMonitorCheck).toHaveBeenCalled();

		const del = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}`,
			{ method: "DELETE", headers: authHeaders("tok") },
		);
		expect(del.status).toBe(200);
		expect((await jsonBody(del)).data.deleted).toBe(true);
		expect(cancelMonitorCheck).toHaveBeenCalled();

		const gone = await db.query.uptimeMonitor.findFirst({
			where: eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId),
		});
		expect(gone).toBeUndefined();
	});

	it("cancels scheduling when a PATCH deactivates a monitor", async () => {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id, { active: true });
		const base = await fullApp(user.id);
		const res = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}`,
			{
				method: "PATCH",
				headers: authHeaders("tok"),
				body: JSON.stringify({ active: false }),
			},
		);
		expect(res.status).toBe(200);
		expect(cancelMonitorCheck).toHaveBeenCalled();
	});

	it("422s an invalid monitor-list query", async () => {
		const user = await createTestUser();
		const base = await fullApp(user.id);
		const res = await fetch(`${base}/api/v1/monitors?limit=0`, {
			headers: authHeaders("tok"),
		});
		expect(res.status).toBe(422);
	});

	it("applies the interval guard on PATCH and updates", async () => {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id, { interval: 300 });
		const base = await fullApp(user.id);
		const res = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}`,
			{
				method: "PATCH",
				headers: authHeaders("tok"),
				body: JSON.stringify({ interval: 600 }),
			},
		);
		expect(res.status).toBe(200);
		expect((await jsonBody(res)).data.interval).toBe(600);
	});

	it("422s on an invalid PATCH body", async () => {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id);
		const base = await fullApp(user.id);
		const res = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}`,
			{
				method: "PATCH",
				headers: authHeaders("tok"),
				body: JSON.stringify({ interval: 7 }),
			},
		);
		expect(res.status).toBe(422);
	});

	it("runs check-now on an active monitor", async () => {
		mockOutboundFetch();
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id, {
			active: true,
			url: "https://up.test",
		});
		const base = await fullApp(user.id);
		const res = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/check-now`,
			{ method: "POST", headers: authHeaders("tok") },
		);
		expect(res.status).toBe(200);
		expect((await jsonBody(res)).data.status).toBe("up");
	});

	it("422s check-now on an inactive monitor", async () => {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id, { active: false });
		const base = await fullApp(user.id);
		const res = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/check-now`,
			{ method: "POST", headers: authHeaders("tok") },
		);
		expect(res.status).toBe(422);
	});
});

describe("ownership scoping", () => {
	it("404s another user's monitor and lists only the caller's", async () => {
		const owner = await createTestUser();
		const attacker = await createTestUser();
		const theirs = await createTestMonitor(owner.id, { name: "theirs" });
		await createTestMonitor(attacker.id, { name: "mine" });

		const base = await buildApp({
			resolve: fakeResolve({ tok: { userId: attacker.id } }),
		});
		const get = await fetch(
			`${base}/api/v1/monitors/${theirs.uptimeMonitorId}`,
			{ headers: authHeaders("tok") },
		);
		expect(get.status).toBe(404);

		const list = await fetch(`${base}/api/v1/monitors`, {
			headers: authHeaders("tok"),
		});
		const body = await jsonBody(list);
		expect(body.data).toHaveLength(1);
		expect(body.data[0].name).toBe("mine");
	});
});

describe("sub-resources", () => {
	it("returns check logs, incidents and stats", async () => {
		mockOutboundFetch();
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id, {
			active: true,
			url: "https://up.test",
		});
		const base = await buildApp({
			resolve: fakeResolve({ tok: { userId: user.id } }),
		});
		// Generate a check log via check-now.
		await fetch(`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/check-now`, {
			method: "POST",
			headers: authHeaders("tok"),
		});

		const checks = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/checks`,
			{ headers: authHeaders("tok") },
		);
		expect(checks.status).toBe(200);
		expect((await jsonBody(checks)).data.length).toBeGreaterThan(0);

		const incidents = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/incidents`,
			{ headers: authHeaders("tok") },
		);
		expect(incidents.status).toBe(200);

		const stats = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/stats?days=7`,
			{ headers: authHeaders("tok") },
		);
		expect(stats.status).toBe(200);
		expect((await jsonBody(stats)).data).toHaveProperty("uptimePercentage");
	});

	it("422s bad query params", async () => {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id);
		const base = await buildApp({
			resolve: fakeResolve({ tok: { userId: user.id } }),
		});
		const checks = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/checks?limit=0`,
			{ headers: authHeaders("tok") },
		);
		expect(checks.status).toBe(422);

		const incidents = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/incidents?limit=0`,
			{ headers: authHeaders("tok") },
		);
		expect(incidents.status).toBe(422);

		const stats = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/stats?days=999`,
			{ headers: authHeaders("tok") },
		);
		expect(stats.status).toBe(422);
	});
});

describe("pagination", () => {
	it("paginates the monitor list with an opaque cursor", async () => {
		const user = await createTestUser();
		for (let i = 0; i < 3; i++) {
			await createTestMonitor(user.id, {
				name: `m${i}`,
				createdAt: new Date(Date.now() - i * 1000).toISOString(),
			});
		}
		const base = await buildApp({
			resolve: fakeResolve({ tok: { userId: user.id } }),
		});

		const first = await fetch(`${base}/api/v1/monitors?limit=2`, {
			headers: authHeaders("tok"),
		});
		const firstBody = await jsonBody(first);
		expect(firstBody.data).toHaveLength(2);
		expect(firstBody.nextCursor).toBeTruthy();

		const second = await fetch(
			`${base}/api/v1/monitors?limit=2&cursor=${firstBody.nextCursor}`,
			{ headers: authHeaders("tok") },
		);
		const secondBody = await jsonBody(second);
		expect(secondBody.data).toHaveLength(1);
		expect(secondBody.nextCursor).toBeNull();
	});

	it("treats a garbage cursor as the start", async () => {
		const user = await createTestUser();
		await createTestMonitor(user.id);
		const base = await buildApp({
			resolve: fakeResolve({ tok: { userId: user.id } }),
		});
		const res = await fetch(`${base}/api/v1/monitors?cursor=@@@bad`, {
			headers: authHeaders("tok"),
		});
		expect(res.status).toBe(200);
		expect((await jsonBody(res)).data).toHaveLength(1);
	});
});

describe("rate limiting", () => {
	it("429s once the per-key window is exhausted", async () => {
		const user = await createTestUser();
		const base = await buildApp({
			resolve: fakeResolve({ tok: { userId: user.id } }),
			rateLimit: { limit: 1, now: () => 1000 },
		});
		const first = await fetch(`${base}/api/v1/monitors`, {
			headers: authHeaders("tok"),
		});
		expect(first.status).toBe(200);
		const second = await fetch(`${base}/api/v1/monitors`, {
			headers: authHeaders("tok"),
		});
		expect(second.status).toBe(429);
		expect(second.headers.get("retry-after")).toBeTruthy();
	});
});

describe("not-found across routes", () => {
	it("404s every monitor route for an unknown id", async () => {
		const user = await createTestUser();
		const base = await buildApp({
			resolve: fakeResolve({ tok: { userId: user.id } }),
		});
		const id = "does-not-exist";
		const cases: Array<[string, string]> = [
			["GET", `/monitors/${id}`],
			["GET", `/monitors/${id}/checks`],
			["GET", `/monitors/${id}/incidents`],
			["GET", `/monitors/${id}/stats`],
			["PATCH", `/monitors/${id}`],
			["DELETE", `/monitors/${id}`],
			["POST", `/monitors/${id}/check-now`],
		];
		for (const [method, path] of cases) {
			const res = await fetch(`${base}/api/v1${path}`, {
				method,
				headers: authHeaders("tok"),
				body: method === "PATCH" ? JSON.stringify({ name: "x" }) : undefined,
			});
			expect(res.status, `${method} ${path}`).toBe(404);
		}
	});
});

describe("serialization & sub-resource pagination", () => {
	it("returns [] tags as an empty array", async () => {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id, { tags: null });
		const base = await buildApp({
			resolve: fakeResolve({ tok: { userId: user.id } }),
		});
		const res = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}`,
			{ headers: authHeaders("tok") },
		);
		expect((await jsonBody(res)).data.tags).toEqual([]);
	});

	it("serializes and paginates incidents", async () => {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id);
		await db.insert(uptimeIncident).values([
			{
				uptimeMonitorId: monitor.uptimeMonitorId,
				status: "resolved",
				startedAt: new Date(Date.now() - 2000).toISOString(),
			},
			{
				uptimeMonitorId: monitor.uptimeMonitorId,
				status: "ongoing",
				startedAt: new Date(Date.now() - 1000).toISOString(),
			},
		]);
		const base = await buildApp({
			resolve: fakeResolve({ tok: { userId: user.id } }),
		});
		const res = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/incidents?limit=1`,
			{ headers: authHeaders("tok") },
		);
		const body = await jsonBody(res);
		expect(body.data).toHaveLength(1);
		expect(body.data[0]).toHaveProperty("status");
		expect(body.nextCursor).toBeTruthy();
	});

	it("paginates check logs", async () => {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id);
		await db.insert(uptimeCheckLog).values([
			{
				uptimeMonitorId: monitor.uptimeMonitorId,
				status: "up",
				createdAt: new Date(Date.now() - 2000).toISOString(),
			},
			{
				uptimeMonitorId: monitor.uptimeMonitorId,
				status: "up",
				createdAt: new Date(Date.now() - 1000).toISOString(),
			},
		]);
		const base = await buildApp({
			resolve: fakeResolve({ tok: { userId: user.id } }),
		});
		const res = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/checks?limit=1`,
			{ headers: authHeaders("tok") },
		);
		const body = await jsonBody(res);
		expect(body.data).toHaveLength(1);
		expect(body.nextCursor).toBeTruthy();
	});

	it("500s on an unexpected service error", async () => {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id);
		const base = await buildApp({
			resolve: fakeResolve({ tok: { userId: user.id } }),
		});
		vi.spyOn(uptimeServices, "getMonitorStats").mockRejectedValueOnce(
			new Error("boom"),
		);
		const res = await fetch(
			`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/stats`,
			{ headers: authHeaders("tok") },
		);
		expect(res.status).toBe(500);
		expect((await jsonBody(res)).error.code).toBe("internal");
	});
});

describe("real resolver regression", () => {
	it("authenticates a real key and serves the owner's monitors", async () => {
		const user = await createTestUser();
		await createTestMonitor(user.id, { name: "oss" });
		const { plaintext } = await createTestApiKey(user.id);
		// No resolve override → the real resolveApiKey runs.
		const base = await buildApp();
		const res = await fetch(`${base}/api/v1/monitors`, {
			headers: authHeaders(plaintext),
		});
		expect(res.status).toBe(200);
		const body = await jsonBody(res);
		expect(body.data).toHaveLength(1);
		expect(body.data[0].name).toBe("oss");
	});
});

describe("owned reliability and annotation endpoints", () => {
  it("returns reliability and annotation DTOs without account identity fields", async () => {
    const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { active: false });
    await db.insert(uptimeReliabilityPolicy).values({ userId: owner.id, monitorId: monitor.uptimeMonitorId, version: 1, availabilityTargetBps: 9990, latencyTargetMs: null });
    const base = await buildApp({ resolve: fakeResolve({ tok: { userId: owner.id } }) });
    const to = new Date().toISOString(); const from = new Date(Date.parse(to) - 3_600_000).toISOString();
    const get = await fetch(`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/reliability?${new URLSearchParams({ from, to })}`, { headers: authHeaders("tok") });
    expect(get.status).toBe(200); const view = await jsonBody(get);
    expect(view.data.raw).toMatchObject({ observedMs: 0, unknownMs: 3_600_000, availabilityPercent: null });
    expect(JSON.stringify(view.data)).not.toContain(owner.id); expect(view.data.policy).not.toHaveProperty("userId");
    const post = await fetch(`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/annotations`, { method: "POST", headers: authHeaders("tok"), body: JSON.stringify({ at: from, text: "Deploy", environment: "prod", version: "v2" }) });
    expect(post.status).toBe(201); const note = (await jsonBody(post)).data;
    expect(Object.keys(note).sort()).toEqual(["id", "monitorId", "at", "environment", "version", "text", "link", "createdAt"].sort());
    const list = await fetch(`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/annotations?${new URLSearchParams({ from, to })}`, { headers: authHeaders("tok") });
    expect(list.status).toBe(200); const result = await jsonBody(list);
    expect(result.data).toEqual([note]); expect(JSON.stringify(result)).not.toMatch(/userId|actorId/);
  });
  it("validates windows and cursors, rejects foreign monitors, and requires key authentication", async () => {
    const owner = await createTestUser(); const other = await createTestUser(); const foreign = await createTestMonitor(other.id);
    const monitor = await createTestMonitor(owner.id, { active: false }); const base = await buildApp({ resolve: fakeResolve({ tok: { userId: owner.id } }) });
    const headers = authHeaders("tok");
    expect((await fetch(`${base}/api/v1/monitors/${foreign.uptimeMonitorId}/reliability?from=bad&to=bad`, { headers })).status).toBe(404);
    expect((await fetch(`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/reliability?from=bad&to=bad`, { headers })).status).toBe(422);
    expect((await fetch(`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/annotations?from=bad&to=bad&cursor=bad`, { headers })).status).toBe(422);
    expect((await fetch(`${base}/api/v1/monitors/${monitor.uptimeMonitorId}/reliability`)).status).toBe(401);
  });
});

describe("API-key scopes without account feature restrictions", () => {
  it.each(["read", "full"] as const)("authenticates a real %s key for reads and restricts writes to full scope", async scope => {
    const owner = await createTestUser(), monitor = await createTestMonitor(owner.id, { active: false });
    const key = await createTestApiKey(owner.id, { scope }); const base = await buildApp();
    expect((await fetch(`${base}/api/v1/monitors`, { headers: authHeaders(key.plaintext) })).status).toBe(200);
    const response = await fetch(`${base}/api/v1/monitors/${monitor.uptimeMonitorId}`, { method: "PATCH", headers: authHeaders(key.plaintext), body: JSON.stringify({ name: "Reviewed name" }) });
    expect(response.status).toBe(scope === "full" ? 200 : 403);
    const stored = await db.query.uptimeMonitor.findFirst({ where: eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId) });
    expect(stored!.name).toBe(scope === "full" ? "Reviewed name" : monitor.name);
  });
  it("accepts case-insensitive Bearer schemes without accepting multiple credentials", async () => {
    const owner = await createTestUser(); const key = await createTestApiKey(owner.id); const base = await buildApp();
    expect((await fetch(`${base}/api/v1/monitors`, { headers: { Authorization: `bEaReR ${key.plaintext}` } })).status).toBe(200);
    expect((await fetch(`${base}/api/v1/monitors`, { headers: { Authorization: `Bearer ${key.plaintext} another-token` } })).status).toBe(401);
  });
});
describe("native configuration API", () => {
  it.each(["read", "full"] as const)("allows %s scope to export/preview and requires full scope for apply", async scope => {
    const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { active: false });
    const key = await createTestApiKey(owner.id, { scope }), base = await buildApp();
    const post = (path: string, body: unknown) => fetch(`${base}/api/v1/configuration/${path}`, { method: "POST", headers: authHeaders(key.plaintext), body: JSON.stringify(body) });
    expect((await post("export", { monitorIds: [monitor.uptimeMonitorId] })).status).toBe(200);
    const text = JSON.stringify({ format: "pulsy-monitor-configuration", version: 1, monitors: [{ key: "native", type: "http", name: "Native", url: "https://example.invalid/health", method: "GET", expectedStatus: 200, timeout: 10000, interval: 30, failureThreshold: 3, redirectPolicy: "follow", active: false, tags: [] }] });
    const response = await post("preview", { text }); expect(response.status).toBe(200); const preview = await jsonBody(response);
    expect((await post("apply", { text, revision: preview.revision })).status).toBe(scope === "full" ? 200 : 403);
    expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, owner.id))).toHaveLength(scope === "full" ? 2 : 1);
  });
  it("returns no foreign export, bounds input and identifies stale apply without writing", async () => {
    const owner = await createTestUser(); const other = await createTestUser();
    const foreign = await createTestMonitor(other.id, { active: false });
    const origin = await buildApp({ resolve: fakeResolve({ writer: { userId: owner.id, scope: "full" } }) });
    const post = (path: string, body: unknown) => fetch(origin + "/api/v1/configuration/" + path, { method: "POST", headers: authHeaders("writer"), body: JSON.stringify(body) });
    expect((await post("export", { monitorIds: [foreign.uptimeMonitorId] })).status).toBe(404);
    expect((await post("preview", { text: " ".repeat(262145) })).status).toBe(422);
    const text = JSON.stringify({ format: "pulsy-monitor-configuration", version: 1, monitors: [{ key: "job", type: "heartbeat", name: "Job", interval: 300, graceSeconds: 60, active: false, tags: [] }] });
    const preview = await jsonBody(await post("preview", { text }));
    await createTestMonitor(owner.id, { active: false });
    expect((await post("apply", { text, revision: preview.revision })).status).toBe(409);
    expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, owner.id))).toHaveLength(1);
  });
});
describe("account-scoped Prometheus output", () => {
  it("exports DNS/TCP seconds, excludes inapplicable TLS and job timing, and leaves unknown health unfresh", async () => {
    const owner = await createTestUser(); const lastCheckedAt = new Date().toISOString();
    const dns = await createTestMonitor(owner.id, { monitorType: "dns", status: "up", lastCheckedAt, responseTime: 125 });
    const tcp = await createTestMonitor(owner.id, { monitorType: "tcp", status: "degraded", lastCheckedAt, responseTime: 1500, tlsExpiresAt: "2027-01-01T00:00:00.000Z" });
    const job = await createTestMonitor(owner.id, { monitorType: "heartbeat", status: "up", lastCheckedAt, responseTime: 9000 });
    const unknown = await createTestMonitor(owner.id, { status: "pending", lastCheckedAt });
    const origin = await buildApp({ resolve: fakeResolve({ reader: { userId: owner.id, scope: "read" } }) });
    const response = await fetch(origin + "/api/v1/metrics", { headers: authHeaders("reader") });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await response.text();
    expect(text).toContain(`pulsy_monitor_duration_seconds{monitor_id="${dns.uptimeMonitorId}"} 0.125`);
    expect(text).toContain(`pulsy_monitor_duration_seconds{monitor_id="${tcp.uptimeMonitorId}"} 1.5`);
    expect(text).toContain(`pulsy_monitor_status{monitor_id="${tcp.uptimeMonitorId}"} 2`);
    expect(text).toContain(`pulsy_monitor_last_check_timestamp_seconds{monitor_id="${tcp.uptimeMonitorId}"} ${Date.parse(lastCheckedAt) / 1000}`);
    expect(text).toContain(`pulsy_monitor_tls_expiry_timestamp_seconds{monitor_id="${tcp.uptimeMonitorId}"} NaN`);
    expect(text).toContain(`pulsy_monitor_duration_seconds{monitor_id="${job.uptimeMonitorId}"} NaN`);
    expect(text).toContain(`pulsy_monitor_fresh{monitor_id="${unknown.uptimeMonitorId}"} 0`);
    expect(await db.select().from(uptimeCheckLog)).toHaveLength(0);
  });

  it("uses inclusive freshness boundaries while excluding future observations and paused monitors", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const now = new Date("2026-10-10T12:00:00.000Z"); vi.setSystemTime(now);
      const owner = await createTestUser();
      const atBoundary = await createTestMonitor(owner.id, { status: "up", interval: 30, timeout: 1000, lastCheckedAt: new Date(now.getTime() - 61_000).toISOString() });
      const future = await createTestMonitor(owner.id, { status: "up", lastCheckedAt: new Date(now.getTime() + 1).toISOString() });
      const paused = await createTestMonitor(owner.id, { status: "down", active: false, lastCheckedAt: now.toISOString() });
      const origin = await buildApp({ resolve: fakeResolve({ reader: { userId: owner.id, scope: "read" } }) });
      const scrape = async () => (await fetch(origin + "/api/v1/metrics", { headers: authHeaders("reader") })).text();
      const first = await scrape();
      expect(first).toContain(`pulsy_monitor_fresh{monitor_id="${atBoundary.uptimeMonitorId}"} 1`);
      for (const row of [future, paused]) expect(first).toContain(`pulsy_monitor_fresh{monitor_id="${row.uptimeMonitorId}"} 0`);
      vi.setSystemTime(now.getTime() + 1);
      expect(await scrape()).toContain(`pulsy_monitor_fresh{monitor_id="${atBoundary.uptimeMonitorId}"} 0`);
    } finally { vi.useRealTimers(); }
  });
  it("keeps heartbeat timing unknown and excludes overdue unsampled health from freshness without probing", async () => {
    const owner = await createTestUser(); const baseTime = new Date(Date.now() - 400_000);
    const job = await createHeartbeatForUser({ name: "Job", interval: 300, graceSeconds: 60, active: true, tags: [] }, owner.id, getTranslator("en"), baseTime);
    await receiveHeartbeat(job.token, "success", {}, baseTime);
    const before = await db.select().from(uptimeCheckLog);
    const origin = await buildApp({ resolve: fakeResolve({ reader: { userId: owner.id, scope: "read" } }) });
    const scrape = await fetch(origin + "/api/v1/metrics", { headers: authHeaders("reader") }); expect(scrape.status).toBe(200);
    const text = await scrape.text(); const id = job.monitor.uptimeMonitorId;
    expect(text).toContain(`pulsy_monitor_duration_seconds{monitor_id="${id}"} NaN`);
    expect(text).toContain(`pulsy_monitor_fresh{monitor_id="${id}"} 0`);
    expect(text).not.toContain(job.token);
    expect(await db.select().from(uptimeCheckLog)).toEqual(before);
  });

	it("bounds total scrape work and records a synthetic 200-monitor scrape", async () => {
		const owner = await createTestUser();
		const inserted = await db.insert(uptimeMonitor).values(Array.from({ length: 1001 }, (_, i) => ({
			userId: owner.id, name: `fixture-${i}`, url: "https://fixture.invalid", interval: 30,
			status: "up" as const, lastCheckedAt: new Date().toISOString(), responseTime: i,
		}))).returning({ id: uptimeMonitor.uptimeMonitorId });
		const base = await buildApp({ resolve: fakeResolve({ tok: { userId: owner.id, scope: "full" } }) });
		expect((await fetch(`${base}/api/v1/metrics`, { headers: authHeaders("tok") })).status).toBe(422);
		const started = performance.now();
		const result = await fetch(`${base}/api/v1/metrics?monitorIds=${inserted.slice(0, 200).map(v => v.id).join(",")}`, { headers: authHeaders("tok") });
		const body = await result.text();
		expect(result.status).toBe(200);
		expect(body.split("\n").filter(v => v.startsWith("pulsy_"))).toHaveLength(1400);
		console.info(JSON.stringify({ fixture: "200 stored HTTP monitors / 7 gauges each", bytes: Buffer.byteLength(body), elapsedMs: performance.now() - started }));
	});
  it("requires an API key and permits both key scopes", async () => {
    const owner = await createTestUser();
    const base = await buildApp({ resolve: fakeResolve({ reader: { userId: owner.id, scope: "read" }, writer: { userId: owner.id, scope: "full" } }) });
    expect((await fetch(`${base}/api/v1/metrics`)).status).toBe(401);
    for (const token of ["reader", "writer"]) {
      const response = await fetch(`${base}/api/v1/metrics`, { headers: authHeaders(token) });
      expect(response.status).toBe(200); expect(response.headers.get("content-type")).toContain("text/plain");
    }
  });

	it("exports stored state only, preserves zero timing, and never exports private labels", async () => {
		const owner = await createTestUser();
		const other = await createTestUser();
		const now = new Date().toISOString();
		const up = await createTestMonitor(owner.id, {
			status: "up", lastCheckedAt: now, responseTime: 0,
			name: "private-name", url: "https://secret.invalid/?token=private-token", tags: ["private-tag"],
			tlsExpiresAt: "2027-01-01T00:00:00.000Z",
		});
		const unknown = await createTestMonitor(owner.id);
		const stale = await createTestMonitor(owner.id, { status: "down", lastCheckedAt: "2020-01-01T00:00:00.000Z", responseTime: 1250 });
		const foreign = await createTestMonitor(other.id, { status: "up", lastCheckedAt: now });
		await db.insert(uptimeIncident).values({ uptimeMonitorId: stale.uptimeMonitorId, status: "ongoing", startedAt: now });
		const base = await buildApp({ resolve: fakeResolve({ tok: { userId: owner.id, scope: "full" } }) });
		const text = await (await fetch(`${base}/api/v1/metrics`, { headers: authHeaders("tok") })).text();
		expect(text).toContain(`pulsy_monitor_status{monitor_id="${up.uptimeMonitorId}"} 1`);
		expect(text).toContain(`pulsy_monitor_duration_seconds{monitor_id="${up.uptimeMonitorId}"} 0`);
		expect(text).toContain(`pulsy_monitor_status{monitor_id="${unknown.uptimeMonitorId}"} -1`);
		expect(text).toContain(`pulsy_monitor_duration_seconds{monitor_id="${unknown.uptimeMonitorId}"} NaN`);
		expect(text).toContain(`pulsy_monitor_fresh{monitor_id="${stale.uptimeMonitorId}"} 0`);
		expect(text).toContain(`pulsy_monitor_duration_seconds{monitor_id="${stale.uptimeMonitorId}"} 1.25`);
		expect(text).toContain(`pulsy_monitor_open_incident{monitor_id="${stale.uptimeMonitorId}"} 1`);
		for (const value of [foreign.uptimeMonitorId, "private-name", "private-token", "secret.invalid", "private-tag", owner.email]) expect(text).not.toContain(value);
		expect(await db.select().from(uptimeCheckLog)).toHaveLength(0);
	});

	it("bounds selection and cannot select another account's record", async () => {
		const owner = await createTestUser();
		const foreign = await createTestMonitor((await createTestUser()).id);
		const base = await buildApp({ resolve: fakeResolve({ tok: { userId: owner.id, scope: "read" } }) });
		const filtered = await fetch(`${base}/api/v1/metrics?monitorIds=${foreign.uptimeMonitorId}`, { headers: authHeaders("tok") });
		expect(filtered.status).toBe(200);
		expect(await filtered.text()).not.toContain(foreign.uptimeMonitorId);
		expect((await fetch(`${base}/api/v1/metrics?monitorIds=${"a,".repeat(201)}a`, { headers: authHeaders("tok") })).status).toBe(422);
		expect((await fetch(`${base}/api/v1/metrics?labels=url`, { headers: authHeaders("tok") })).status).toBe(422);
	});
});


/** Property names of a schema under components.schemas in the shipped OpenAPI file. */
function openApiSchemaProperties(schema: string): string[] {
	const text = readFileSync(resolve(process.cwd(), "../../docs/api/openapi.yaml"), "utf8");
	const block = text.split(new RegExp(`^    ${schema}:\\n`, "m"))[1]?.split(/^    \w+:\n/m)[0] ?? "";
	return [...block.matchAll(/^        (\w+):/gm)].map((m) => m[1]!);
}

describe("documented request/response pairs match the implementation", () => {
	// Mirrors the examples on /dashboard/api-docs; apps/web api-endpoints.test.ts pins those samples to the same spec.
	it("POST /monitors: the documented body returns a pending monitor whose fields are exactly the OpenAPI Monitor schema", async () => {
		const user = await createTestUser();
		const base = await buildApp({ resolve: fakeResolve({ tok: { userId: user.id, scope: "full" } }) });
		const request = { name: "API health", url: "https://api.example.com/health", method: "GET", interval: 60, tags: ["api", "prod"] };
		const res = await fetch(`${base}/api/v1/monitors`, { method: "POST", headers: authHeaders("tok"), body: JSON.stringify(request) });
		expect(res.status).toBe(201);
		const { data } = await jsonBody(res);
		expect(Object.keys(data).sort()).toEqual(openApiSchemaProperties("Monitor").sort());
		expect(data).toMatchObject({
			...request, monitorType: "http", expectedStatus: 200, timeout: 10000, failureThreshold: 3, active: true,
			status: "pending", httpStatus: null, responseTime: null, lastCheckedAt: null, uptimePercentage: null, consecutiveFailures: 0,
			httpAssertions: [], redirectPolicy: "follow", requestConfigured: false, latencyPolicy: null,
		});
		expect(typeof data.nextCheckAt).toBe("string");
	});

	it("PATCH /monitors/{id}: { interval: 300, active: false } is reflected in the response, other fields unchanged", async () => {
		const user = await createTestUser();
		const base = await buildApp({ resolve: fakeResolve({ tok: { userId: user.id, scope: "full" } }) });
		const created = (await jsonBody(await fetch(`${base}/api/v1/monitors`, { method: "POST", headers: authHeaders("tok"), body: JSON.stringify({ name: "API health", url: "https://api.example.com/health", interval: 60, tags: ["api", "prod"] }) }))).data;
		const res = await fetch(`${base}/api/v1/monitors/${created.id}`, { method: "PATCH", headers: authHeaders("tok"), body: JSON.stringify({ interval: 300, active: false }) });
		expect(res.status).toBe(200);
		const { data } = await jsonBody(res);
		expect(data.interval).toBe(300);
		expect(data.active).toBe(false);
		expect({ ...data, interval: 60, active: true, nextCheckAt: created.nextCheckAt }).toEqual(created);
	});
});

describe("documented configuration example executes against the API", () => {
	// The shipped OpenAPI "allTypes" preview example: one http, dns, tcp, heartbeat and server (agent) monitor.
	function documentedManifestText(): string {
		const spec = readFileSync(resolve(process.cwd(), "../../docs/api/openapi.yaml"), "utf8");
		const match = /^\s+text: '(\{"format":"pulsy-monitor-configuration".*\})'\s*$/m.exec(spec);
		if (!match) throw new Error("openapi.yaml no longer carries the allTypes preview example");
		return match[1]!;
	}

	it("previews and applies the documented manifest with a seeded key: all five monitor types are created", async () => {
		const user = await createTestUser();
		await createTestDefaultChannel(user.id, { channelId: "ch_ops_email" }); // the example binds this existing channel id
		const base = await buildApp({ resolve: fakeResolve({ tok: { userId: user.id, scope: "full" } }) });
		const text = documentedManifestText();
		const manifest = JSON.parse(text) as { monitors: Array<{ type: string; key: string }> };
		expect(manifest.monitors.map((m) => m.type)).toEqual(["http", "dns", "tcp", "heartbeat", "server"]);
		const post = (path: string, body: unknown) => fetch(`${base}/api/v1/configuration/${path}`, { method: "POST", headers: authHeaders("tok"), body: JSON.stringify(body) });
		const preview = await post("preview", { text });
		const previewBody = await jsonBody(preview);
		expect(preview.status, JSON.stringify(previewBody)).toBe(200);
		expect(previewBody.entries.map((e: { key: string; action: string; reasons: unknown }) => [e.key, e.action, e.reasons]), JSON.stringify(previewBody.entries)).toEqual(manifest.monitors.map((m) => [m.key, "create", []]));
		const applied = await post("apply", { text, revision: previewBody.revision });
		expect(applied.status, await applied.clone().text()).toBe(200);
		const stored = await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, user.id));
		expect(stored.map((m) => m.monitorType).sort()).toEqual(["dns", "heartbeat", "http", "server", "tcp"]);
	});
});

describe("reliability, annotations and configuration routes match the OpenAPI schemas", () => {
	const keys = (value: object) => Object.keys(value).sort();
	async function fixture() {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id);
		const base = await buildApp({ resolve: fakeResolve({ tok: { userId: user.id, scope: "full" }, ro: { userId: user.id, scope: "read" } }) });
		const now = Date.now();
		const iso = (offset: number) => encodeURIComponent(new Date(now + offset).toISOString());
		const post = (path: string, body: unknown, token = "tok") => fetch(`${base}/api/v1${path}`, { method: "POST", headers: authHeaders(token), body: JSON.stringify(body) });
		const get = (path: string, token = "tok") => fetch(`${base}/api/v1${path}`, { headers: authHeaders(token) });
		return { monitor, base, now, iso, post, get };
	}

	it("annotations: POST and GET return exactly the documented fields, never owner ids; read-only keys cannot write", async () => {
		const { monitor, now, iso, post, get } = await fixture();
		const created = await post(`/monitors/${monitor.uptimeMonitorId}/annotations`, { at: new Date(now - 3_600_000).toISOString(), text: "deploy", environment: "prod", version: "1.2" });
		expect(created.status).toBe(201);
		const note = (await jsonBody(created)).data;
		expect(keys(note)).toEqual(openApiSchemaProperties("Annotation").sort());
		expect(note).toMatchObject({ monitorId: monitor.uptimeMonitorId, text: "deploy", environment: "prod", version: "1.2", link: null });
		const list = await jsonBody(await get(`/monitors/${monitor.uptimeMonitorId}/annotations?from=${iso(-7_200_000)}&to=${iso(60_000)}`, "ro"));
		expect(keys(list)).toEqual(["data", "nextCursor"]);
		expect(list.data.map(keys)).toEqual([openApiSchemaProperties("Annotation").sort()]);
		expect(JSON.stringify(list)).not.toMatch(/userId|actorId/);
		expect((await post(`/monitors/${monitor.uptimeMonitorId}/annotations`, { at: new Date(now - 1000).toISOString(), text: "no write" }, "ro")).status).toBe(403);
		expect((await post(`/monitors/${monitor.uptimeMonitorId}/annotations`, { at: new Date(now - 1000).toISOString(), text: "" })).status).toBe(422);
	});

	it("reliability: the response has exactly the documented fields and totals", async () => {
		const { monitor, iso, get } = await fixture();
		const res = await get(`/monitors/${monitor.uptimeMonitorId}/reliability?from=${iso(-3_600_000)}&to=${iso(0)}`, "ro");
		expect(res.status).toBe(200);
		const { data } = await jsonBody(res);
		expect(keys(data)).toEqual(openApiSchemaProperties("Reliability").sort());
		expect(keys(data.raw)).toEqual(openApiSchemaProperties("ReliabilityTotals").sort());
		expect(data.raw.availabilityPercent).toBeNull(); // nothing observed: unknown, not 0 or 100
		expect((await get(`/monitors/${monitor.uptimeMonitorId}/reliability?from=${iso(0)}&to=${iso(-3_600_000)}`)).status).toBe(422);
	});

	it("configuration: export → preview → apply keep the documented shapes, and a stale revision is a 409", async () => {
		const { monitor, post } = await fixture();
		const exported = await jsonBody(await post("/configuration/export", { monitorIds: [monitor.uptimeMonitorId] }, "ro"));
		expect(keys(exported)).toEqual(openApiSchemaProperties("ConfigurationExport").sort());
		const text = JSON.stringify(exported.manifest);
		const preview = await jsonBody(await post("/configuration/preview", { text }, "ro"));
		expect(keys(preview)).toEqual(openApiSchemaProperties("ConfigurationPreview").sort());
		expect(keys(preview.counts)).toEqual(openApiSchemaProperties("ConfigurationCounts").sort());
		expect((await post("/configuration/apply", { text, revision: preview.revision }, "ro")).status).toBe(403); // apply needs full access
		const applied = await post("/configuration/apply", { text, revision: preview.revision });
		expect(applied.status).toBe(200);
		expect(keys((await jsonBody(applied)).counts)).toEqual(openApiSchemaProperties("ConfigurationCounts").sort());
		const stale = await post("/configuration/apply", { text, revision: "0".repeat(64) });
		expect(stale.status).toBe(409);
		expect((await jsonBody(stale)).error.code).toBe("conflict");
	});
});

describe("monitor check success", () => {
	it("reports rolling-30-day check success from recorded checks, not a stored column", async () => {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id);
		await db.insert(uptimeCheckLog).values([
			{ uptimeMonitorId: monitor.uptimeMonitorId, status: "up", httpStatus: 200, responseTime: 10 },
			{ uptimeMonitorId: monitor.uptimeMonitorId, status: "up", httpStatus: 200, responseTime: 10 },
			{ uptimeMonitorId: monitor.uptimeMonitorId, status: "degraded", httpStatus: 204, responseTime: 10 },
			{ uptimeMonitorId: monitor.uptimeMonitorId, status: "down", httpStatus: null, responseTime: null },
		]);
		const base = await buildApp({ resolve: fakeResolve({ tok: { userId: user.id, scope: "full" } }) });
		const one = await jsonBody(await fetch(`${base}/api/v1/monitors/${monitor.uptimeMonitorId}`, { headers: authHeaders("tok") }));
		expect(one.data.uptimePercentage).toBe(50);
		const list = await jsonBody(await fetch(`${base}/api/v1/monitors`, { headers: authHeaders("tok") }));
		expect(list.data.find((m: { id: string }) => m.id === monitor.uptimeMonitorId).uptimePercentage).toBe(50);
	});

	it("is null for a monitor with no recorded checks", async () => {
		const user = await createTestUser();
		const monitor = await createTestMonitor(user.id);
		const base = await buildApp({ resolve: fakeResolve({ tok: { userId: user.id, scope: "full" } }) });
		const one = await jsonBody(await fetch(`${base}/api/v1/monitors/${monitor.uptimeMonitorId}`, { headers: authHeaders("tok") }));
		expect(one.data.uptimePercentage).toBeNull();
	});
});
