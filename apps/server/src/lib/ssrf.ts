import { isIP } from "node:net";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { Agent } from "undici";

// ---------------------------------------------------------------------------
// Egress policy for outbound connections to user-controlled destinations.
//
// Pulsy connects to destinations the user supplies — HTTP monitor targets,
// TCP/DNS monitor hosts, webhook / Slack / Discord notification endpoints and
// TLS-probe hosts. Every one of those paths goes through this module, which is
// the single owner of the policy and the only reader of its configuration.
//
// OSS allows private/LAN destinations by default. Set
// MONITOR_ALLOW_PRIVATE_NETWORKS=false to restrict destinations to public
// addresses. BLOCK_PRIVATE_TARGETS=true is the deprecated equivalent when the
// new setting is absent.
// Intrinsically unsafe destinations (metadata, `0.0.0.0/8`, link-local,
// IPv4-mapped IPv6 literals, bad schemes, credentials in URLs, port 0) stay
// blocked in every mode.
//
// Input validation (`assertAllowedHostname`, `assertOutboundUrlAllowed`) runs on
// every create/update/import path. Resolution is then pinned at connect time:
// `validatingLookup` is the lookup hook of the sockets themselves (the undici
// dispatcher below and the TLS probe) and `resolveAndPin` feeds the TCP/SMTP
// sockets in outbound-socket.ts, so the address that was validated is the
// address that is connected to — a rebinding DNS server or a wildcard name such
// as `127.0.0.1.nip.io` cannot swap a private address in between. Redirects are
// followed manually and every hop is re-validated.
// ---------------------------------------------------------------------------

const MAX_REDIRECTS = 5;

export class SsrfBlockedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SsrfBlockedError";
	}
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

/** OSS permits private monitoring by default; an explicit new setting wins. */
export function isPrivateNetworkAllowed(): boolean {
  const current = process.env.MONITOR_ALLOW_PRIVATE_NETWORKS?.trim().toLowerCase();
  if (current) return TRUE_VALUES.has(current);
  return process.env.BLOCK_PRIVATE_TARGETS?.trim().toLowerCase() !== "true";
}

export function isEgressFilteringEnabled(): boolean {
  return !isPrivateNetworkAllowed();
}

