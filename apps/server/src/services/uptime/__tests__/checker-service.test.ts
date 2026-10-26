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
		expect(r.errorMessage).toBe("unexpected_status");
	});

	it("reports degraded for an unexpected sub-400 status", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(302));
		const r = await performHttpCheck(makeMonitor({ expectedStatus: 200 }));
		expect(r.status).toBe("degraded");
		expect(r.errorMessage).toBe("unexpected_status");
	});
});

describe("performHttpCheck — error classification", () => {
	const cases: Array<[unknown, string]> = [
    [new DOMException("aborted", "AbortError"), "response_timeout"],
    [new TypeError("fetch failed"), "unknown"],
    [new TypeError("connect fixture", { cause: { code: "ECONNREFUSED" } }), "connection_refused"],
    [new TypeError("lookup fixture", { cause: { code: "ENOTFOUND" } }), "dns_not_found"],
    [new TypeError("read fixture", { cause: { code: "ECONNRESET" } }), "connection_reset"],
    [new TypeError("connect fixture", { cause: { code: "ETIMEDOUT" } }), "connection_timeout"],
    [new TypeError("certificate fixture", { cause: { code: "CERT_UNTRUSTED" } }), "tls_untrusted"],
    [new TypeError("something odd"), "unknown"],
    [new Error("boom"), "unknown"],
    ["a string", "unknown"],
  ];

	for (const [thrown, expected] of cases) {
		it(`maps ${String((thrown as Error)?.message ?? thrown)} -> "${expected}"`, async () => {
			vi.spyOn(globalThis, "fetch").mockRejectedValue(thrown);
			const r = await performHttpCheck(makeMonitor());
			expect(r.status).toBe("down");
			expect(r.httpStatus).toBeNull();
      expect(r.responseTime).toBeNull();
			expect(r.errorMessage).toBe(expected);
		});
	}
});
