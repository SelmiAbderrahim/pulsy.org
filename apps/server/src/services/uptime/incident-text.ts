import { apiHttpRequest, type UptimeMonitorRow } from "@pulsy/db";
import { TRPCError } from "@trpc/server";
import { decrypt } from "../../lib/crypto";
import type { Translator } from "../../lib/i18n";
type Monitor = UptimeMonitorRow;
const invalid = (t: Translator) => new TRPCError({ code: "BAD_REQUEST", message: t("errors.incidentResponseInvalid") });
/** Private text is plain text. Known request values are removed BEFORE persistence. */
export function redactIncidentText(monitor: Pick<Monitor, "requestCipher">, text: string, t: Translator): string {
  const secrets: string[] = [];
  if (monitor.requestCipher) {
    try {
      const request = apiHttpRequest.parse(JSON.parse(decrypt(monitor.requestCipher)));
      secrets.push(...request.headers.map(header => header.value));
      if (request.auth?.type === "bearer") secrets.push(request.auth.token);
      if (request.auth?.type === "basic") secrets.push(request.auth.username, request.auth.password, Buffer.from(`${request.auth.username}:${request.auth.password}`).toString("base64"));
      if (request.body) {
        secrets.push(request.body);
        let body: unknown; try { body = JSON.parse(request.body); } catch { body = request.body.split(/[^A-Za-z0-9_-]+/); }
        const pending: unknown[] = [body]; let examined = 0;
        while (pending.length) {
          if (++examined > 10000 || secrets.length > 500) return "[redacted]";
          const value = pending.pop();
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) secrets.push(String(value));
          else if (value && typeof value === "object") pending.push(...Object.values(value));
        }
      }
    } catch { throw invalid(t); }
  }
  let safe = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, "");
  for (const secret of [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length)) safe = safe.split(secret).join("[redacted]");
  safe = safe.replace(/\b[A-Za-z0-9_-]{43}\b/g, "[redacted]").replace(/\b(?:Bearer|Basic)\s+[^\s]+/gi, "[redacted]");
  return safe.replace(/https?:\/\/[^\s<>]+/gi, value => {
    try { const url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.href; } catch { return "[redacted]"; }
  });
}