export function describeEgressPolicy(): string[] {
  const lines: string[] = [];
  if (process.env.BLOCK_PRIVATE_TARGETS?.trim()) {
    lines.push("[egress] BLOCK_PRIVATE_TARGETS is deprecated; use MONITOR_ALLOW_PRIVATE_NETWORKS=false to deny private targets. An explicit MONITOR_ALLOW_PRIVATE_NETWORKS takes precedence.");
  }
  if (isPrivateNetworkAllowed()) {
    lines.push("[egress] WARNING: private/LAN destinations are allowed (OSS default). Metadata and link-local destinations remain blocked. Set MONITOR_ALLOW_PRIVATE_NETWORKS=false when private access is unwanted.");
  } else {
    lines.push("[egress] Private-network destinations are blocked.");
  }
  return lines;
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
export function expandIpv6(value: string): number[] | null {
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
	// ::/96 covers :: (unspecified), ::1 (loopback) and deprecated IPv4-compatible
	// addresses, which some stacks still route to the embedded IPv4.
	if (bytes.slice(0, 12).every((x) => x === 0)) return true;
	// 64:ff9b::/96 NAT64: judge the embedded IPv4; 64:ff9b:1::/48 is local-use.
	if (
		bytes[0] === 0x00 &&
		bytes[1] === 0x64 &&
		bytes[2] === 0xff &&
		bytes[3] === 0x9b
	) {
		if (bytes.slice(4, 12).every((x) => x === 0)) {
			return isBlockedIpv4([
				bytes[12] as number,
				bytes[13] as number,
				bytes[14] as number,
				bytes[15] as number,
			]);
		}
		if (bytes[4] === 0x00 && bytes[5] === 0x01) return true;
	}
	// 2002::/16 6to4: IPv4 is embedded in bytes 2-5.
	if (bytes[0] === 0x20 && bytes[1] === 0x02) {
		return isBlockedIpv4([
			bytes[2] as number,
			bytes[3] as number,
			bytes[4] as number,
			bytes[5] as number,
		]);
	}
	// 2001::/32 Teredo embeds an obfuscated IPv4 and is never a monitoring target.
	if (
		bytes[0] === 0x20 &&
		bytes[1] === 0x01 &&
		bytes[2] === 0x00 &&
		bytes[3] === 0x00
	) {
		return true;
	}
	if (bytes[0] === 0xff) return true; // ff00::/8 multicast
	if (bytes[0] === 0xfc || bytes[0] === 0xfd) return true; // fc00::/7 unique-local
	if (bytes[0] === 0xfe && ((bytes[1] as number) & 0xc0) === 0x80) return true; // fe80::/10 link-local
	return false;
}

/** Address forms that are never valid egress targets, even in OSS mode. */
function isAlwaysBlockedIp(ip: string): boolean {
	const v4 = ipv4Octets(ip);
	if (v4) return v4[0] === 0 || (v4[0] === 169 && v4[1] === 254);
	const bytes = expandIpv6(ip);
	if (!bytes) return true;
	const mapped =
		bytes.slice(0, 10).every((x) => x === 0) &&
		bytes[10] === 0xff &&
		bytes[11] === 0xff;
	if (mapped) return true;
  // AWS IMDS IPv6 endpoint, even when private/unique-local access is enabled.
  if (bytes.join(":") === "253:0:14:194:0:0:0:0:0:0:0:0:0:0:2:84") return true;
  const unsafeV4 = (a: number | undefined, b: number | undefined) => a === 0 || (a === 169 && b === 254);
  if (bytes.slice(0, 12).every(value => value === 0) && bytes[12] === 169 && bytes[13] === 254) return true;
  if (bytes[0] === 0 && bytes[1] === 100 && bytes[2] === 255 && bytes[3] === 155 && bytes.slice(4, 12).every(value => value === 0) && unsafeV4(bytes[12], bytes[13])) return true;
  if (bytes[0] === 32 && bytes[1] === 2 && unsafeV4(bytes[2], bytes[3])) return true;
	// ::/128 and link-local fe80::/10 are unusable/unsafe regardless of mode.
	if (bytes.every((x) => x === 0)) return true;
	return bytes[0] === 0xfe && ((bytes[1] as number) & 0xc0) === 0x80;
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

// Names that only ever resolve inside a private network or a container network.
const INTERNAL_SUFFIXES = ["localhost", "local", "internal", "lan", "home.arpa", "localdomain"];
// Cloud metadata names, blocked in every mode like the metadata address itself.
const METADATA_NAMES = new Set(["metadata.google.internal", "metadata.goog", "instance-data.ec2.internal", "metadata.azure.internal"]);

/** IPv4 octets embedded in a name such as `127.0.0.1.nip.io` or `10-0-0-1.sslip.io`. */
function embeddedIpv4(host: string): Array<[number, number, number, number]> {
	const found: Array<[number, number, number, number]> = [];
	const labels = host.split(".");
	for (let i = 0; i + 4 <= labels.length; i++) {
		const octets = ipv4Octets(labels.slice(i, i + 4).join("."));
		if (octets) found.push(octets);
	}
	for (const match of host.matchAll(/(?:^|[^0-9])(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})(?![0-9])/g)) {
		const octets = ipv4Octets(match.slice(1, 5).join("."));
		if (octets) found.push(octets);
	}
	return found;
}

/**
 * String-level checks on a hostname or IP literal (brackets allowed). Runs on
 * every input path before anything is stored; never touches DNS. `raw` is the
 * host exactly as the user typed it, used to reject non-canonical IP encodings
 * (`127.1`, `2130706433`, `0x7f.0.0.1`, `0177.0.0.1`) that URL parsers rewrite.
 */
export function assertAllowedHostname(host: string, raw: string = host): void {
	const bare = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
	if (!bare || bare.length > 253) throw new SsrfBlockedError("Invalid destination host");
	const typed = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
	const family = isIP(bare);
	if (family === 4 && typed !== bare) throw new SsrfBlockedError("Non-canonical IP address encoding");
	// A numeric final label makes URL parsers and getaddrinfo read the whole host
	// as an IPv4 number (`127.1`, `0x7f.1`); no public DNS name has one.
	if (family === 0 && /^(?:0x[0-9a-f]*|[0-9]+)$/.test(bare.slice(bare.lastIndexOf(".") + 1))) throw new SsrfBlockedError("Non-canonical IP address encoding");
	if (family) return assertAllowedAddress(bare);
	if (/[^a-z0-9._-]/.test(bare) || bare.split(".").some(label => !label || label.length > 63)) throw new SsrfBlockedError("Invalid destination host");
	if (METADATA_NAMES.has(bare)) throw new SsrfBlockedError("Blocked metadata destination");
	if (embeddedIpv4(bare).some(([a, b]) => a === 0 || (a === 169 && b === 254))) throw new SsrfBlockedError("Blocked metadata/link-local destination");
	if (!isEgressFilteringEnabled()) return;
	if (!bare.includes(".")) throw new SsrfBlockedError("Blocked private/internal hostname (single label)");
	if (INTERNAL_SUFFIXES.some(suffix => bare === suffix || bare.endsWith(`.${suffix}`))) throw new SsrfBlockedError("Blocked private/internal hostname");
	if (embeddedIpv4(bare).some(isBlockedIpv4)) throw new SsrfBlockedError("Blocked private/internal hostname (embedded address)");
}

/** Throw unless a resolved (or literal) IP address may be connected to. */
export function assertAllowedAddress(ip: string): void {
	if (!isIP(ip) || isAlwaysBlockedIp(ip) || (isEgressFilteringEnabled() && isBlockedIp(ip))) {
		// The address is deliberately not echoed: callers surface this message to
		// users, and it would turn DNS into an internal-address oracle.
		throw new SsrfBlockedError("Blocked private/internal address");
	}
}

export type EgressResolver = (host: string) => Promise<Array<{ address: string; family: number }>>;
const systemResolver: EgressResolver = async host => lookup(host, { all: true });
// 16 answers per name; raise when measured multi-homed targets need it.
const MAX_RESOLVED_ADDRESSES = 16;

/**
 * Resolve `host`, reject if ANY answer is disallowed, and return the address to
 * connect to. Callers connect to `address` (keeping `host` for Host/SNI), so the
 * validated answer is the one used. `resolver` is injectable for tests.
 */
export async function resolveAndPin(host: string, resolver: EgressResolver = systemResolver): Promise<{ address: string; family: number }> {
	const bare = host.replace(/^\[|\]$/g, "");
	assertAllowedHostname(bare);
	const family = isIP(bare);
	if (family) return { address: bare, family };
	const answers = await resolver(bare);
	if (!answers.length || answers.length > MAX_RESOLVED_ADDRESSES) throw Object.assign(new Error(`No usable address for ${bare}`), { code: "ENOTFOUND" });
	for (const answer of answers) assertAllowedAddress(answer.address);
	return answers[0]!;
}

/** The authority host exactly as typed (before WHATWG normalisation). */
function typedUrlHost(rawUrl: string): string | null {
	const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\\]*)/i.exec(rawUrl.trim());
	if (!match) return null;
	let authority = match[1] as string;
	const at = authority.lastIndexOf("@");
	if (at !== -1) authority = authority.slice(at + 1);
	if (authority.startsWith("[")) return authority.slice(0, authority.indexOf("]") + 1);
	const colon = authority.indexOf(":");
	return colon === -1 ? authority : authority.slice(0, colon);
}

