// End-to-end tests for the public REST API:
// a real `app.listen` socket + Node's built-in `fetch`, so the full middleware
// chain (CORS → API-key auth → rate limit → access gate → route) is exercised.

import { type AddressInfo } from "node:net";
import { db, uptimeCheckLog, uptimeIncident, uptimeMonitor } from "@pulsy/db";
import { eq } from "drizzle-orm";
import * as uptimeServices from "../../services/uptime";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestApiKey,
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
function fakeResolve(map: Record<string, { userId: string }>): ResolveFn {
	return async (token) => {
		const entry = map[token];
		if (!entry) {
			return { ok: false, reason: "invalid" };
		}
		return {
			ok: true,
			user: { id: entry.userId },
			apiKeyId: `k_${token}`,
		};
	};
}

function buildApp(
	options: Parameters<typeof createV1Router>[0] = {},
): Promise<string> {
	const app = express();
	app.use(express.json());
	app.use("/api/v1", createV1Router(options));
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
