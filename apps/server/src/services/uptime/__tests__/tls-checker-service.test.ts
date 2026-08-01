import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// checkTlsCertificate is a pure wrapper over `node:tls`. We mock the module so
// every branch is deterministic and no real socket is ever opened.
// ---------------------------------------------------------------------------

const connectMock = vi.fn();

vi.mock("node:tls", () => ({
	connect: (...args: unknown[]) => connectMock(...args),
}));

import { checkTlsCertificate } from "../tls-checker-service";

type ConnectCallback = () => void;

interface FakeSocketOptions {
	cert?: unknown;
	authorized?: boolean;
	/** When set, the connect callback throws (covers the inner try/catch). */
	throwInCallback?: boolean;
	/** Fire this socket event instead of invoking the connect callback. */
	emit?: "error" | "timeout" | null;
}

/**
 * Build a fake tls socket + wire `tls.connect(opts, cb)` to it. Depending on
 * `emit`, the connect callback fires synchronously (happy/cert branches) or a
 * registered 'error'/'timeout' listener fires (failure branches).
 */
function primeSocket(opts: FakeSocketOptions = {}) {
	const listeners: Record<string, () => void> = {};
	const destroy = vi.fn();
	const getPeerCertificate = vi.fn(() => {
		if (opts.throwInCallback) {
			throw new Error("cert read blew up");
		}
		return opts.cert;
	});

	const socket = {
		getPeerCertificate,
		authorized: opts.authorized ?? false,
		destroy,
		on(event: string, cb: () => void) {
			listeners[event] = cb;
			return socket;
		},
	};

	connectMock.mockImplementation(
		(_options: unknown, cb: ConnectCallback) => {
			if (opts.emit) {
				// Defer so the Promise executor finishes registering listeners.
				queueMicrotask(() => listeners[opts.emit as string]?.());
			} else {
				queueMicrotask(() => cb());
			}
			return socket;
		},
	);

	return { socket, destroy, getPeerCertificate };
}

