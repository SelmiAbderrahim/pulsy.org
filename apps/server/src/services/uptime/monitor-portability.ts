import { createHash, randomBytes } from "node:crypto";
import { encrypt } from "../../lib/crypto";
import { db, MonitorManifestError, uptimeMonitor, uptimeHeartbeat, uptimeServer, uptimeMonitorChannelBinding, parseMonitorManifest, portableHttpUrl, type ManifestMonitor, type MonitorManifest, type DbExecutor, user } from "@pulsy/db";
import { and, asc, count, eq, inArray, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Translator } from "../../lib/i18n";
import { assertOwnedChannelReferences } from "./channel-bindings";
import { assertCredentialOrigin, httpConfigPatch } from "./http-config";
import { redactIncidentText } from "./incident-text";
import { rescheduleMonitorCheck } from "./scheduler-service";
import { firstCheckAt } from "./first-check";
import { isMonitorHostAllowed, isMonitorUrlAllowed } from "./egress-input";
type Monitor = typeof uptimeMonitor.$inferSelect;
const invalid = (t: Translator) => new TRPCError({ code: "BAD_REQUEST", message: t("errors.manifestInvalid") });
const owned = (userId: string, id: string) => and(eq(uptimeMonitor.userId, userId), eq(uptimeMonitor.uptimeMonitorId, id));
const generatedKey = (row: Monitor) => `pulsy:${row.uptimeMonitorId}`;
const keyOf = (row: Monitor) => row.externalKey ?? generatedKey(row);
function canonical(value: unknown): string {
  const sorted = (item: unknown): unknown => Array.isArray(item) ? item.map(sorted) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sorted(child)])) : item;
  return JSON.stringify(sorted(value)) ?? "undefined";
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
function safeDiffValue(row: Monitor | undefined, value: unknown, t: Translator): unknown {
  if (typeof value === "string") return redactIncidentText(row ?? { requestCipher: null }, value, t);
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    const encoded = String(value);
    return redactIncidentText(row ?? { requestCipher: null }, encoded, t) === encoded ? value : "[redacted]";
  }
  if (Array.isArray(value)) return value.map(child => safeDiffValue(row, child, t));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, safeDiffValue(row, child, t)]));
  return value;
}
function decode(text: string, t: Translator) {
  try { return parseMonitorManifest(text); } catch (error) {
    if (error instanceof MonitorManifestError) throw new TRPCError({ code: "BAD_REQUEST", message: error.column ? t("errors.manifestJson", { line: error.line ?? 1, column: error.column, reason: t(`errors.jsonReason.${error.reason}`) }) : t("errors.manifestInvalidField", { field: error.field }) });
    throw invalid(t);
  }
}
function baseConfiguration(row: Monitor) {
  return { name: row.name, interval: row.interval, active: row.active, tags: row.tags ?? [] };
}
function httpConfiguration(row: Monitor) {
  return { url: row.url, method: row.method, expectedStatus: row.expectedStatus, expectedStatuses: row.expectedStatuses, tlsMonitoringEnabled: row.tlsMonitoringEnabled, timeout: row.timeout, failureThreshold: row.failureThreshold, redirectPolicy: row.redirectPolicy, httpAssertions: row.httpAssertions, latencyPolicy: row.latencyPolicy };
}
export async function exportMonitorConfiguration(userId: string, ids: string[], t: Translator) {
  if (!ids.length || ids.length > 200 || new Set(ids).size !== ids.length) throw invalid(t);
  const rows = await db.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, userId), inArray(uptimeMonitor.uptimeMonitorId, ids))).orderBy(asc(uptimeMonitor.uptimeMonitorId));
  if (rows.length !== ids.length) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "monitor" }) });
  if (rows.some(row => row.monitorType === "server")) throw new TRPCError({ code: "BAD_REQUEST", message: t("errors.serverExportUnsupported") });
  const heartbeats = await db.select().from(uptimeHeartbeat).where(and(eq(uptimeHeartbeat.userId, userId), inArray(uptimeHeartbeat.monitorId, ids)));
  const bindings = await db.select().from(uptimeMonitorChannelBinding).where(and(eq(uptimeMonitorChannelBinding.userId, userId), inArray(uptimeMonitorChannelBinding.monitorId, ids)));
  const monitors = rows.map(row => {
    if (redactIncidentText(row, keyOf(row), t) !== keyOf(row)) throw invalid(t);
    const common = { key: keyOf(row), type: row.monitorType, ...baseConfiguration(row), name: redactIncidentText(row, row.name, t), tags: (row.tags ?? []).map(tag => redactIncidentText(row, tag, t)), channelIds: bindings.filter(binding => binding.monitorId === row.uptimeMonitorId).map(binding => binding.channelId).sort() };
    if (row.monitorType === "heartbeat") {
      const heartbeat = heartbeats.find(value => value.monitorId === row.uptimeMonitorId); if (!heartbeat) throw invalid(t);
      return { ...common, graceSeconds: heartbeat.graceSeconds, needsReentry: ["heartbeatToken"] };
    }
    if (row.monitorType === "dns" || row.monitorType === "tcp") {
      if (row.networkConfig?.type !== row.monitorType) throw invalid(t);
      return { ...common, configuration: row.networkConfig, timeout: row.timeout, failureThreshold: row.failureThreshold, latencyPolicy: row.latencyPolicy };
    }
    if (row.monitorType !== "http") throw invalid(t);
    const needsReentry: string[] = row.requestCipher ? ["request"] : [];
    const url = portableHttpUrl(row.url);
    const safeUrl = url && redactIncidentText(row, url, t) === url ? url : null;
    if (!safeUrl) needsReentry.push("url");
    const configuration = httpConfiguration(row);
    // Known encrypted request values may also have been entered in assertion text.
    const assertions = JSON.stringify(configuration.httpAssertions);
    if (redactIncidentText(row, assertions, t) !== assertions) { needsReentry.push("assertions"); configuration.httpAssertions = []; }
    return { ...common, ...configuration, url: safeUrl, ...(needsReentry.length ? { needsReentry } : {}) };
  });
  // The same import trust boundary also removes sensitive header assertions.
  const parsed = decode(JSON.stringify({ format: "pulsy-monitor-configuration", version: 1, monitors }), t);
  for (const row of parsed.manifest.monitors) if (row.needsReentry?.includes("assertions") && row.type === "http") delete row.httpAssertions;
  return parsed;
}
async function snapshot(executor: DbExecutor, userId: string, manifest: MonitorManifest, lock = false) {
  const keys = manifest.monitors.flatMap(row => [row.key, ...(row.previousKey ? [row.previousKey] : [])]);
  const ids = keys.filter(key => key.startsWith("pulsy:")).map(key => key.slice(6));
  const query = executor.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, userId), or(inArray(uptimeMonitor.externalKey, keys), ids.length ? inArray(uptimeMonitor.uptimeMonitorId, ids) : undefined))).orderBy(asc(uptimeMonitor.uptimeMonitorId));
  const rows = lock ? await query.for("update") : await query;
  const rowIds = rows.map(row => row.uptimeMonitorId);
  const heartbeats = rowIds.length ? await executor.select().from(uptimeHeartbeat).where(and(eq(uptimeHeartbeat.userId, userId), inArray(uptimeHeartbeat.monitorId, rowIds))).orderBy(asc(uptimeHeartbeat.monitorId)) : [];
  const servers = rowIds.length ? await executor.select({ monitorId: uptimeServer.monitorId, thresholds: uptimeServer.thresholds, excludedFilesystems: uptimeServer.excludedFilesystems }).from(uptimeServer).where(and(eq(uptimeServer.userId, userId), inArray(uptimeServer.monitorId, rowIds))).orderBy(asc(uptimeServer.monitorId)) : [];
  const bindings = rowIds.length ? await executor.select().from(uptimeMonitorChannelBinding).where(and(eq(uptimeMonitorChannelBinding.userId, userId), inArray(uptimeMonitorChannelBinding.monitorId, rowIds))).orderBy(asc(uptimeMonitorChannelBinding.monitorId), asc(uptimeMonitorChannelBinding.channelId)) : [];
  const [{ value: total } = { value: 0 }] = await executor.select({ value: count() }).from(uptimeMonitor).where(eq(uptimeMonitor.userId, userId));
  const revision = digest({ manifest, total, servers, rows: rows.map(row => ({ id: row.uptimeMonitorId, key: row.externalKey, type: row.monitorType, networkConfig: row.networkConfig, ...baseConfiguration(row), ...httpConfiguration(row), cipher: row.requestCipher })), heartbeats: heartbeats.map(row => ({ id: row.monitorId, graceSeconds: row.graceSeconds })), bindings: bindings.map(row => ({ monitorId: row.monitorId, channelId: row.channelId })) });
  return { rows, heartbeats, servers, bindings, total, revision };
}
type Change = { field: string; before: unknown; after: unknown };
type Entry = { key: string; action: "create" | "update" | "unchanged" | "rejected"; changes: Change[]; reasons: string[] };
/** Egress-policy verdicts keyed by destination; apply reuses the unlocked pass's DNS answers inside its transaction. */
type TargetVerdicts = Map<string, boolean>;
async function targetAllowed(verdicts: TargetVerdicts, key: string, check: () => Promise<boolean>) {
  if (!verdicts.has(key)) verdicts.set(key, await check());
  return verdicts.get(key)!;
}
async function reconciliation(executor: DbExecutor, userId: string, text: string, t: Translator, lock = false, verdicts: TargetVerdicts = new Map()) {
  const parsed = decode(text, t); const state = await snapshot(executor, userId, parsed.manifest, lock);
  const entries: Entry[] = []; const operations: Array<{ input: ManifestMonitor; existing?: Monitor; values: Record<string, unknown>; channelIds?: string[] }> = [];
  const targets = new Set<string>();
  for (const input of parsed.manifest.monitors) {
    for (const field of input.needsReentry ?? []) if (!parsed.warnings.some(warning => warning.key === input.key && warning.field === (field === "request" ? "privateValues" : field))) parsed.warnings.push({ key: input.key, field: field === "request" ? "privateValues" : field });
    const currentMatch = state.rows.find(row => keyOf(row) === input.key);
    const previousMatch = input.previousKey ? state.rows.find(row => keyOf(row) === input.previousKey) : undefined;
    const existing = currentMatch ?? previousMatch;
    const collision = state.rows.some(row => generatedKey(row) === input.key && row.externalKey && row.externalKey !== input.key);
    const reasons: string[] = [];
    if (collision) reasons.push("keyCollision");
    if (input.previousKey && !existing || currentMatch && previousMatch && currentMatch.uptimeMonitorId !== previousMatch.uptimeMonitorId || existing && targets.has(existing.uptimeMonitorId)) reasons.push("keyCollision");
    if (existing) targets.add(existing.uptimeMonitorId);
    if (existing && existing.monitorType !== input.type) reasons.push("typeChange");
    try { await assertOwnedChannelReferences(executor, userId, input.channelIds ?? [], t); } catch { reasons.push("channel"); }
    const values: Record<string, unknown> = { externalKey: input.key, name: input.name, interval: input.interval, tags: input.tags, active: input.active };
    if (input.type === "server") {
      values.active = existing?.active ?? false;
      parsed.warnings.push({ key: input.key, field: "serverToken" });
    } else if (input.type === "heartbeat") {
      // Imported activation cannot retrieve a hash-only token. Preserve existing
      // activation; new jobs stay inactive until explicit rotation/setup/settings.
      values.active = existing?.active ?? false;
      parsed.warnings.push({ key: input.key, field: "heartbeatActivation" });
    } else if (input.type === "http") {
      if (input.url === null && !existing) reasons.push("urlRequired");
      if (input.url !== null && !await targetAllowed(verdicts, `url:${input.url}`, () => isMonitorUrlAllowed(input.url!))) reasons.push("targetBlocked");
      if (input.url !== null) values.url = input.url;
      try { assertCredentialOrigin(existing?.requestCipher, existing?.url ?? "", input.url ?? undefined, undefined, t); }
      catch { reasons.push("credentialOrigin"); }
      Object.assign(values, { method: input.method, expectedStatus: input.expectedStatus, expectedStatuses: input.expectedStatuses ?? null, tlsMonitoringEnabled: input.tlsMonitoringEnabled ?? existing?.tlsMonitoringEnabled ?? true, timeout: input.timeout, failureThreshold: input.failureThreshold, redirectPolicy: input.redirectPolicy });
      if (input.httpAssertions !== undefined) values.httpAssertions = input.httpAssertions;
      if (input.latencyPolicy !== undefined) values.latencyPolicy = input.latencyPolicy;
      const missingRequired = input.needsReentry?.some(field => field === "request" ? !existing?.requestCipher
        : field === "assertions" ? !existing?.httpAssertions.length : field === "url" ? !existing?.url : false);
      if (missingRequired) values.active = false;
      try { httpConfigPatch({}, input.method, t, existing?.requestCipher); } catch { reasons.push("retainedBody"); }
    } else {
      const { hostname, type } = input.configuration;
      if (!await targetAllowed(verdicts, `${type}:${hostname}`, () => isMonitorHostAllowed(hostname, type))) reasons.push("targetBlocked");
      Object.assign(values, { networkConfig: input.configuration, timeout: input.timeout, failureThreshold: input.failureThreshold });
      if (input.latencyPolicy !== undefined) values.latencyPolicy = input.latencyPolicy;
    }
    const changes: Change[] = existing ? Object.entries(values).filter(([field, value]) => canonical(existing[field as keyof Monitor]) !== canonical(value)).map(([field, after]) => ({ field, before: safeDiffValue(existing, existing[field as keyof Monitor], t), after: safeDiffValue(existing, after, t) })) : Object.entries(values).map(([field, after]) => ({ field, before: null, after: safeDiffValue(existing, after, t) }));
    if (input.type === "heartbeat") {
      const previous = state.heartbeats.find(row => row.monitorId === existing?.uptimeMonitorId)?.graceSeconds;
      if (previous !== input.graceSeconds) changes.push({ field: "graceSeconds", before: previous ?? null, after: input.graceSeconds });
    }
    if (input.type === "server") {
      const previous = state.servers.find(row => row.monitorId === existing?.uptimeMonitorId);
      for (const field of ["thresholds", "excludedFilesystems"] as const) if (canonical(previous?.[field]) !== canonical(input[field])) changes.push({ field, before: previous?.[field] ?? null, after: input[field] });
    }
    const previousChannels = existing ? state.bindings.filter(row => row.monitorId === existing.uptimeMonitorId).map(row => row.channelId).sort() : [];
    if (input.channelIds !== undefined && canonical(previousChannels) !== canonical([...new Set(input.channelIds)].sort())) changes.push({ field: "channelIds", before: previousChannels, after: [...new Set(input.channelIds)].sort() });
    entries.push({ key: input.key, action: reasons.length ? "rejected" : !existing ? "create" : changes.length ? "update" : "unchanged", changes, reasons });
    operations.push({ input, existing, values, channelIds: input.channelIds });
  }
  const counts = { create: 0, update: 0, unchanged: 0, rejected: 0 }; for (const entry of entries) counts[entry.action]++;
  return { manifest: parsed.manifest, warnings: parsed.warnings, revision: state.revision, counts, entries, operations };
}
export async function previewMonitorConfiguration(userId: string, text: string, t: Translator) {
  const { operations: _private, ...preview } = await reconciliation(db, userId, text, t); return preview;
}
export async function applyMonitorConfiguration(userId: string, text: string, revision: string, t: Translator) {
  if (!/^[a-f0-9]{64}$/.test(revision)) throw invalid(t);
  const verdicts: TargetVerdicts = new Map();
  const expected = await reconciliation(db, userId, text, t, false, verdicts);
  if (expected.revision !== revision) throw new TRPCError({ code: "CONFLICT", message: t("errors.manifestStale") });
  if (expected.counts.rejected) throw invalid(t);
  const changed = await db.transaction(async tx => {
    const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
    if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.notFound", { resource: "account" }) });
    const current = await reconciliation(tx, userId, text, t, true, verdicts);
    if (current.revision !== revision) throw new TRPCError({ code: "CONFLICT", message: t("errors.manifestStale") });
    if (current.counts.rejected) throw invalid(t);
    const changed: Monitor[] = []; const now = new Date().toISOString();
    for (const [index, operation] of current.operations.entries()) {
      if (current.entries[index]!.action === "unchanged") continue;
      const { input, existing, values } = operation;
      // Values come only from the schema and explicit configuration projection above.
      const patch = values as Partial<typeof uptimeMonitor.$inferInsert>;
      if (existing && !["heartbeat", "server"].includes(existing.monitorType)) {
        if (patch.active === false) patch.nextCheckAt = null;
        const resumed = patch.active === true && !existing.active;
        const retargeted = (["url", "method", "interval", "networkConfig"] as const)
          .some(field => Object.hasOwn(values, field) && canonical(existing[field]) !== canonical(values[field]));
        if ((patch.active ?? existing.active) && (resumed || retargeted)) patch.nextCheckAt = firstCheckAt(current.operations.length);
      }
      if (existing && Object.hasOwn(values, "latencyPolicy") && canonical(existing.latencyPolicy) !== canonical(values.latencyPolicy)) { patch.consecutiveSlow = 0; patch.consecutiveHealthy = 0; }
      const [monitor] = existing ? await tx.update(uptimeMonitor).set(patch).where(owned(userId, existing.uptimeMonitorId)).returning()
        : await tx.insert(uptimeMonitor).values({ ...patch, name: input.name, userId, monitorType: input.type, url: input.type === "http" ? input.url! : "", status: "pending", createdAt: now, nextCheckAt: input.type !== "heartbeat" && input.type !== "server" && patch.active ? firstCheckAt(current.operations.length) : null }).returning();
      if (!monitor) throw invalid(t);
      if (input.type === "heartbeat") {
        const scope = and(eq(uptimeHeartbeat.userId, userId), eq(uptimeHeartbeat.monitorId, monitor.uptimeMonitorId));
        const [configuration] = existing ? await tx.select().from(uptimeHeartbeat).where(scope).for("update") : [];
        if (existing && !configuration) throw invalid(t);
        if (configuration) {
          const scheduleChanged = existing!.interval !== input.interval || configuration.graceSeconds !== input.graceSeconds;
          const expectedAt = scheduleChanged ? new Date(Date.parse(configuration.lastSuccessAt ?? monitor.createdAt) + input.interval * 1000).toISOString() : configuration.expectedAt;
          const failed = existing!.status === "down" && configuration.nextDeadline === null && !!configuration.lastFailAt && (!configuration.lastSuccessAt || configuration.lastFailAt >= configuration.lastSuccessAt);
          const nextDeadline = failed ? null : scheduleChanged ? expectedAt : configuration.nextDeadline;
          await tx.update(uptimeHeartbeat).set({ graceSeconds: input.graceSeconds, expectedAt, nextDeadline }).where(scope);
          await tx.update(uptimeMonitor).set({ nextCheckAt: nextDeadline }).where(owned(userId, monitor.uptimeMonitorId));
        } else {
          const expectedAt = new Date(Date.parse(now) + input.interval * 1000).toISOString();
          const tokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
          await tx.insert(uptimeHeartbeat).values({ userId, monitorId: monitor.uptimeMonitorId, graceSeconds: input.graceSeconds, tokenHash, expectedAt, nextDeadline: expectedAt });
          await tx.update(uptimeMonitor).set({ nextCheckAt: expectedAt }).where(owned(userId, monitor.uptimeMonitorId));
        }
      }
      if (input.type === "server") {
        const scope = and(eq(uptimeServer.userId, userId), eq(uptimeServer.monitorId, monitor.uptimeMonitorId));
        if (existing) {
          const [config] = await tx.select().from(uptimeServer).where(scope).for("update");
          if (!config) throw invalid(t);
          const nextDeadline = monitor.active && config.lastReceivedAt ? new Date(Date.parse(config.lastReceivedAt) + monitor.interval * 3000).toISOString() : null;
          await tx.update(uptimeServer).set({ thresholds: input.thresholds, excludedFilesystems: input.excludedFilesystems, nextDeadline }).where(scope);
          await tx.update(uptimeMonitor).set({ nextCheckAt: nextDeadline }).where(owned(userId, monitor.uptimeMonitorId));
        } else {
          const token = randomBytes(32).toString("base64url");
          await tx.insert(uptimeServer).values({ userId, monitorId: monitor.uptimeMonitorId, thresholds: input.thresholds, excludedFilesystems: input.excludedFilesystems, tokenHash: createHash("sha256").update(token).digest("hex"), tokenCipher: encrypt(token) });
        }
      }
      if (operation.channelIds !== undefined) {
        await tx.delete(uptimeMonitorChannelBinding).where(and(eq(uptimeMonitorChannelBinding.userId, userId), eq(uptimeMonitorChannelBinding.monitorId, monitor.uptimeMonitorId)));
        const ids = [...new Set(operation.channelIds)]; if (ids.length) await tx.insert(uptimeMonitorChannelBinding).values(ids.map(channelId => ({ userId, monitorId: monitor.uptimeMonitorId, channelId })));
      }
      changed.push(monitor);
    }
    return changed;
  });
  // Scheduling is outside the transaction; restart also loads committed rows.
  for (const monitor of changed) rescheduleMonitorCheck(monitor);
  return { counts: expected.counts };
}
