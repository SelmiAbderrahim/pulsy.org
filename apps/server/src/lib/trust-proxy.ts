/**
 * Number of reverse-proxy hops in front of the server whose `X-Forwarded-For`
 * entry may be believed (`TRUST_PROXY_HOPS`). Default 0: with no proxy, trusting
 * the header would let any client pick the IP that per-IP rate limits key on.
 * Behind the shipped nginx container the correct value is 1; a host proxy in
 * front of that nginx makes it 2. Invalid values fall back to 0 (fail closed).
 */
export function parseTrustProxyHops(raw: string | undefined): number {
	if (raw === undefined || !/^\d{1,2}$/.test(raw.trim())) return 0;
	return Math.min(Number(raw.trim()), 8);
}
