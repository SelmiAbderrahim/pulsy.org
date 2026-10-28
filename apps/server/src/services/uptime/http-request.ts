import type { CheckErrorCode } from "@pulsy/db/check-error";
import { matchesExpectedStatus } from "@pulsy/db/http-status-rule";
import { apiHttpAssertions, apiHttpRequest } from "@pulsy/db/validation-http";
import { decrypt } from "../../lib/crypto";
import { safeFetch } from "../../lib/ssrf";
import { classifyCheckError, classifyUnexpectedHttpStatus } from "./check-error";
import type { HttpCheckResult } from "./checker-service";
import { evaluateHttpAssertions, MAX_ASSERTION_RESPONSE_BYTES } from "./http-assertions";
import type { UptimeMonitor } from "./monitor-service";

class RequestPolicyError extends Error {
	constructor(readonly code: CheckErrorCode) {
		super(code);
	}
}

async function boundedBody(response: Response): Promise<string | null> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const output = Buffer.alloc(MAX_ASSERTION_RESPONSE_BYTES);
	let bytes = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > MAX_ASSERTION_RESPONSE_BYTES) {
				await reader.cancel();
				return null;
			}
			output.set(chunk.value, bytes - chunk.value.byteLength);
		}
		return output.subarray(0, bytes).toString("utf8");
	} finally {
		reader.releaseLock();
	}
}

/** A single bounded response supplies every assertion; only safe reason codes leave this function. */
export async function performAdvancedHttpCheck(monitor: UptimeMonitor): Promise<HttpCheckResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), monitor.timeout);
	const start = performance.now();
	let httpStatus: number | null = null;
	const duration = () => Math.round(performance.now() - start);
	try {
		const rules = apiHttpAssertions.parse(monitor.httpAssertions ?? []);
		const config = apiHttpRequest.parse(monitor.requestCipher ? JSON.parse(decrypt(monitor.requestCipher)) : {});
		if (config.body !== undefined && monitor.method !== "POST") {
			throw new RequestPolicyError("invalid_configuration");
		}
		let method = monitor.method;
		let body = config.body;
		let headers = new Headers({ "User-Agent": "Pulsy-Uptime/1.0" });
		for (const header of config.headers) headers.set(header.name, header.value);
		if (config.contentType) headers.set("content-type", config.contentType);
		if (config.auth?.type === "basic") {
			headers.set("authorization", `Basic ${Buffer.from(`${config.auth.username}:${config.auth.password}`).toString("base64")}`);
		}
		if (config.auth?.type === "bearer") headers.set("authorization", `Bearer ${config.auth.token}`);
		const validTarget = (url: URL) => {
			if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
				throw new RequestPolicyError("invalid_configuration");
			}
		};
		let current = new URL(monitor.url);
		validTarget(current);
		let response: Response | undefined;
		for (let hop = 0; hop <= 5; hop++) {
			// safeFetch validates and pins each connection, including every redirect destination.
			response = await safeFetch(current.toString(), { method, headers, body, signal: controller.signal, redirect: "manual" });
			httpStatus = response.status;
			const location = [301, 302, 303, 307, 308].includes(response.status) ? response.headers.get("location") : null;
			if (!location || monitor.redirectPolicy === "manual") break;
			await response.body?.cancel();
			if (monitor.redirectPolicy === "error") throw new RequestPolicyError("redirect_rejected");
			if (hop === 5) throw new RequestPolicyError("too_many_redirects");
			const next = new URL(location, current);
			validTarget(next);
			if (next.origin !== current.origin) {
				if (body !== undefined && [307, 308].includes(response.status)) {
					throw new RequestPolicyError("redirect_rejected");
				}
				headers = new Headers({ "User-Agent": "Pulsy-Uptime/1.0" });
			}
			if ((response.status === 303 && method !== "HEAD") || ([301, 302].includes(response.status) && method === "POST")) {
				method = "GET";
				body = undefined;
				headers.delete("content-type");
			}
			current = next;
		}
		const needsBody = rules.some(rule => !rule.type.startsWith("header_"));
		const text = needsBody && method !== "HEAD" ? await boundedBody(response!) : undefined;
		if (!needsBody || method === "HEAD") await response!.body?.cancel();
		const assertionOutcomes = text === null
			? rules.map((rule, index) => {
				if (rule.type.startsWith("header_")) {
					return { ...evaluateHttpAssertions([rule], { headers: response!.headers })[0]!, index };
				}
				return { index, passed: false, reason: "response_limit" as const };
			})
			: evaluateHttpAssertions(rules, { text, headers: response!.headers });
		httpStatus = response!.status;
		const expected = matchesExpectedStatus(httpStatus, monitor);
		const assertionsFailed = assertionOutcomes.some(outcome => !outcome.passed);
		if (!expected || assertionsFailed) {
			return {
				status: assertionsFailed ? "down" : classifyUnexpectedHttpStatus(httpStatus), httpStatus, responseTime: duration(), assertionOutcomes,
				errorMessage: expected ? "assertion_failed" : "unexpected_status",
			};
		}
		return { status: "up", httpStatus, responseTime: duration(), assertionOutcomes };
	} catch (error) {
		const classified = controller.signal.aborted ? "response_timeout"
			: error instanceof RequestPolicyError ? error.code
				: classifyCheckError(error);
		const errorMessage = classified === "unknown" && !(error instanceof TypeError) ? "invalid_configuration" : classified;
		return {
			status: "down", httpStatus,
			responseTime: error instanceof RequestPolicyError && httpStatus !== null ? duration() : null,
			errorMessage,
		};
	} finally {
		clearTimeout(timeout);
	}
}
