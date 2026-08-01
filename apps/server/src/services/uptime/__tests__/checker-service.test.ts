import { afterEach, describe, expect, it, vi } from "vitest";
import { performHttpCheck } from "../checker-service";
import type { UptimeMonitor } from "../monitor-service";

// performHttpCheck is a pure function over a monitor + global.fetch — no DB.

function makeMonitor(overrides: Partial<UptimeMonitor> = {}): UptimeMonitor {
	return {
		uptimeMonitorId: "m",
		url: "https://example.com",
		method: "GET",
		expectedStatus: 200,
		timeout: 5000,
		...overrides,
	} as UptimeMonitor;
}

function fakeResponse(status: number, redirected = false): Response {
	return { status, redirected } as Response;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("performHttpCheck — responses", () => {
	it("reports up when the status matches expectedStatus", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200));
		const r = await performHttpCheck(makeMonitor());
		expect(r.status).toBe("up");
		expect(r.httpStatus).toBe(200);
		expect(r.responseTime).toBeGreaterThanOrEqual(0);
	});

	it("handles a redirected response (redirectCount = 1)", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200, true));
		const r = await performHttpCheck(makeMonitor());
		expect(r.status).toBe("up");
	});

	it("reports down for a 4xx/5xx status", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(503));
		const r = await performHttpCheck(makeMonitor());
		expect(r.status).toBe("down");
		expect(r.errorMessage).toMatch(/Unexpected status: 503/);
	});

	it("reports degraded for an unexpected sub-400 status", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(302));
		const r = await performHttpCheck(makeMonitor({ expectedStatus: 200 }));
		expect(r.status).toBe("degraded");
		expect(r.errorMessage).toMatch(/Unexpected status: 302/);
	});
});

describe("performHttpCheck — error classification", () => {
	const cases: Array<[unknown, string]> = [
		[new DOMException("aborted", "AbortError"), "Request timed out"],
		[new TypeError("fetch failed"), "Connection refused"],
		[new TypeError("ECONNREFUSED 1.2.3.4"), "Connection refused"],
		[new TypeError("getaddrinfo ENOTFOUND host"), "DNS resolution failed"],
		[new TypeError("read ECONNRESET"), "Connection reset by server"],
		[new TypeError("connect ETIMEDOUT"), "Connection timed out"],
		[new TypeError("SSL certificate problem"), "TLS/SSL certificate error"],
		[new TypeError("something odd"), "Network error: something odd"],
		[new Error("boom"), "boom"],
		["a string", "Unknown error occurred"],
	];

	for (const [thrown, expected] of cases) {
		it(`maps ${String((thrown as Error)?.message ?? thrown)} -> "${expected}"`, async () => {
			vi.spyOn(globalThis, "fetch").mockRejectedValue(thrown);
			const r = await performHttpCheck(makeMonitor());
			expect(r.status).toBe("down");
			expect(r.httpStatus).toBeNull();
			expect(r.errorMessage).toBe(expected);
		});
	}
});
