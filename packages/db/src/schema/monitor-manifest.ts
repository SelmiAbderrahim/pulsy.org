import { apiServerReportingInterval } from "./validation-server-interval";
import { MAX_MONITOR_TIMEOUT_MS } from "./monitor-defaults";
import { apiExpectedStatuses } from "./http-status-rule";
import { jsonDiagnostic } from "./json-diagnostic";
import { z } from "zod";
import { apiServerConfiguration } from "./validation-server";
import { apiHttpAssertions } from "./validation-http";
import { apiLatencyPolicy } from "./validation-latency";
import { apiNetworkConfiguration } from "./validation-network";
const common = {
  key: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  previousKey: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/).optional(),
  name: z.string().trim().min(1).max(255), interval: z.number().int().min(30).max(604800),
  active: z.boolean(), tags: z.array(z.string().min(1).max(64)).max(50),
  needsReentry: z.array(z.enum(["request", "url", "assertions", "heartbeatToken", "serverToken"])).max(5).optional(),
  channelIds: z.array(z.string().min(1).max(64)).max(20).optional(),
};
export function portableHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    // Query/fragment values cannot be classified reliably. Require re-entry.
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || /\b[A-Za-z0-9_-]{43}\b/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
const http = z.object({ ...common, type: z.literal("http"), tags: z.array(z.string().min(1).max(50)).max(10),
  url: z.string().max(2048).refine(value => portableHttpUrl(value) !== null).nullable(),
  method: z.enum(["GET", "HEAD", "POST"]), expectedStatus: z.number().int().min(100).max(599), expectedStatuses: apiExpectedStatuses.nullable().optional(), tlsMonitoringEnabled: z.boolean().optional(),
  timeout: z.number().int().min(1000).max(MAX_MONITOR_TIMEOUT_MS), failureThreshold: z.number().int().min(1).max(10),
  redirectPolicy: z.enum(["follow", "manual", "error"]), httpAssertions: apiHttpAssertions.optional(),
  latencyPolicy: apiLatencyPolicy.nullable().optional(),
}).strict().refine(row => [30, 60, 300, 600, 1800, 3600].includes(row.interval));
const heartbeat = z.object({ ...common, type: z.literal("heartbeat"), name: z.string().trim().min(1).max(200), graceSeconds: z.number().int().min(0).max(604800) }).strict();
const network = z.object({ ...common, type: z.enum(["dns", "tcp"]), tags: z.array(z.string().min(1).max(50)).max(10), configuration: apiNetworkConfiguration,
  timeout: z.number().int().min(1000).max(MAX_MONITOR_TIMEOUT_MS), failureThreshold: z.number().int().min(1).max(10), latencyPolicy: apiLatencyPolicy.nullable().optional(),
}).strict().refine(row => row.type === row.configuration.type && [30, 60, 300, 600, 1800, 3600].includes(row.interval));
const server = apiServerConfiguration.pick({ thresholds: true, excludedFilesystems: true }).extend({ ...common, type: z.literal("server"), interval: apiServerReportingInterval }).strict();
export const apiMonitorManifest = z.object({
  format: z.literal("pulsy-monitor-configuration"), version: z.literal(1),
  monitors: z.array(z.union([http, heartbeat, network, server])).min(1).max(200),
}).strict().refine(value => new Set(value.monitors.map(row => row.key)).size === value.monitors.length);
export type MonitorManifest = z.infer<typeof apiMonitorManifest>;
export type ManifestMonitor = MonitorManifest["monitors"][number];
const secretFields = new Set(["requestConfig", "requestCipher", "headers", "body", "auth", "apiKey", "token", "tokenHash", "tokenCipher", "serverToken", "heartbeatToken", "heartbeatUrl", "recipients", "subscribers"]);
export class MonitorManifestError extends Error {
  constructor(readonly field = "manifest", readonly line?: number, readonly column?: number, readonly reason?: string) { super("Invalid monitor configuration manifest"); this.name = "MonitorManifestError"; }
}
const invalid = (field?: string, line?: number) => new MonitorManifestError(field, line);
/** The text boundary bounds parsing and validates dangerous keys before stripping secrets. */
export function parseMonitorManifest(text: string): { manifest: MonitorManifest; warnings: Array<{ key: string; field: string }> } {
  if (new TextEncoder().encode(text).byteLength > 262144) throw invalid();
  let parsed: unknown; try { parsed = JSON.parse(text); } catch (error) {
    const { line, column, reason } = jsonDiagnostic(text, error);
    throw new MonitorManifestError("JSON", line, column, reason);
  }
  const pending = [{ value: parsed, depth: 0 }]; let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 20000 || item.depth > 16) throw invalid();
    if (item.value && typeof item.value === "object") for (const [key, value] of Object.entries(item.value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw invalid();
      pending.push({ value, depth: item.depth + 1 });
      if (pending.length + nodes > 20000) throw invalid();
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid();
  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.monitors) || root.monitors.length > 200) throw invalid();
  const warnings: Array<{ key: string; field: string }> = [];
  for (const raw of root.monitors) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
    const row = raw as Record<string, unknown>; const reentry = new Set(Array.isArray(row.needsReentry) ? row.needsReentry : []);
    if (row.type === "http" && typeof row.url === "string") {
      let destination: URL; try { destination = new URL(row.url); } catch { throw invalid(); }
      if (!["http:", "https:"].includes(destination.protocol)) throw invalid();
    }
    const secrets: string[] = []; const privateItems = Object.entries(row).filter(([field]) => secretFields.has(field)).map(([, value]) => value);
    let examined = 0;
    while (privateItems.length) {
      if (++examined > 20000) throw invalid();
      const item = privateItems.pop();
      if (typeof item === "string" && item) {
        secrets.push(item);
        // Bound private leaf values per monitor to keep secret scanning finite.
        if (secrets.length > 500) throw invalid();
        // Body strings may encode objects containing individually repeated secrets.
        if (item.startsWith("{") || item.startsWith("[")) try { privateItems.push(JSON.parse(item)); } catch { /* Removed regardless of syntax. */ }
      } else if (typeof item === "number" || typeof item === "boolean" || item === null) secrets.push(String(item));
      else if (item && typeof item === "object") privateItems.push(...Object.values(item));
      if (secrets.length > 500) throw invalid();
    }
    const secretValues = [...new Set(secrets)].sort((a, b) => b.length - a.length);
    const containsSecret = (value: unknown): boolean => typeof value === "string" ? secretValues.some(secret => value.includes(secret))
      : typeof value === "number" || typeof value === "boolean" || value === null ? secretValues.includes(String(value))
      : Array.isArray(value) ? value.some(containsSecret) : !!value && typeof value === "object" && Object.values(value).some(containsSecret);
    if (containsSecret(row.key) || containsSecret(row.previousKey)) throw invalid();
    const redact = (value: unknown): unknown => typeof value === "string" ? secretValues.reduce((text, secret) => text.split(secret).join("[redacted]"), value)
      : Array.isArray(value) ? value.map(redact) : value;
    row.name = redact(row.name); row.tags = redact(row.tags);
    // Warning keys are validated identifiers only, never source text or secret values.
    const key = typeof row.key === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(row.key) ? row.key : "invalid";
    for (const field of Object.keys(row)) if (secretFields.has(field)) {
      delete row[field]; warnings.push({ key, field: "privateValues" }); reentry.add("request");
    }
    if (row.type === "http" && typeof row.url === "string" && (!portableHttpUrl(row.url) || containsSecret(row.url))) {
      row.url = null; warnings.push({ key, field: "url" }); reentry.add("url");
    }
    if (Array.isArray(row.httpAssertions) && (containsSecret(row.httpAssertions) || row.httpAssertions.some(rule => rule && typeof rule === "object" && (
      "name" in rule && typeof rule.name === "string" && /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(rule.name)
      || "value" in rule && typeof rule.value === "string" && /(?:\b(?:Bearer|Basic)\s|\b[A-Za-z0-9_-]{43}\b)/i.test(rule.value)
    )))) {
      delete row.httpAssertions; reentry.add("assertions"); warnings.push({ key, field: "assertions" });
    }
    if (reentry.size) row.needsReentry = [...reentry];
  }
  const checked = apiMonitorManifest.safeParse(root);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    // A union failure identifies the affected monitor; direct schema issues name
    // a field. Never interpolate source values, unknown keys or Zod messages.
    const safeFields = new Set(["format", "version", "monitors", "key", "previousKey", "name", "interval", "active", "tags", "needsReentry", "channelIds", "type", "url", "method", "expectedStatus", "expectedStatuses", "tlsMonitoringEnabled", "timeout", "failureThreshold", "redirectPolicy", "httpAssertions", "latencyPolicy", "graceSeconds", "configuration"]);
    const path = issue?.path.map(part => typeof part === "number" ? `[${part}]` : typeof part === "string" && safeFields.has(part) ? part : "field").join(".") || "manifest";
    throw invalid(path);
  }
  return { manifest: checked.data, warnings };
}