beforeEach(() => {
	connectMock.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("checkTlsCertificate — early returns", () => {
	it("returns null for an invalid URL without opening a socket", async () => {
		expect(await checkTlsCertificate("not a url")).toBeNull();
		expect(connectMock).not.toHaveBeenCalled();
	});

	it("returns null for a non-https URL", async () => {
		expect(await checkTlsCertificate("http://example.com")).toBeNull();
		expect(connectMock).not.toHaveBeenCalled();
	});
});

describe("checkTlsCertificate — connection options", () => {
	it("uses the explicit port from the URL when present", async () => {
		primeSocket({ emit: "error" });
		await checkTlsCertificate("https://example.com:8443");
		const passedOpts = connectMock.mock.calls[0]?.[0] as { port: number };
		expect(passedOpts.port).toBe(8443);
	});

	it("defaults to port 443 when none is given", async () => {
		primeSocket({ emit: "error" });
		await checkTlsCertificate("https://example.com");
		const passedOpts = connectMock.mock.calls[0]?.[0] as {
			port: number;
			host: string;
		};
		expect(passedOpts.port).toBe(443);
		expect(passedOpts.host).toBe("example.com");
	});
});

describe("checkTlsCertificate — certificate handling", () => {
	function futureValidTo(days: number): string {
		return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
	}

	it("returns null when the certificate has no valid_to", async () => {
		const { destroy } = primeSocket({ cert: { issuer: {} } });
		expect(await checkTlsCertificate("https://example.com")).toBeNull();
		expect(destroy).toHaveBeenCalled();
	});

	it("returns null when getPeerCertificate returns a falsy cert", async () => {
		const { destroy } = primeSocket({ cert: null });
		expect(await checkTlsCertificate("https://example.com")).toBeNull();
		expect(destroy).toHaveBeenCalled();
	});

	it("returns a valid result when authorized and not expired", async () => {
		const { destroy } = primeSocket({
			authorized: true,
			cert: {
				valid_to: futureValidTo(30),
				issuer: { O: "Lets Encrypt", CN: "R3" },
			},
		});
		const result = await checkTlsCertificate("https://example.com");
		expect(result).not.toBeNull();
		expect(result?.valid).toBe(true);
		expect(result?.expiresInDays).toBeGreaterThan(25);
		expect(result?.issuer).toBe("Lets Encrypt - R3");
		expect(destroy).toHaveBeenCalled();
	});

	it("reports valid=false when the socket is not authorized", async () => {
		primeSocket({
			authorized: false,
			cert: {
				valid_to: futureValidTo(30),
				issuer: { O: "Org", CN: "CN" },
			},
		});
		const result = await checkTlsCertificate("https://example.com");
		expect(result?.valid).toBe(false);
	});

	it("reports valid=false for an expired certificate even when authorized", async () => {
		primeSocket({
			authorized: true,
			cert: {
				valid_to: futureValidTo(-5),
				issuer: { O: "Org", CN: "CN" },
			},
		});
		const result = await checkTlsCertificate("https://example.com");
		expect(result?.valid).toBe(false);
		expect(result?.expiresInDays).toBeLessThan(0);
	});

	it("uses the first element when issuer fields are arrays", async () => {
		primeSocket({
			authorized: true,
			cert: {
				valid_to: futureValidTo(10),
				issuer: { O: ["First Org", "Second Org"], CN: ["First CN"] },
			},
		});
		const result = await checkTlsCertificate("https://example.com");
		expect(result?.issuer).toBe("First Org - First CN");
	});

	it("falls back to Unknown when issuer is missing entirely", async () => {
		primeSocket({
			authorized: true,
			cert: { valid_to: futureValidTo(10) },
		});
		const result = await checkTlsCertificate("https://example.com");
		expect(result?.issuer).toBe("Unknown");
	});

	it("falls back to Unknown when issuer fields are undefined", async () => {
		primeSocket({
			authorized: true,
			cert: { valid_to: futureValidTo(10), issuer: {} },
		});
		const result = await checkTlsCertificate("https://example.com");
		expect(result?.issuer).toBe("Unknown");
	});

	it("uses only issuer O when CN is absent", async () => {
		primeSocket({
			authorized: true,
			cert: { valid_to: futureValidTo(10), issuer: { O: "Org Only" } },
		});
		const result = await checkTlsCertificate("https://example.com");
		expect(result?.issuer).toBe("Org Only");
	});

	it("uses only the common name when O is absent", async () => {
		primeSocket({
			authorized: true,
			cert: { valid_to: futureValidTo(10), issuer: { CN: "CN Only" } },
		});
		const result = await checkTlsCertificate("https://example.com");
		expect(result?.issuer).toBe("CN Only");
	});

	it("treats an empty issuer array as null (Unknown)", async () => {
		primeSocket({
			authorized: true,
			cert: {
				valid_to: futureValidTo(10),
				issuer: { O: [], CN: [] },
			},
		});
		const result = await checkTlsCertificate("https://example.com");
		expect(result?.issuer).toBe("Unknown");
	});

	it("returns null when the connect callback throws", async () => {
		const { destroy } = primeSocket({ throwInCallback: true });
		expect(await checkTlsCertificate("https://example.com")).toBeNull();
		expect(destroy).toHaveBeenCalled();
	});
});

describe("checkTlsCertificate — socket failures", () => {
	it("returns null on a socket 'error' event", async () => {
		const { destroy } = primeSocket({ emit: "error" });
		expect(await checkTlsCertificate("https://example.com")).toBeNull();
		expect(destroy).toHaveBeenCalled();
	});

	it("returns null on a socket 'timeout' event", async () => {
		const { destroy } = primeSocket({ emit: "timeout" });
		expect(await checkTlsCertificate("https://example.com")).toBeNull();
		expect(destroy).toHaveBeenCalled();
	});
});

describe("checkTlsCertificate — opt-in egress filtering", () => {
	const ORIGINAL = process.env.BLOCK_PRIVATE_TARGETS;

	afterEach(() => {
		if (ORIGINAL === undefined) {
			delete process.env.BLOCK_PRIVATE_TARGETS;
		} else {
			process.env.BLOCK_PRIVATE_TARGETS = ORIGINAL;
		}
	});

	it("returns null without opening a socket for a blocked host", async () => {
		process.env.BLOCK_PRIVATE_TARGETS = "true";
		expect(await checkTlsCertificate("https://127.0.0.1/")).toBeNull();
		expect(connectMock).not.toHaveBeenCalled();
	});

	it("still probes an allowed public host when filtering is on", async () => {
		process.env.BLOCK_PRIVATE_TARGETS = "true";
		primeSocket({
			authorized: true,
			cert: {
				valid_to: new Date(
					Date.now() + 30 * 24 * 60 * 60 * 1000,
				).toUTCString(),
				issuer: { O: "Org", CN: "CN" },
			},
		});
		const result = await checkTlsCertificate("https://8.8.8.8/");
		expect(result).not.toBeNull();
		expect(connectMock).toHaveBeenCalled();
	});
});
