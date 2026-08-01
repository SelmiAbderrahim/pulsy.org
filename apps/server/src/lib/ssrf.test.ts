import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	assertOutboundUrlAllowed,
	isBlockedIp,
	isEgressFilteringEnabled,
	safeFetch,
	SsrfBlockedError,
} from "./ssrf";

// ---------------------------------------------------------------------------
// Egress-filtering / SSRF guard. IP classification and redirect re-validation
// are pure; DNS-backed paths use IP literals (no lookup) or `localhost` /
// `*.invalid` (deterministic offline) so no real network is required.
// ---------------------------------------------------------------------------

const ORIGINAL = process.env.BLOCK_PRIVATE_TARGETS;

function enable(): void {
	process.env.BLOCK_PRIVATE_TARGETS = "true";
}

afterEach(() => {
	if (ORIGINAL === undefined) {
		delete process.env.BLOCK_PRIVATE_TARGETS;
	} else {
		process.env.BLOCK_PRIVATE_TARGETS = ORIGINAL;
	}
	vi.restoreAllMocks();
});

describe("isEgressFilteringEnabled", () => {
	it("is off by default", () => {
		delete process.env.BLOCK_PRIVATE_TARGETS;
		expect(isEgressFilteringEnabled()).toBe(false);
	});

	it("is on for 'true' (case-insensitive)", () => {
		process.env.BLOCK_PRIVATE_TARGETS = "TRUE";
		expect(isEgressFilteringEnabled()).toBe(true);
	});

	it("is off for any other value", () => {
		process.env.BLOCK_PRIVATE_TARGETS = "1";
		expect(isEgressFilteringEnabled()).toBe(false);
	});
});

describe("isBlockedIp — IPv4", () => {
	it.each([
		["8.8.8.8", false],
		["1.1.1.1", false],
		["11.0.0.1", false],
		["172.15.0.1", false],
		["172.32.0.1", false],
		["192.0.2.1", false],
		["100.63.0.1", false],
		["100.128.0.1", false],
		["198.20.0.1", false],
		["0.0.0.0", true],
		["10.1.2.3", true],
		["127.0.0.1", true],
		["169.254.169.254", true],
		["172.16.0.1", true],
		["172.31.255.255", true],
		["192.168.1.1", true],
		["192.0.0.1", true],
		["100.64.0.1", true],
		["198.18.0.1", true],
		["198.19.255.255", true],
		["224.0.0.1", true],
		["240.0.0.1", true],
		["255.255.255.255", true],
	])("%s -> blocked=%s", (ip, blocked) => {
		expect(isBlockedIp(ip)).toBe(blocked);
	});
});

describe("isBlockedIp — IPv6", () => {
	it.each([
		["::1", true],
		["::", true],
		["fe80::1", true],
		["fc00::1", true],
		["fd12:3456::1", true],
		["::ffff:127.0.0.1", true],
		["::ffff:8.8.8.8", false],
		["2606:4700:4700::1111", false],
		["2001:4860:4860::8888", false],
		["2001:4860:4860:0:0:0:0:8888", false],
		["fe80::1%eth0", true],
		["fe00::1", false],
	])("%s -> blocked=%s", (ip, blocked) => {
		expect(isBlockedIp(ip)).toBe(blocked);
	});
});

describe("isBlockedIp — malformed input is fail-closed", () => {
	it.each([
		"not-an-ip",
		"1.2.3",
		"1.2.3.256",
		"1.2.3.4.5",
		"1::2::3",
		"gg::",
		"12345::",
		":::",
		"1:2:3:4:5:6:7:8:9",
		"1:2:3:4:5:6:7:8::9",
		"::1.2.3.4:5",
		"::1.2.3.999",
	])("%s is blocked", (value) => {
		expect(isBlockedIp(value)).toBe(true);
	});

	it("treats a public IPv4-mapped address as allowed", () => {
		expect(isBlockedIp("::ffff:1.1.1.1")).toBe(false);
	});
});

