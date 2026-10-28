import { expandIpv6 } from "./ssrf";

/**
 * Rate-limit key for a client address. IPv6 users routinely control a whole /64, so
 * keying on the full address would let one client mint unlimited identities (and
 * exhaust a bounded bucket table). IPv4 and IPv4-mapped addresses key on themselves.
 */
export function clientRateLimitKey(address: string): string {
	if (!address.includes(":")) return address;
	const bytes = expandIpv6(address);
	if (!bytes) return address;
	const mapped = bytes.slice(0, 10).every((x) => x === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
	if (mapped) return bytes.slice(12).join(".");
	return `${bytes.slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("")}::/64`;
}
