import i18n from "i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { extractErrorMessage } from "./extractErrorMessage";
import { trpcQuery } from "./trpc";

beforeAll(async () => {
	await i18n.init({ lng: "en", resources: { en: { common: { states: { unreachable: "Could not reach Pulsy. Check your connection and try again.", serverProblem: "Pulsy had a problem processing this request. Nothing was changed. Try again." } } } } });
});
afterEach(() => vi.unstubAllGlobals());

describe("tRPC transport failures", () => {
  it("identifies an HTML proxy 503 as a server problem, never an unreachable server", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("<html>Unavailable</html>",{status:503,headers:{"Content-Type":"text/html"}})));
    await expect(trpcQuery("uptimeMonitor","monitor.list")).rejects.toThrow("Pulsy had a problem processing this request.");
  });
	it("reports an unreachable server in words instead of the browser's 'Failed to fetch'", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
		await expect(trpcQuery("uptimeMonitor", "monitor.list")).rejects.toThrow("Could not reach Pulsy. Check your connection and try again.");
	});

	it.each([
		["TIMEOUT", 408],
		["INTERNAL_SERVER_ERROR", 500],
	])("shows a received tRPC %s envelope as a server problem, never as unreachable", async (code, httpStatus) => {
		const body = [{ error: { json: { message: "db password leaked", code: -32603, data: { code, httpStatus } } } }];
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: httpStatus, headers: { "Content-Type": "application/json" } })));
		const error = await trpcQuery("uptimeMonitor", "monitor.list").then(() => null, (e: unknown) => e);
		expect(error).not.toBeNull();
		const message = extractErrorMessage(error, "Fallback");
		expect(message).toBe("Pulsy had a problem processing this request. Nothing was changed. Try again.");
	});

	it("leaves an aborted request (stale search, navigation) as an abort", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
		await expect(trpcQuery("uptimeMonitor", "monitor.list")).rejects.not.toThrow("Could not reach Pulsy");
	});
});

describe("localized validation transport", () => {
	it("sends the selected app language to the formatter while preserving cookies", async () => {
		await i18n.changeLanguage("ar");
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ result: { data: { json: [] } } }]), { headers: { "Content-Type": "application/json" } }));
		vi.stubGlobal("fetch", fetchMock);
		try {
			await trpcQuery("uptimeMonitor", "monitor.list");
			const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
			expect(new Headers(options.headers).get("Accept-Language")).toBe("ar");
			expect(options.credentials).toBe("include");
		} finally { await i18n.changeLanguage("en"); }
	});
});
