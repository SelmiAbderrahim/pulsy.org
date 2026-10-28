import { checkErrorCodeOf, type CheckErrorCode } from "@pulsy/db/check-error";
import type { Translator } from "../../lib/i18n";
import { SsrfBlockedError } from "../../lib/ssrf";

const BY_CODE: Record<string, CheckErrorCode> = {
  ENOTFOUND: "dns_not_found",
  ENODATA: "dns_no_records",
  EAI_AGAIN: "dns_temporary",
  ESERVFAIL: "dns_temporary",
  ETIMEOUT: "dns_temporary",
  ECONNREFUSED: "connection_refused",
  ECONNRESET: "connection_reset",
  EPIPE: "connection_reset",
  UND_ERR_SOCKET: "connection_reset",
  ETIMEDOUT: "connection_timeout",
  UND_ERR_CONNECT_TIMEOUT: "connection_timeout",
  UND_ERR_HEADERS_TIMEOUT: "response_timeout",
  UND_ERR_BODY_TIMEOUT: "response_timeout",
  CERT_HAS_EXPIRED: "tls_expired",
  CERT_NOT_YET_VALID: "tls_untrusted",
  DEPTH_ZERO_SELF_SIGNED_CERT: "tls_untrusted",
  SELF_SIGNED_CERT_IN_CHAIN: "tls_untrusted",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "tls_untrusted",
  UNABLE_TO_GET_ISSUER_CERT: "tls_untrusted",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "tls_untrusted",
  CERT_UNTRUSTED: "tls_untrusted",
  CERT_REVOKED: "tls_untrusted",
  ERR_TLS_CERT_ALTNAME_INVALID: "tls_hostname_mismatch",
  HOSTNAME_MISMATCH: "tls_hostname_mismatch",
  ETOOMANYREDIRECTS: "too_many_redirects",
  EREDIRECTREJECTED: "redirect_rejected",
  EDESTINATION: "blocked_target",
};

/** Preserve the same status-mismatch semantics for every HTTP request path. */
export function classifyUnexpectedHttpStatus(status: number): "down" | "degraded" {
  return status >= 400 ? "down" : "degraded";
}

/**
 * Classify a failed probe by walking the full `cause` chain: undici reports
 * `TypeError("fetch failed")` with the system error (ENOTFOUND, ECONNREFUSED,
 * TLS codes, …) on `cause`, sometimes nested. The first specific code wins; a
 * bare egress block is `blocked_target`; anything unrecognised is `unknown` —
 * never a guessed "connection refused".
 */
export function classifyCheckError(error: unknown, aborted = false): CheckErrorCode {
  let blocked = false;
  const seen = new Set<unknown>();
  for (let current: unknown = error; current && typeof current === "object" && !seen.has(current) && seen.size < 8; current = (current as { cause?: unknown }).cause) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && BY_CODE[code]) return BY_CODE[code]!;
    if (current instanceof SsrfBlockedError) blocked = true;
    const name = (current as { name?: unknown }).name;
    if (name === "AbortError" || name === "TimeoutError") return "response_timeout";
    if (current instanceof AggregateError) {
      // Happy-eyeballs connects report one error per address; classify the first specific one.
      for (const inner of current.errors) { const nested = classifyCheckError(inner); if (nested !== "unknown") return nested; }
    }
  }
  if (aborted) return "response_timeout";
  return blocked ? "blocked_target" : "unknown";
}

/**
 * Localized label for a stored check reason. Taxonomy codes (and legacy English
 * messages that map to one) use `checkErrors.*`; other text — latency causes,
 * owner notes — is returned unchanged. Same mapping as the web `formatCheckReason`.
 */
export function describeCheckReason(reason: string | null | undefined, t: Translator, context: { httpStatus?: number | null; timeoutMs?: number | null } = {}): string | null {
  if (!reason) return null;
  const code = checkErrorCodeOf(reason);
  if (!code) return reason;
  if (code === "response_timeout" && context.timeoutMs && context.timeoutMs > 0) return t("checkErrors.response_timeout", { seconds: Math.round(context.timeoutMs / 100) / 10 });
  if (code === "response_timeout") return t("checkErrors.response_timeout_unknown");
  if (code === "unexpected_status" && context.httpStatus) return t("checkErrors.unexpected_status_code", { status: context.httpStatus });
  return t(`checkErrors.${code}`);
}