describe("assertOutboundUrlAllowed", () => {
	it("is a no-op when filtering is disabled", async () => {
		delete process.env.BLOCK_PRIVATE_TARGETS;
		await expect(
			assertOutboundUrlAllowed("http://127.0.0.1/"),
		).resolves.toBeUndefined();
	});

	it("rejects an unparseable URL", async () => {
		enable();
		await expect(assertOutboundUrlAllowed("not a url")).rejects.toBeInstanceOf(
			SsrfBlockedError,
		);
	});

	it("rejects a non-http(s) scheme", async () => {
		enable();
		await expect(
			assertOutboundUrlAllowed("file:///etc/passwd"),
		).rejects.toThrow(/scheme/i);
	});

	it("rejects an IP literal in a blocked range", async () => {
		enable();
		await expect(assertOutboundUrlAllowed("http://127.0.0.1/")).rejects.toThrow(
			/private\/internal/i,
		);
	});

	it("rejects a bracketed IPv6 loopback literal", async () => {
		enable();
		await expect(assertOutboundUrlAllowed("http://[::1]/")).rejects.toThrow(
			/private\/internal/i,
		);
	});

	it("allows a public IP literal", async () => {
		enable();
		await expect(
			assertOutboundUrlAllowed("http://8.8.8.8/path"),
		).resolves.toBeUndefined();
	});

	it("rejects a hostname that resolves to loopback", async () => {
		enable();
		await expect(assertOutboundUrlAllowed("http://localhost/")).rejects.toThrow(
			/private\/internal/i,
		);
	});

	it("rejects when DNS resolution fails", async () => {
		enable();
		await expect(
			assertOutboundUrlAllowed("http://does-not-exist.invalid/"),
		).rejects.toThrow(/DNS resolution failed/i);
	});
});

describe("safeFetch", () => {
	function stubFetch(
		responder: (url: string, init?: RequestInit) => Response,
	): { calls: Array<{ url: string; init?: RequestInit }> } {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async (input: unknown, init?: RequestInit) => {
				const url = String(input);
				calls.push({ url, init });
				return responder(url, init);
			},
		);
		return { calls };
	}

	it("delegates straight to fetch when disabled", async () => {
		delete process.env.BLOCK_PRIVATE_TARGETS;
		const { calls } = stubFetch(() => new Response("ok", { status: 200 }));
		const res = await safeFetch("http://127.0.0.1/", { method: "POST" });
		expect(res.status).toBe(200);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.init?.method).toBe("POST");
	});

	it("returns the response and forces manual redirects when enabled", async () => {
		enable();
		const { calls } = stubFetch(() => new Response("ok", { status: 200 }));
		const res = await safeFetch("http://8.8.8.8/");
		expect(res.status).toBe(200);
		expect(calls[0]?.init?.redirect).toBe("manual");
	});

	it("returns a non-redirect error status without following", async () => {
		enable();
		stubFetch(() => new Response("nope", { status: 404 }));
		const res = await safeFetch("http://8.8.8.8/");
		expect(res.status).toBe(404);
	});

	it("returns a redirect with no Location header as-is", async () => {
		enable();
		stubFetch(() => new Response(null, { status: 302 }));
		const res = await safeFetch("http://8.8.8.8/");
		expect(res.status).toBe(302);
	});

	it("follows a redirect to another public host", async () => {
		enable();
		const { calls } = stubFetch((url) =>
			url.endsWith("/start")
				? new Response(null, { status: 302, headers: { location: "/next" } })
				: new Response("ok", { status: 200 }),
		);
		const res = await safeFetch("http://8.8.8.8/start");
		expect(res.status).toBe(200);
		expect(calls).toHaveLength(2);
		expect(calls[1]?.url).toBe("http://8.8.8.8/next");
	});

	it("blocks a redirect that points at an internal address", async () => {
		enable();
		stubFetch(() =>
			new Response(null, {
				status: 301,
				headers: { location: "http://169.254.169.254/latest/meta-data/" },
			}),
		);
		await expect(safeFetch("http://8.8.8.8/")).rejects.toBeInstanceOf(
			SsrfBlockedError,
		);
	});

	it("rejects after too many redirects", async () => {
		enable();
		stubFetch(() =>
			new Response(null, {
				status: 302,
				headers: { location: "http://8.8.8.8/loop" },
			}),
		);
		await expect(safeFetch("http://8.8.8.8/loop")).rejects.toThrow(
			/too many redirects/i,
		);
	});
});