/**
 * Synchronous URL-shape checks shared by every input path: http(s) only, no
 * credentials, port 1–65535, and an allowed host. Returns the parsed URL.
 */
export function assertAllowedUrl(rawUrl: string): URL {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new SsrfBlockedError("Invalid URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfBlockedError(`Blocked URL scheme: ${url.protocol}`);
	if (url.username || url.password) throw new SsrfBlockedError("Credentials are not allowed in destination URLs");
	if (url.port !== "" && (Number(url.port) < 1 || Number(url.port) > 65535)) throw new SsrfBlockedError("Invalid destination port");
	assertAllowedHostname(url.hostname, typedUrlHost(rawUrl) ?? url.hostname);
	return url;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * `lookup` hook for `net`/`tls`/undici sockets: resolve once, refuse non-public
 * answers (when filtering is on), and hand the socket only validated addresses.
 */
export function validatingLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
	dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
		if (error) return callback(error, []);
		const list = addresses as LookupAddress[];
		if (!list.length) return callback(Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }), []);
		try {
			assertAllowedHostname(hostname);
			for (const entry of list) assertAllowedAddress(entry.address);
		} catch (blocked) {
			return callback(blocked as NodeJS.ErrnoException, []);
		}
		if (options.all) return callback(null, list);
		callback(null, list[0]!.address, list[0]!.family);
	});
}

