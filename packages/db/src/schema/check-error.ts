/**
 * Check failure taxonomy. Checkers persist one of these codes in the existing
 * `errorMessage` / `reason` / `cause` text columns; every surface (dashboard,
 * alerts, public pages, REST, exports) renders the localized label for the code.
 * Never persist English failure text for a classified failure.
 */
export const CHECK_ERROR_CODES = [
  "dns_not_found",
  "dns_temporary",
  "dns_no_records",
  "connection_refused",
  "connection_reset",
  "connection_timeout",
  "response_timeout",
  "tls_expired",
  "tls_untrusted",
  "tls_hostname_mismatch",
  "tls_error",
  "too_many_redirects",
  "redirect_rejected",
  "blocked_target",
  "unexpected_status",
  "assertion_failed",
  "invalid_configuration",
  "heartbeat_late",
  "heartbeat_missed",
  "heartbeat_failed",
  "heartbeat_unfinished",
  "unknown",
] as const;

export type CheckErrorCode = (typeof CHECK_ERROR_CODES)[number];

const CODES = new Set<string>(CHECK_ERROR_CODES);

export function isCheckErrorCode(value: unknown): value is CheckErrorCode {
  return typeof value === "string" && CODES.has(value);
}

// English messages stored before the taxonomy existed. Mapped so history,
// incidents and exports written by older releases render the same labels.
const LEGACY_MESSAGES: Record<string, CheckErrorCode> = {
  "connection refused": "connection_refused",
  "tcp connection refused": "connection_refused",
  "dns resolution failed": "dns_not_found",
  "dns name does not exist": "dns_not_found",
  "tcp hostname resolution failed": "dns_not_found",
  "dns resolution temporarily failed": "dns_temporary",
  "dns query timed out": "dns_temporary",
  "no dns records returned": "dns_no_records",
  "connection reset by server": "connection_reset",
  "connection timed out": "connection_timeout",
  "tcp connection timed out": "connection_timeout",
  "tcp connection failed": "unknown",
  "request timed out": "response_timeout",
  "tls/ssl certificate error": "tls_error",
  "too many redirects (exceeded 5)": "too_many_redirects",
  "redirect rejected by request policy": "redirect_rejected",
  "private post body cannot follow an unrelated-origin redirect": "redirect_rejected",
  "request destination blocked by network policy": "blocked_target",
  "tcp destination is prohibited by the network policy": "blocked_target",
  "dns answer is prohibited by the network policy": "blocked_target",
  "dns records do not match the expected set": "assertion_failed",
  "dns answer exceeds the supported bounds": "assertion_failed",
  "invalid null mx answer": "assertion_failed",
  "invalid network configuration": "invalid_configuration",
  "invalid dns configuration": "invalid_configuration",
  "invalid tcp configuration": "invalid_configuration",
  "invalid request destination": "invalid_configuration",
  "request body requires post": "invalid_configuration",
  "advanced request configuration or response could not be read": "invalid_configuration",
  "request failed: connection, tls or dns error": "unknown",
  "unknown error occurred": "unknown",
};

/**
 * The taxonomy code for a stored reason, or null for free text that is not a
 * check failure (latency policy causes, server-health reports, owner notes).
 */
export function checkErrorCodeOf(reason: string | null | undefined): CheckErrorCode | null {
  if (!reason) return null;
  if (isCheckErrorCode(reason)) return reason;
  const normalized = reason.trim().toLowerCase();
  const legacy = LEGACY_MESSAGES[normalized];
  if (legacy) return legacy;
  if (/^unexpected status: \d{3}\b/.test(normalized)) return "unexpected_status";
  if (/^assertion \d+: /.test(normalized)) return "assertion_failed";
  if (normalized.startsWith("network error: ")) return "unknown";
  return null;
}
