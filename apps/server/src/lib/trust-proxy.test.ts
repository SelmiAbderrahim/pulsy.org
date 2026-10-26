import { describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { parseTrustProxyHops } from "./trust-proxy";

describe("parseTrustProxyHops", () => {
	it.each([
		[undefined, 0],
		["", 0],
		["0", 0],
		["1", 1],
		[" 2 ", 2],
		["99", 8],
		["-1", 0],
		["true", 0],
		["1.5", 0],
	])("%s -> %s", (raw, hops) => {
		expect(parseTrustProxyHops(raw)).toBe(hops);
	});

	it("keys per-client IPs from X-Forwarded-For only when a proxy hop is trusted", async () => {
		async function clientIp(hops: number): Promise<string> {
			const app = express();
			app.set("trust proxy", hops);
			app.get("/", (req, res) => void res.json({ ip: req.ip }));
			const server = app.listen(0);
			try {
				const { port } = server.address() as AddressInfo;
				const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-forwarded-for": "203.0.113.9" } });
				return ((await res.json()) as { ip: string }).ip;
			} finally {
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
		}
		// Untrusted: every caller looks like the proxy (one shared bucket), and a
		// client cannot choose its own IP. Trusted: the real client is visible.
		expect(await clientIp(0)).toMatch(/127\.0\.0\.1/);
		expect(await clientIp(1)).toBe("203.0.113.9");
	});
});
