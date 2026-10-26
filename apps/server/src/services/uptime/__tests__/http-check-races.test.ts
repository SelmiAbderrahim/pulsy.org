import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeCheckLog, uptimeStatusChange } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { storedMonitorSnapshot } from "../../../../test/monitor-snapshot";
import { assertMonitorUrlAllowed } from "../egress-input";
import { executeCheck } from "../scheduler-service";

vi.mock("../egress-input", async importActual => {
	const actual = await importActual<typeof import("../egress-input")>();
	return { ...actual, assertMonitorUrlAllowed: vi.fn(actual.assertMonitorUrlAllowed) };
});

// Keep real scheduled execution, capacity handling, state writes and incidents.
// Only suppress automatic jobs created by router mutations during these tests.
vi.mock("../scheduler-service", async importActual => ({
	...await importActual<typeof import("../scheduler-service")>(),
	scheduleMonitorCheck: vi.fn(),
	rescheduleMonitorCheck: vi.fn(),
	cancelMonitorCheck: vi.fn(),
}));

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

useCleanDatabase();
afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(assertMonitorUrlAllowed).mockReset();
	vi.unstubAllEnvs();
});

describe("HTTP configuration test admission", () => {
	it("rejects a second owner test while the first is still awaiting destination preflight", async () => {
		const owner = await createTestUser();
		const caller = authedCaller(owner);
		const firstEntered = deferred<void>();
		const secondEntered = deferred<"entered_preflight">();
		const releasePreflight = deferred<void>();
		let entries = 0;
		vi.mocked(assertMonitorUrlAllowed).mockImplementation(async () => {
			if (++entries === 1) firstEntered.resolve();
			else secondEntered.resolve("entered_preflight");
			await releasePreflight.promise;
		});
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 200 }));
		const input = { configuration: { name: "Admission fixture", url: "http://8.8.8.8/health" } };
		const first = caller.uptimeMonitor.monitor.testConfiguration(input);
		await firstEntered.promise;
		const second = caller.uptimeMonitor.monitor.testConfiguration(input).then(
			() => ({ status: "fulfilled" as const }),
			(error: unknown) => ({ status: "rejected" as const, error }),
		);
		let admission: Awaited<typeof second> | "entered_preflight";
		try {
			// The second request either rejects at admission or reaches the forbidden
			// concurrent preflight. Neither path depends on a timer or scheduler tick.
			admission = await Promise.race([second, secondEntered.promise]);
		} finally {
			releasePreflight.resolve();
			await first;
		}
		const outcome = await second;
		expect(admission).toMatchObject({ status: "rejected", error: { code: "TOO_MANY_REQUESTS" } });
		expect(outcome).toMatchObject({ status: "rejected", error: { code: "TOO_MANY_REQUESTS" } });
		// Releasing the first request must free the owner's slot for a later test.
		expect(await caller.uptimeMonitor.monitor.testConfiguration(input)).toHaveProperty("status", "up");
	});
});

describe.each(["manual", "scheduled"] as const)("%s HTTP results after configuration changes", trigger => {
	for (const change of ["target", "assertion"] as const) {
		it(`discards an in-flight result after the ${change} changes and accepts a fresh check`, async () => {
			const owner = await createTestUser();
			const caller = authedCaller(owner);
			const lastCheckedAt = "2026-10-01T00:00:00.000Z";
			const original = await createTestMonitor(owner.id, {
				name: "Race fixture",
				url: "http://8.8.8.8/original",
				status: "up",
				failureThreshold: 1,
				tlsMonitoringEnabled: false,
				lastCheckedAt,
				responseTime: 20,
				httpStatus: 200,
				httpAssertions: [{ type: "json", path: "$.status", op: "equals", value: "old-ready" }],
			});
			const requestEntered = deferred<void>();
			const response = deferred<Response>();
			const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
				requestEntered.resolve();
				return response.promise;
			});
			const run = () => trigger === "scheduled"
				? executeCheck(original.uptimeMonitorId)
				: caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: original.uptimeMonitorId });
			const pending = run();
			await requestEntered.promise;
			const nextValue = change === "assertion" ? "new-ready" : "old-ready";
			try {
				await caller.uptimeMonitor.monitor.update({
					uptimeMonitorId: original.uptimeMonitorId,
					...(change === "target"
						? { url: "http://1.1.1.1/updated" }
						: { httpAssertions: [{ type: "json" as const, path: "$.status", op: "equals" as const, value: nextValue }] }),
				});
			} finally {
				// The old configuration fails this response, while the updated assertion
				// would pass it. A target change instead returns an old-target failure.
				response.resolve(new Response(JSON.stringify({ status: nextValue }), { status: change === "target" ? 503 : 200 }));
				await pending;
			}
			const afterOldResult = await storedMonitorSnapshot(original.uptimeMonitorId, owner.id);
			expect(afterOldResult).toMatchObject({
				status: "up", httpStatus: 200, responseTime: 20, lastCheckedAt,
				consecutiveFailures: 0, incidents: [],
				url: change === "target" ? "http://1.1.1.1/updated" : original.url,
				httpAssertions: [{ type: "json", path: "$.status", op: "equals", value: nextValue }],
			});
			expect(await db.select().from(uptimeCheckLog).where(eq(uptimeCheckLog.uptimeMonitorId, original.uptimeMonitorId))).toHaveLength(0);
			expect(await db.select().from(uptimeStatusChange).where(eq(uptimeStatusChange.uptimeMonitorId, original.uptimeMonitorId))).toHaveLength(0);

			fetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: nextValue })));
			await run();
			const fresh = await storedMonitorSnapshot(original.uptimeMonitorId, owner.id);
			expect(fresh.status).toBe("up");
			expect(fresh.lastCheckedAt).not.toBe(lastCheckedAt);
			expect(fresh.incidents).toHaveLength(0);
			const logs = await db.select().from(uptimeCheckLog).where(eq(uptimeCheckLog.uptimeMonitorId, original.uptimeMonitorId));
			expect(logs).toHaveLength(1);
			expect(logs[0]).toMatchObject({ status: "up", httpStatus: 200, assertionOutcomes: [{ index: 0, passed: true, reason: "pass" }] });
		});
	}
});