let pinnedDispatcher: Agent | undefined;
/** undici dispatcher whose sockets resolve through `validatingLookup` (used in every mode). */
function pinned(): Agent {
	return (pinnedDispatcher ??= new Agent({ connect: { lookup: validatingLookup as never } }));
}

function blockedCause(error: unknown): SsrfBlockedError | null {
	for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
		if (current instanceof SsrfBlockedError) return current;
		current = (current as { cause?: unknown }).cause;
	}
	return null;
}

/**
 * Throw `SsrfBlockedError` unless `rawUrl` is an allowed http(s) URL whose host
 * resolves exclusively to allowed addresses. Runs in every mode; with private
 * networks allowed only the intrinsically unsafe destinations are rejected.
 */
export async function assertOutboundUrlAllowed(rawUrl: string, resolver?: EgressResolver): Promise<void> {
	const url = assertAllowedUrl(rawUrl);
	try {
		await resolveAndPin(url.hostname, resolver);
	} catch (error) {
		if (error instanceof SsrfBlockedError) throw error;
		// Permissive self-hosted mode leaves reachability to the connect itself
		// (offline/mocked targets stay usable); the strict policy fails closed.
		if (!isEgressFilteringEnabled()) return;
		// Keep the resolver error on `cause` so checkers can report NXDOMAIN vs temporary failures.
		throw Object.assign(new SsrfBlockedError(`DNS resolution failed for ${url.hostname}`), { cause: error });
	}
}

function redirectLocation(response: Response): string | null {
	if (response.status < 300 || response.status >= 400) return null;
	return response.headers?.get?.("location") ?? null;
}

// Headers that stay on a cross-origin redirect hop. Everything else (Authorization,
// Cookie and operator-defined webhook headers such as X-Api-Key) is credentials.
const CROSS_ORIGIN_SAFE_HEADERS = new Set([
	"accept",
	"accept-language",
	"content-type",
	"user-agent",
]);

/**
 * Build the next hop's request the way `fetch` itself would: 301/302 on POST and
 * 303 become a body-less GET, and a cross-origin hop loses credential headers.
 */
function redirectedRequest(
	init: RequestInit | undefined,
	status: number,
	from: URL,
	to: URL,
): RequestInit | undefined {
	if (!init) return init;
	let next: RequestInit = init;
	const method = (init.method ?? "GET").toUpperCase();
	if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
		const { body: _body, ...rest } = init;
		next = { ...rest, method: method === "HEAD" ? "HEAD" : "GET" };
	}
	if (from.origin !== to.origin && next.headers) {
		const kept = new Headers();
		for (const [name, value] of new Headers(next.headers)) {
			if (CROSS_ORIGIN_SAFE_HEADERS.has(name.toLowerCase())) kept.set(name, value);
		}
		next = { ...next, headers: kept };
	}
	return next;
}

/**
 * Drop-in `fetch` for user-controlled URLs: validates the URL, pins resolution
 * to validated addresses, and follows at most MAX_REDIRECTS redirects manually,
 * re-validating every hop.
 */
export async function safeFetch(
	url: string,
	init?: RequestInit,
): Promise<Response> {
	// Every hop is validated and connected through the pinned dispatcher, so a
	// redirect or a rebinding answer cannot reach a disallowed address.
	let current = url;
	let request: RequestInit | undefined = init;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		await assertOutboundUrlAllowed(current);
		let response: Response;
		try {
			// `dispatcher` is undici's non-standard init option; Node's fetch honours it.
			const fetchInit: RequestInit = { ...request, redirect: "manual" };
			// Node's bundled dispatcher declarations can trail the installed undici.
			// Attach its supported runtime option without casting user request values.
			Object.assign(fetchInit, { dispatcher: pinned() });
			response = await fetch(current, fetchInit);
		} catch (error) {
			// A connect-time block surfaces from fetch as "fetch failed" with the cause attached.
			throw blockedCause(error) ?? error;
		}
		const location = redirectLocation(response);
		if (!location || init?.redirect === "manual") return response;
		if (init?.redirect === "error") {
			await response.body?.cancel();
			throw Object.assign(new SsrfBlockedError("Redirect rejected by request policy"), { code: "EREDIRECTREJECTED" });
		}
		await response.body?.cancel();
		const next = new URL(location, current);
		request = redirectedRequest(request, response.status, new URL(current), next);
		current = next.toString();
	}
	throw Object.assign(new SsrfBlockedError("Too many redirects"), { code: "ETOOMANYREDIRECTS" });
}
