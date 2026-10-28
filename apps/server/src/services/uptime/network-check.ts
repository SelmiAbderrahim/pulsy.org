import { MAX_MONITOR_TIMEOUT_MS } from "@pulsy/db/monitor-defaults";
import type { CheckErrorCode } from "@pulsy/db/check-error";
import {
	apiDnsConfiguration,
	apiTcpConfiguration,
	type DnsConfiguration,
	type NetworkConfiguration,
} from "@pulsy/db/validation-network";
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { connectOutboundSocket } from "../../lib/outbound-socket";
import {
	assertAllowedAddress,
	assertAllowedHostname,
	isEgressFilteringEnabled,
	SsrfBlockedError,
} from "../../lib/ssrf";
import { classifyCheckError } from "./check-error";
import type { HttpCheckResult } from "./checker-service";

const MAX_DNS_RECORDS = 50;
const MAX_TXT_BYTES = 4096;
const MAX_ANSWER_BYTES = 65536;

function normalizeAnswer(type: DnsConfiguration["recordType"], value: unknown): string {
	if (type === "MX") {
		if (
			!value || typeof value !== "object" ||
			!("exchange" in value) || typeof value.exchange !== "string" || value.exchange.length > 253 ||
			!("priority" in value) || typeof value.priority !== "number" ||
			!Number.isInteger(value.priority) || value.priority < 0 || value.priority > 65535
		) throw new Error("Invalid MX answer");
		return `${value.priority}:${value.exchange.toLowerCase().replace(/\.$/, "")}`;
	}
	if (type === "TXT") {
		if (Array.isArray(value)) {
			if (value.length > MAX_TXT_BYTES) throw new Error("Too many TXT chunks");
			let bytes = 0;
			for (const chunk of value) {
				if (typeof chunk !== "string" || chunk.length > MAX_TXT_BYTES) throw new Error("Invalid TXT chunk");
				bytes += Buffer.byteLength(chunk);
				if (bytes > MAX_TXT_BYTES) throw new Error("TXT answer too large");
			}
			value = value.join("");
		}
		if (typeof value !== "string" || value.length > MAX_TXT_BYTES || Buffer.byteLength(value) > MAX_TXT_BYTES) throw new Error("Invalid TXT answer");
		return value;
	}
	if (typeof value !== "string" || value.length > 253) throw new Error("Invalid DNS answer");
	if (type === "CNAME") return value.toLowerCase().replace(/\.$/, "");
	if (isIP(value) !== (type === "A" ? 4 : 6)) throw new Error("Invalid address answer");
	return type === "A" ? value : new URL(`http://[${value}]/`).hostname.slice(1, -1);
}

function answerSet(values: string[]): string {
	return JSON.stringify([...new Set(values)].sort());
}

/** Compare exact unordered sets without retaining DNS answers as response bodies. */
export function evaluateDnsAnswers(configuration: DnsConfiguration, answers: unknown[]): CheckErrorCode | undefined {
	if (!answers.length) return "dns_no_records";
	if (answers.length > MAX_DNS_RECORDS) return "assertion_failed";
	try {
		const actual = answers.map(value => normalizeAnswer(configuration.recordType, value));
		// A null MX is a single root exchange with priority zero, never an extra mail server.
		if (configuration.recordType === "MX" && actual.some(value => value.endsWith(":")) && (actual.length !== 1 || actual[0] !== "0:")) return "assertion_failed";
		if (Buffer.byteLength(JSON.stringify(actual)) > MAX_ANSWER_BYTES) return "assertion_failed";
		if (configuration.recordType === "A" || configuration.recordType === "AAAA") {
			// This also blocks metadata/link-local in the default LAN-permissive mode.
			for (const address of actual) assertAllowedAddress(address);
		}
		if (configuration.mode === "exists") return;
		const expected = configuration.expected.map(value => normalizeAnswer(configuration.recordType, value));
		return answerSet(actual) === answerSet(expected) ? undefined : "assertion_failed";
	} catch (error) {
		return error instanceof SsrfBlockedError ? "blocked_target" : "assertion_failed";
	}
}

/** Failures before an answer or connection have no latency sample. */
function result(start: number, errorMessage?: CheckErrorCode, answered = !errorMessage): HttpCheckResult {
	return {
		status: errorMessage ? "down" : "up",
		httpStatus: null,
		responseTime: answered ? Math.round(performance.now() - start) : null,
		...(errorMessage ? { errorMessage } : {}),
	};
}

function validTimeout(timeoutMs: number): boolean {
	return Number.isFinite(timeoutMs) && timeoutMs >= 1 && timeoutMs <= MAX_MONITOR_TIMEOUT_MS;
}

function errorCode(error: unknown): unknown {
	return error && typeof error === "object" && "code" in error ? error.code : undefined;
}

function queryDns(resolver: Resolver, configuration: DnsConfiguration): Promise<unknown[]> {
	switch (configuration.recordType) {
		case "A": return resolver.resolve4(configuration.hostname);
		case "AAAA": return resolver.resolve6(configuration.hostname);
		case "CNAME": return resolver.resolveCname(configuration.hostname);
		case "MX": return resolver.resolveMx(configuration.hostname);
		case "TXT": return resolver.resolveTxt(configuration.hostname);
	}
}

export async function performDnsCheck(input: DnsConfiguration, timeoutMs: number, fixtureResolver?: Resolver): Promise<HttpCheckResult> {
	const start = performance.now();
	const checked = apiDnsConfiguration.safeParse(input);
	if (!checked.success || !validTimeout(timeoutMs)) return result(start, "invalid_configuration");
	const configuration = checked.data;
	try {
		// Check the raw host too: URL parsing can disguise numeric IPv4 encodings.
		assertAllowedHostname(configuration.hostname);
	} catch {
		return result(start, "blocked_target");
	}
	let resolver: Resolver | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		resolver = fixtureResolver ?? new Resolver({ timeout: Math.ceil(timeoutMs), tries: 1 });
		// Strict mode must not expose split-horizon/internal DNS through the host resolver.
		if (!fixtureResolver && isEgressFilteringEnabled()) resolver.setServers(["1.1.1.1", "8.8.8.8"]);
		const activeResolver = resolver;
		const answers = await Promise.race([
			queryDns(activeResolver, configuration),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => {
					reject(Object.assign(new Error("DNS query timed out"), { code: "ETIMEOUT" }));
					activeResolver.cancel();
				}, timeoutMs);
			}),
		]);
		return result(start, evaluateDnsAnswers(configuration, answers), true);
	} catch (error) {
		const code = errorCode(error);
		const failure: CheckErrorCode = code === "ENOTFOUND" ? "dns_not_found"
			: code === "ENODATA" ? "dns_no_records"
			: code === "ETIMEOUT" || code === "ETIMEDOUT" || code === "ECANCELLED" ? "response_timeout"
			: "dns_temporary";
		return result(start, failure);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		resolver?.cancel();
	}
}

export async function performTcpCheck(input: Extract<NetworkConfiguration, { type: "tcp" }>, timeoutMs: number): Promise<HttpCheckResult> {
	const start = performance.now();
	const checked = apiTcpConfiguration.safeParse(input);
	if (!checked.success || !validTimeout(timeoutMs)) return result(start, "invalid_configuration");
	let socket: Awaited<ReturnType<typeof connectOutboundSocket>> | undefined;
	try {
		// The shared connector validates every answer and connects to the pinned numeric IP.
		socket = await connectOutboundSocket(checked.data.hostname, checked.data.port, timeoutMs);
		return result(start);
	} catch (error) {
		return result(start, classifyCheckError(error));
	} finally {
		socket?.destroy();
	}
}
