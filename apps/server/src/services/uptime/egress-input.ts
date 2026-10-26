import { TRPCError } from "@trpc/server";
import type { Translator } from "../../lib/i18n";
import { assertAllowedHostname, assertOutboundUrlAllowed, SsrfBlockedError } from "../../lib/ssrf";
import { FieldValidationError } from "../../trpc/validation-errors";

// Input-time enforcement of the egress policy in lib/ssrf.ts. Every path that
// stores a monitor/template destination calls one of these, so create, update,
// bulk create, share clone, template save, test-configuration and import
// preview/apply all reject the same targets for the same reason.

/** Localized BAD_REQUEST; with a `field` it becomes a field error for forms. */
function blocked(t: Translator, field: string | null): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message: t("errors.targetBlocked"), ...(field ? { cause: new FieldValidationError(field, "errors.targetBlocked") } : {}) });
}

async function allowed(check: () => Promise<void> | void): Promise<boolean> {
  try { await check(); return true; } catch (error) { if (error instanceof SsrfBlockedError) return false; throw error; }
}

/**
 * Whether an HTTP monitor URL passes the policy (shape, name and DNS answers).
 * Scheme-less input is judged as the https URL normalisation will store, while
 * the host is still checked exactly as typed.
 */
export const isMonitorUrlAllowed = (url: string) => {
  const typed = url.trim();
  return allowed(() => assertOutboundUrlAllowed(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`));
};

/**
 * Whether a DNS/TCP monitor host passes the policy. TCP connects to the host, so
 * its answers are checked too; a DNS monitor only queries public resolvers for
 * the name, so it gets the name checks (and is answer-filtered at check time).
 */
export const isMonitorHostAllowed = (hostname: string, type: "dns" | "tcp") =>
  allowed(() => type === "tcp" ? assertOutboundUrlAllowed(`http://${hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname}/`) : assertAllowedHostname(hostname));

export async function assertMonitorUrlAllowed(url: string, t: Translator, field: string | null = "url"): Promise<void> {
  if (!await isMonitorUrlAllowed(url)) throw blocked(t, field);
}

export async function assertMonitorHostAllowed(hostname: string, type: "dns" | "tcp", t: Translator, field: string | null = "configuration.hostname"): Promise<void> {
  if (!await isMonitorHostAllowed(hostname, type)) throw blocked(t, field);
}
