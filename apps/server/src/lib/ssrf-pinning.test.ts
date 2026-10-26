import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import type { LookupAddress } from "node:dns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DNS rebinding: the pre-flight check (dns/promises) sees a public address, the socket's
// own lookup (dns) sees loopback. Validation must also happen at connect time.
const preflight = vi.hoisted(() => vi.fn());
const connectTime = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", async (importActual) => ({ ...(await importActual<typeof import("node:dns/promises")>()), lookup: preflight }));
vi.mock("node:dns", async (importActual) => ({ ...(await importActual<typeof import("node:dns")>()), lookup: connectTime }));

const { safeFetch, SsrfBlockedError, validatingLookup } = await import("./ssrf");
const { checkTlsCertificate } = await import("../services/uptime/tls-checker-service");

const PUBLIC: LookupAddress = { address: "93.184.216.34", family: 4 };
const LOOPBACK: LookupAddress = { address: "127.0.0.1", family: 4 };
const answer = (list: LookupAddress[]) => (_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => (options.all ? callback(null, list) : callback(null, list[0]!.address, list[0]!.family));

let server: Server; let connections: number; let port: number;
beforeEach(async () => {
	process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = "false";
	connections = 0;
	server = createServer((socket) => { connections++; socket.destroy(); });
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	port = (server.address() as AddressInfo).port;
	preflight.mockResolvedValue([PUBLIC]);
});
afterEach(async () => {
	process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = "true";
	vi.clearAllMocks();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("validatingLookup", () => {
	const run = (list: LookupAddress[], options: { all?: boolean } = { all: true }) => new Promise<{ error: unknown; result: unknown }>((resolve) => {
		connectTime.mockImplementation(answer(list));
		validatingLookup("host.test", options as never, (error, result) => resolve({ error, result }));
	});

	it("hands the socket only validated addresses", async () => {
		expect((await run([PUBLIC])).result).toEqual([PUBLIC]);
		const single = await run([PUBLIC], {});
		expect(single.result).toBe(PUBLIC.address);
	});

	it("refuses when any answer is non-public (mixed answers cannot slip one through)", async () => {
		const { error } = await run([PUBLIC, LOOPBACK]);
		expect(error).toBeInstanceOf(SsrfBlockedError);
		expect((error as Error).message).not.toContain("127.0.0.1");
	});

	it("is transparent when filtering is off (self-hosted internal monitoring)", async () => {
		process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = "true";
		expect((await run([LOOPBACK])).result).toEqual([LOOPBACK]);
	});

	it("propagates resolver errors and empty answers", async () => {
		connectTime.mockImplementation((_h: string, _o: unknown, cb: (...a: unknown[]) => void) => cb(Object.assign(new Error("nope"), { code: "ENOTFOUND" })));
		expect(((await new Promise<{ error: unknown }>((resolve) => validatingLookup("x.test", { all: true } as never, (error) => resolve({ error })))).error as { code: string }).code).toBe("ENOTFOUND");
		expect((await run([])).error).toMatchObject({ code: "ENOTFOUND" });
	});
});

describe("DNS rebinding between validation and connect", () => {
	it("safeFetch: a name that is public at check time but loopback at connect time never reaches the server", async () => {
		connectTime.mockImplementation(answer([LOOPBACK]));
		await expect(safeFetch(`http://rebind.test:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError);
		expect(connections).toBe(0);
		expect(preflight).toHaveBeenCalled();
		expect(connectTime).toHaveBeenCalled();
	});

	it("TLS probe: the same swap yields no certificate and no connection", async () => {
		connectTime.mockImplementation(answer([LOOPBACK]));
		await expect(checkTlsCertificate(`https://rebind.test:${port}/`)).resolves.toBeNull();
		expect(connections).toBe(0);
		expect(connectTime).toHaveBeenCalled();
	});
});
