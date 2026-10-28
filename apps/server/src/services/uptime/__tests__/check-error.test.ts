import { describe, expect, it } from "vitest";
import { CHECK_ERROR_CODES, checkErrorCodeOf, type CheckErrorCode } from "@pulsy/db/check-error";
import { DICTIONARIES, SUPPORTED_LANGUAGES, getTranslator } from "../../../lib/i18n";
import { SsrfBlockedError } from "../../../lib/ssrf";
import { classifyCheckError, describeCheckReason } from "../check-error";

const system = (code: string) => Object.assign(new Error(`${code} host`), { code });
// undici: TypeError("fetch failed") with the system error on `cause`, sometimes nested.
const undici = (code: string, depth = 1) => {
	let cause: Error = system(code);
	for (let i = 1; i < depth; i++) cause = new Error("connect", { cause });
	return new TypeError("fetch failed", { cause });
};

describe("classifyCheckError — every system code, at every cause depth", () => {
	const table: Array<[string, CheckErrorCode]> = [
		["ENOTFOUND", "dns_not_found"], ["ENODATA", "dns_no_records"], ["EAI_AGAIN", "dns_temporary"],
		["ESERVFAIL", "dns_temporary"], ["ETIMEOUT", "dns_temporary"], ["ECONNREFUSED", "connection_refused"],
		["ECONNRESET", "connection_reset"], ["EPIPE", "connection_reset"], ["UND_ERR_SOCKET", "connection_reset"],
		["ETIMEDOUT", "connection_timeout"], ["UND_ERR_CONNECT_TIMEOUT", "connection_timeout"],
		["UND_ERR_HEADERS_TIMEOUT", "response_timeout"], ["UND_ERR_BODY_TIMEOUT", "response_timeout"],
		["CERT_HAS_EXPIRED", "tls_expired"], ["CERT_NOT_YET_VALID", "tls_untrusted"],
		["DEPTH_ZERO_SELF_SIGNED_CERT", "tls_untrusted"], ["SELF_SIGNED_CERT_IN_CHAIN", "tls_untrusted"],
		["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls_untrusted"], ["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "tls_untrusted"],
		["ERR_TLS_CERT_ALTNAME_INVALID", "tls_hostname_mismatch"], ["ETOOMANYREDIRECTS", "too_many_redirects"],
		["EREDIRECTREJECTED", "redirect_rejected"], ["EDESTINATION", "blocked_target"],
	];

	it.each(table)("%s maps to %s directly, one level down and two levels down", (code, expected) => {
		expect(classifyCheckError(system(code))).toBe(expected);
		expect(classifyCheckError(undici(code, 1))).toBe(expected);
		expect(classifyCheckError(undici(code, 2))).toBe(expected);
	});

	it("never reports ENOTFOUND as connection_refused, even with a refused sibling in a happy-eyeballs aggregate", () => {
		expect(classifyCheckError(undici("ENOTFOUND", 3))).not.toBe("connection_refused");
		const aggregate = new TypeError("fetch failed", { cause: new AggregateError([system("ENOTFOUND"), system("ECONNREFUSED")]) });
		expect(classifyCheckError(aggregate)).toBe("dns_not_found");
	});

	it("handles aborts, bare failures, blocked egress, cyclic causes and non-errors", () => {
		expect(classifyCheckError(new DOMException("aborted", "AbortError"))).toBe("response_timeout");
		expect(classifyCheckError(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe("response_timeout");
		expect(classifyCheckError(new TypeError("fetch failed"), true)).toBe("response_timeout");
		expect(classifyCheckError(new TypeError("fetch failed"))).toBe("unknown");
		expect(classifyCheckError(new TypeError("fetch failed", { cause: new SsrfBlockedError("private") }))).toBe("blocked_target");
		const loop: { cause?: unknown } = new Error("loop");
		loop.cause = loop;
		expect(classifyCheckError(loop)).toBe("unknown");
		for (const value of [null, undefined, "ENOTFOUND", 42]) expect(classifyCheckError(value)).toBe("unknown");
	});
});

describe("taxonomy codes render in every locale", () => {
	it("round-trips every code through checkErrorCodeOf", () => {
		for (const code of CHECK_ERROR_CODES) expect(checkErrorCodeOf(code)).toBe(code);
		expect(checkErrorCodeOf("DNS resolution failed")).toBe("dns_not_found");
		expect(checkErrorCodeOf("free text")).toBeNull();
	});

	it("has a non-empty, locale-resolved label for every code in en, ar, fr, de and es", () => {
		expect(SUPPORTED_LANGUAGES).toEqual(["en", "ar", "fr", "de", "es"]);
		for (const language of SUPPORTED_LANGUAGES) {
			const t = getTranslator(language);
			for (const code of CHECK_ERROR_CODES) {
				const key = `checkErrors.${code}`;
				expect(DICTIONARIES[language][key], `${language}:${key}`).toBeTruthy();
				const label = describeCheckReason(code, t, { timeoutMs: 5000, httpStatus: 503 });
				expect(label, `${language}:${code}`).toBeTruthy();
				expect(label).not.toContain("{{");
				expect(label).not.toBe(code);
				expect(label).not.toMatch(/^checkErrors\./);
			}
		}
	});

	it("never shows the raw enum string for a stored legacy English message", () => {
		const t = getTranslator("fr");
		expect(describeCheckReason("Connection refused", t)).not.toBe("connection_refused");
		expect(describeCheckReason("Connection refused", t)).toBe(describeCheckReason("connection_refused", t));
	});
});
