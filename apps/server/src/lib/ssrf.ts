import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

// ---------------------------------------------------------------------------
// SSRF egress filtering for outbound requests to user-controlled URLs.
//
// Pulsy fetches arbitrary URLs the user supplies — monitor targets, webhook /
// Slack / Discord notification endpoints, and TLS-probe hosts. On a single-user
// self-hosted instance that is the whole point (you monitor your own internal
// services), so this guard is OPT-IN via `BLOCK_PRIVATE_TARGETS=true`. Operators
// who expose signup to untrusted users SHOULD enable it: it blocks requests that
// resolve to loopback, private, link-local (incl. the 169.254.169.254 cloud
// metadata endpoint), unique-local, CGNAT, and other non-public ranges, and it
// re-validates every redirect hop so a public host cannot 30x-redirect inward.
//
// Validation resolves the hostname with DNS and inspects *every* resolved
// address, so a name that points at an internal IP is rejected too. (A
// determined attacker can still race DNS between this check and the socket
// connect — full pinning would need a custom dispatcher; this raises the bar
// substantially without one.)
// ---------------------------------------------------------------------------

const MAX_REDIRECTS = 5;

export class SsrfBlockedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SsrfBlockedError";
	}
}

/** Whether opt-in egress filtering is active (`BLOCK_PRIVATE_TARGETS=true`). */
export function isEgressFilteringEnabled(): boolean {
	return (process.env.BLOCK_PRIVATE_TARGETS ?? "").toLowerCase() === "true";
}

function ipv4Octets(value: string): [number, number, number, number] | null {
	const parts = value.split(".");
	if (parts.length !== 4) return null;
	const octets: number[] = [];
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return null;
		const n = Number(part);
		if (n > 255) return null;
		octets.push(n);
	}
	return octets as [number, number, number, number];
}

function isBlockedIpv4(octets: [number, number, number, number]): boolean {
	const [a, b, c] = octets;
	if (a === 0) return true; // 0.0.0.0/8 "this network"
	if (a === 10) return true; // 10.0.0.0/8 private
	if (a === 127) return true; // 127.0.0.0/8 loopback
	if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + metadata
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
	if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
	if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol
	if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
	if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
	if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + broadcast
	return false;
}

/** Expand any valid IPv6 textual form to its 16 bytes, or null if malformed. */
function expandIpv6(value: string): number[] | null {
	let text = value;
	const zone = text.indexOf("%");
	if (zone !== -1) text = text.slice(0, zone);

	const halves = text.split("::");
	if (halves.length > 2) return null;

	const toBytes = (segment: string): number[] | null => {
		if (segment === "") return [];
		const groups = segment.split(":");
		const bytes: number[] = [];
		for (let i = 0; i < groups.length; i++) {
			const group = groups[i] as string;
			if (group.includes(".")) {
				// Embedded IPv4 is only valid as the final group.
				if (i !== groups.length - 1) return null;
				const v4 = ipv4Octets(group);
				if (!v4) return null;
				bytes.push(v4[0], v4[1], v4[2], v4[3]);
			} else {
				if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
				const n = Number.parseInt(group, 16);
				bytes.push((n >> 8) & 0xff, n & 0xff);
			}
		}
		return bytes;
	};

	const head = toBytes(halves[0] as string);
	if (!head) return null;

	if (halves.length === 1) {
		return head.length === 16 ? head : null;
	}

	const tail = toBytes(halves[1] as string);
	if (!tail) return null;

	const fill = 16 - head.length - tail.length;
	if (fill < 0) return null;
	return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

function isBlockedIpv6(bytes: number[]): boolean {
	// IPv4-mapped (::ffff:a.b.c.d): defer to the IPv4 rules on the embedded addr.
	const mapped =
		bytes.slice(0, 10).every((x) => x === 0) &&
		bytes[10] === 0xff &&
		bytes[11] === 0xff;
	if (mapped) {
		return isBlockedIpv4([
			bytes[12] as number,
			bytes[13] as number,
			bytes[14] as number,
			bytes[15] as number,
		]);
	}
	if (bytes.every((x) => x === 0)) return true; // :: unspecified
	if (bytes.slice(0, 15).every((x) => x === 0) && bytes[15] === 1) return true; // ::1 loopback
	if (bytes[0] === 0xfc || bytes[0] === 0xfd) return true; // fc00::/7 unique-local
	if (bytes[0] === 0xfe && ((bytes[1] as number) & 0xc0) === 0x80) return true; // fe80::/10 link-local
	return false;
}

/**
 * Whether an IP address string points at a non-public destination. Unparseable
 * input is treated as blocked (fail closed).
 */
export function isBlockedIp(ip: string): boolean {
	const v4 = ipv4Octets(ip);
	if (v4) return isBlockedIpv4(v4);
	const v6 = expandIpv6(ip);
	if (v6) return isBlockedIpv6(v6);
	return true;
}

async function resolveAddresses(host: string): Promise<string[]> {
	if (isIP(host)) return [host];
	const results = await lookup(host, { all: true });
	return results.map((r) => r.address);
}

/**
 * Throw `SsrfBlockedError` if `rawUrl` is not an http(s) URL that resolves
 * exclusively to public addresses. A no-op when egress filtering is disabled.
 */
export async function assertOutboundUrlAllowed(rawUrl: string): Promise<void> {
	if (!isEgressFilteringEnabled()) return;

	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new SsrfBlockedError(`Invalid URL: ${rawUrl}`);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new SsrfBlockedError(`Blocked URL scheme: ${url.protocol}`);
	}

	const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

	let addresses: string[];
	try {
		addresses = await resolveAddresses(host);
	} catch {
		throw new SsrfBlockedError(`DNS resolution failed for ${host}`);
	}

	for (const address of addresses) {
		if (isBlockedIp(address)) {
			throw new SsrfBlockedError(
				`Blocked private/internal address ${address} for ${host}`,
			);
		}
	}
}

function redirectLocation(response: Response): string | null {
	if (response.status < 300 || response.status >= 400) return null;
	return response.headers.get("location");
}

/**
 * Drop-in `fetch` that enforces egress filtering when enabled. With the guard
 * off it is byte-for-byte the platform `fetch` (default redirect handling). With
 * it on, redirects are followed manually so every hop is re-validated.
 */
export async function safeFetch(
	url: string,
	init?: RequestInit,
): Promise<Response> {
	if (!isEgressFilteringEnabled()) {
		return fetch(url, init);
	}

	let current = url;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		await assertOutboundUrlAllowed(current);
		const response = await fetch(current, { ...init, redirect: "manual" });
		const location = redirectLocation(response);
		if (!location) return response;
		current = new URL(location, current).toString();
	}
	throw new SsrfBlockedError("Too many redirects");
}
