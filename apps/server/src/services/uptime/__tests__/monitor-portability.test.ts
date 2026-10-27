import { db, uptimeMonitor, uptimeHeartbeat, uptimeCheckLog, uptimeStatusPage, uptimeStatusPageMonitor } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
import { setSchedulingEnabled } from "../scheduler-service";
import { getTranslator } from "../../../lib/i18n";
import { exportMonitorConfiguration, previewMonitorConfiguration, applyMonitorConfiguration } from "../monitor-portability";
useCleanDatabase();
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const t = getTranslator("en");
const input = { key: "api-prod", type: "http", name: "API", url: "https://example.invalid/health", method: "GET", expectedStatus: 200, timeout: 10000, interval: 300, failureThreshold: 3, active: false, tags: ["prod"], redirectPolicy: "follow", httpAssertions: [{ type: "json", path: "$.status", op: "equals", value: "ok" }] };
const text = (rows: unknown[]) => JSON.stringify({ format: "pulsy-monitor-configuration", version: 1, monitors: rows });
describe("owner-scoped atomic configuration reconciliation", () => {
  it("keeps incomplete HTTP imports inactive on repeated apply until private request values are configured", async () => {
    const owner = await createTestUser();
    const encoded = text([{ ...input, active: true, needsReentry: ["request"] }]);
    const preview = await previewMonitorConfiguration(owner.id, encoded, t);
    await applyMonitorConfiguration(owner.id, encoded, preview.revision, t);
    const repeated = await previewMonitorConfiguration(owner.id, encoded, t);
    expect(repeated.counts.unchanged).toBe(1);
    await applyMonitorConfiguration(owner.id, encoded, repeated.revision, t);
    expect((await db.select().from(uptimeMonitor))[0]).toMatchObject({ active: false, requestCipher: null });
  });
  it("permits protected UI portability and returns localized safe input errors", async () => {
    const owner = await createTestUser(); const caller = authedCaller({ ...owner, language: "es" });
    const encoded = text([input]); const preview = await caller.uptimeMonitor.portability.preview({ text: encoded });
    await caller.uptimeMonitor.portability.reconcile({ text: encoded, revision: preview.revision });
    expect((await caller.uptimeMonitor.monitor.list()).length).toBe(1);
    await expect(caller.uptimeMonitor.portability.preview({ text: "" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: getTranslator("es")("errors.manifestInvalid") });
    await expect(publicCaller().uptimeMonitor.portability.preview({ text: encoded })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("redacts private numeric assertion expectations from old values in a preview diff", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const monitor = await caller.uptimeMonitor.monitor.create({ name: "Private API", url: input.url, method: "POST", active: false,
      requestConfig: { body: '{"pin":1234}' }, httpAssertions: [{ type: "json", path: "$.pin", op: "equals", value: 1234 }] });
    const encoded = text([{ ...input, method: "POST", key: `pulsy:${monitor.uptimeMonitorId}` }]);
    const preview = await previewMonitorConfiguration(owner.id, encoded, t);
    expect(JSON.stringify(preview)).not.toContain("1234");
    expect(preview.entries[0]!.changes.find(change => change.field === "httpAssertions")!.before).toEqual([{ type: "json", path: "$.pin", op: "equals", value: "[redacted]" }]);
  });
  it("previews with zero writes and applies repeated keys without duplicate monitors", async () => {
    const owner = await createTestUser(); const encoded = text([input]);
    const preview = await previewMonitorConfiguration(owner.id, encoded, t);
    expect(preview.counts).toMatchObject({ create: 1, update: 0, unchanged: 0, rejected: 0 });
    expect(await db.select().from(uptimeMonitor)).toHaveLength(0);
    await applyMonitorConfiguration(owner.id, encoded, preview.revision, t);
    const repeated = await previewMonitorConfiguration(owner.id, encoded, t);
    expect(repeated.counts).toMatchObject({ create: 0, update: 0, unchanged: 1 });
    await applyMonitorConfiguration(owner.id, encoded, repeated.revision, t);
    expect(await db.select().from(uptimeMonitor)).toHaveLength(1);
  });
  it("retains IDs, encrypted request values, measured facts, check history and publication on update", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const created = await caller.uptimeMonitor.monitor.create({ name: "Original", url: input.url, active: false, requestConfig: { headers: [{ name: "Authorization", value: "private-secret" }] } });
    await db.update(uptimeMonitor).set({ status: "down", isPublic: true }).where(eq(uptimeMonitor.userId, owner.id));
    await db.insert(uptimeCheckLog).values({ uptimeMonitorId: created.uptimeMonitorId, status: "down" });
    const [page] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "preserved", title: "Existing publication", isPublished: true }).returning();
    const [membership] = await db.insert(uptimeStatusPageMonitor).values({ statusPageId: page!.statusPageId, uptimeMonitorId: created.uptimeMonitorId }).returning();
    const [before] = await db.select().from(uptimeMonitor);
    const exported = await exportMonitorConfiguration(owner.id, [created.uptimeMonitorId], t);
    expect(JSON.stringify(exported)).not.toMatch(/private-secret|requestCipher|status.*down|isPublic|createdAt/);
    exported.manifest.monitors[0]!.name = "Changed";
    const encoded = JSON.stringify(exported.manifest); const preview = await previewMonitorConfiguration(owner.id, encoded, t);
    expect(preview.entries[0]!.changes.some(change => change.field === "name")).toBe(true);
    await applyMonitorConfiguration(owner.id, encoded, preview.revision, t);
    const [after] = await db.select().from(uptimeMonitor);
    expect(after).toMatchObject({ uptimeMonitorId: created.uptimeMonitorId, name: "Changed", status: "down", isPublic: true, requestCipher: before!.requestCipher });
    expect(await db.select().from(uptimeCheckLog)).toHaveLength(1);
    expect((await db.select().from(uptimeStatusPageMonitor))[0]).toEqual(membership);
    expect((await db.select().from(uptimeStatusPage))[0]).toEqual(page);
  });
  it("rejects stale previews, foreign selected IDs and foreign channel references with no partial writes", async () => {
    const owner = await createTestUser(); const other = await createTestUser();
    const source = await authedCaller(other).uptimeMonitor.monitor.create({ name: "Other", url: input.url, active: false });
    await expect(exportMonitorConfiguration(owner.id, [source.uptimeMonitorId], t)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const encoded = text([input]); const preview = await previewMonitorConfiguration(owner.id, encoded, t);
    await authedCaller(owner).uptimeMonitor.monitor.create({ name: "Concurrent", url: input.url, active: false });
    await expect(applyMonitorConfiguration(owner.id, encoded, preview.revision, t)).rejects.toMatchObject({ code: "CONFLICT" });
    const invalid = text([input, { ...input, key: "foreign-reference", channelIds: ["foreign-channel"] }]);
    const rejected = await previewMonitorConfiguration(owner.id, invalid, t);
    expect(rejected.counts.rejected).toBe(1);
    await expect(applyMonitorConfiguration(owner.id, invalid, rejected.revision, t)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, owner.id))).toHaveLength(1);
  });
  it("imports a new heartbeat inactive with no retrievable token and retains hash on reconciliation", async () => {
    const owner = await createTestUser(); const encoded = text([{ key: "backup", type: "heartbeat", name: "Backup", interval: 3600, graceSeconds: 120, active: true, tags: [] }]);
    const preview = await previewMonitorConfiguration(owner.id, encoded, t);
    await applyMonitorConfiguration(owner.id, encoded, preview.revision, t);
    const [monitor] = await db.select().from(uptimeMonitor); const [heartbeat] = await db.select().from(uptimeHeartbeat);
    expect(monitor).toMatchObject({ monitorType: "heartbeat", active: false, status: "pending" });
    expect(heartbeat!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const repeated = await previewMonitorConfiguration(owner.id, encoded, t);
    await applyMonitorConfiguration(owner.id, encoded, repeated.revision, t);
    expect((await db.select().from(uptimeHeartbeat))[0]!.tokenHash).toBe(heartbeat!.tokenHash);
  });
  it("serializes reviewed imports without monitor count or cadence restrictions", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    await caller.uptimeMonitor.monitor.createBulk({ monitors: Array.from({ length: 9 }, (_, i) => ({ name: `Existing ${i}`, url: `${input.url}/existing/${i}`, active: false })) });
    const texts = [text([input]), text([{ ...input, key: "competing" }])];
    const previews = await Promise.all(texts.map(encoded => previewMonitorConfiguration(owner.id, encoded, t)));
    const results = await Promise.allSettled(texts.map((encoded, i) => applyMonitorConfiguration(owner.id, encoded, previews[i]!.revision, t)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, owner.id))).toHaveLength(10);
    // Concurrent account changes invalidate the old review; a fresh review may
    // apply the remaining key without any account count ceiling.
    for (const encoded of texts) {
      const latest = await previewMonitorConfiguration(owner.id, encoded, t);
      await applyMonitorConfiguration(owner.id, encoded, latest.revision, t);
    }
    expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, owner.id))).toHaveLength(11);
    const fast = await previewMonitorConfiguration(owner.id, text([{ ...input, interval: 30 }]), t);
    expect(fast.counts.rejected).toBe(0);
  });
  it("renames an owned configuration key explicitly without changing ID and remains idempotent", async () => {
    const owner = await createTestUser(); const other = await createTestUser();
    const monitor = await authedCaller(owner).uptimeMonitor.monitor.create({ name: "Existing", url: input.url, active: false });
    const encoded = text([{ ...input, previousKey: `pulsy:${monitor.uptimeMonitorId}`, key: "friendly-prod" }]);
    const preview = await previewMonitorConfiguration(owner.id, encoded, t);
    expect(preview.counts).toMatchObject({ create: 0, update: 1 });
    await applyMonitorConfiguration(owner.id, encoded, preview.revision, t);
    expect((await db.select().from(uptimeMonitor))[0]).toMatchObject({ uptimeMonitorId: monitor.uptimeMonitorId, externalKey: "friendly-prod" });
    const repeated = await previewMonitorConfiguration(owner.id, encoded, t);
    expect(repeated.counts).toMatchObject({ unchanged: 1, update: 0 });
    await applyMonitorConfiguration(owner.id, encoded, repeated.revision, t);
    const foreign = await previewMonitorConfiguration(other.id, encoded, t);
    expect(foreign.counts.rejected).toBe(1);
  });
  it("rolls back earlier inserts if storage fails during an atomic apply", async () => {
    const owner = await createTestUser(); const encoded = text([input, { ...input, key: "second" }]);
    const preview = await previewMonitorConfiguration(owner.id, encoded, t);
    const original = db.transaction.bind(db); let inserted = 0;
    vi.spyOn(db, "transaction").mockImplementationOnce(callback => original(async tx => {
      const insert = tx.insert.bind(tx);
      vi.spyOn(tx, "insert").mockImplementation(table => {
        if (++inserted === 2) throw new Error("Disposable injected storage failure");
        return insert(table);
      });
      return callback(tx);
    }));
    await expect(applyMonitorConfiguration(owner.id, encoded, preview.revision, t)).rejects.toThrow("Disposable injected storage failure");
    expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, owner.id))).toHaveLength(0);
  });
  it("retains a private POST body and rejects incompatible method changes before any write", async () => {
    const owner = await createTestUser();
    const monitor = await authedCaller(owner).uptimeMonitor.monitor.create({ name: "POST", url: input.url, method: "POST", active: false, requestConfig: { headers: [], body: "private-body" } });
    const exported = await exportMonitorConfiguration(owner.id, [monitor.uptimeMonitorId], t);
    const row = exported.manifest.monitors[0]!; if (row.type !== "http") throw new Error("Expected HTTP fixture"); row.method = "GET";
    const encoded = JSON.stringify(exported.manifest); const preview = await previewMonitorConfiguration(owner.id, encoded, t);
    expect(preview.entries[0]!.reasons).toContain("retainedBody");
    await expect(applyMonitorConfiguration(owner.id, encoded, preview.revision, t)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await db.select().from(uptimeMonitor))[0]).toMatchObject({ method: "POST", uptimeMonitorId: monitor.uptimeMonitorId });
  });
  it("allows existing configuration updates and additional creation equally", async () => {
    const owner = await createTestUser();
    const rows = await db.insert(uptimeMonitor).values(Array.from({ length: 11 }, (_, i) => ({ userId: owner.id, name: `Retained ${i}`, url: input.url, interval: 300, active: false }))).returning();
    const encoded = text([{ ...input, key: `pulsy:${rows[0]!.uptimeMonitorId}`, name: "Changed configuration" }]);
    const preview = await previewMonitorConfiguration(owner.id, encoded, t);
    expect(preview.counts).toMatchObject({ update: 1, rejected: 0 });
    await applyMonitorConfiguration(owner.id, encoded, preview.revision, t);
    expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, owner.id))).toHaveLength(11);
    expect((await previewMonitorConfiguration(owner.id, text([input]), t)).counts).toMatchObject({ create: 1, rejected: 0 });
  });
});

describe("reviewed changes stay additive and exports stay secret-free", () => {
  it("never deletes owned monitors that are absent from the reviewed manifest", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const bystander = await caller.uptimeMonitor.monitor.create({ name: "Not in file", url: "https://bystander.invalid/", active: false });
    const encoded = text([input]);
    const preview = await previewMonitorConfiguration(owner.id, encoded, t);
    expect(preview.entries.map(entry => entry.action)).toEqual(["create"]);
    await applyMonitorConfiguration(owner.id, encoded, preview.revision, t);
    const ids = (await db.select({ id: uptimeMonitor.uptimeMonitorId }).from(uptimeMonitor)).map(row => row.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(bystander.uptimeMonitorId);
  });
  it("omits a credential- or token-bearing destination from the exported bytes", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const created = await caller.uptimeMonitor.monitor.create({ name: "Has secrets", url: "https://svc.invalid/health", active: false });
    await db.update(uptimeMonitor).set({ url: "https://operator:hunter2@svc.invalid/health?api_key=abc123" }).where(eq(uptimeMonitor.uptimeMonitorId, created.uptimeMonitorId));
    const exported = await exportMonitorConfiguration(owner.id, [created.uptimeMonitorId], t);
    const bytes = JSON.stringify(exported);
    expect(bytes).not.toMatch(/hunter2|operator|api_key|abc123/);
    expect(exported.manifest.monitors[0]).toMatchObject({ url: null, needsReentry: expect.arrayContaining(["url"]) });
  });
});

describe("malformed manifests give a translated, non-echoing error", () => {
  it.each(["en", "ar", "fr", "de", "es"] as const)("%s: invalid JSON and a rejected field never leak a message key or the pasted private value", async (lang) => {
    const owner = await createTestUser(); const tr = getTranslator(lang);
    const badJson = `{ "format": "pulsy-monitor-configuration",\n "monitors": [ { "key": "a", "token": "private-secret-value" ,, ] }`;
    const wrongVersion = JSON.stringify({ format: "pulsy-monitor-configuration", version: 2, monitors: [{ key: "a", token: "private-secret-value" }] });
    for (const bad of [badJson, wrongVersion, "[]", "null", `{"format":"pulsy-monitor-configuration","version":1,"monitors":[]}`]) {
      const failure = await previewMonitorConfiguration(owner.id, bad, tr).then(() => null, error => error as { code: string; message: string });
      expect(failure, bad.slice(0, 40)).not.toBeNull();
      expect(failure!.code).toBe("BAD_REQUEST");
      expect(failure!.message.startsWith("errors.")).toBe(false);
      expect(failure!.message).not.toContain("manifestInvalid");
      expect(failure!.message).not.toContain("private-secret-value");
      expect(failure!.message.length).toBeGreaterThan(10);
    }
  });
});



describe("configuration import write invariants", () => {
  beforeEach(() => setSchedulingEnabled(false));
  afterEach(() => setSchedulingEnabled(true));
  it("rejects moving retained request credentials to a different origin without partial writes", async () => {
    const owner = await createTestUser();
    const created = await authedCaller(owner).uptimeMonitor.monitor.create({ name: "Trusted", url: input.url, active: false,
      requestConfig: { headers: [{ name: "Authorization", value: "private-retained-credential" }] } });
    const [before] = await db.select().from(uptimeMonitor);
    const encoded = text([{ ...input, key: `pulsy:${created.uptimeMonitorId}`, url: "https://attacker.invalid/health", active: true }, { ...input, key: "bystander" }]);
    const preview = await previewMonitorConfiguration(owner.id, encoded, t);
    expect(preview.entries[0]).toMatchObject({ action: "rejected", reasons: expect.arrayContaining(["credentialOrigin"]) });
    expect(JSON.stringify(preview)).not.toContain("private-retained-credential");
    await expect(applyMonitorConfiguration(owner.id, encoded, preview.revision, t)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.select().from(uptimeMonitor)).toEqual([before]);
    const sameOrigin = text([{ ...input, key: `pulsy:${created.uptimeMonitorId}`, url: "https://example.invalid/another-path" }]);
    const allowed = await previewMonitorConfiguration(owner.id, sameOrigin, t);
    expect(allowed.counts.rejected).toBe(0);
    await applyMonitorConfiguration(owner.id, sameOrigin, allowed.revision, t);
    expect((await db.select().from(uptimeMonitor))[0]).toMatchObject({ url: "https://example.invalid/another-path", requestCipher: before!.requestCipher });
  });
  it("sets an immediate deadline on resume and retarget, and clears it on pause", async () => {
    const owner = await createTestUser();
    const created = await authedCaller(owner).uptimeMonitor.monitor.create({ name: "Paused", url: input.url, interval: 3600, active: false });
    const apply = async (patch: Record<string, unknown>) => {
      const encoded = text([{ ...input, interval: 3600, key: `pulsy:${created.uptimeMonitorId}`, ...patch }]);
      const preview = await previewMonitorConfiguration(owner.id, encoded, t);
      await applyMonitorConfiguration(owner.id, encoded, preview.revision, t);
      return (await db.select().from(uptimeMonitor))[0]!;
    };
    const beforeResume = Date.now();
    const resumed = await apply({ active: true });
    expect(resumed.nextCheckAt).not.toBeNull();
    expect(Date.parse(resumed.nextCheckAt!)).toBeGreaterThanOrEqual(beforeResume);
    expect(Date.parse(resumed.nextCheckAt!)).toBeLessThan(Date.now() + 5000);
    await db.update(uptimeMonitor).set({ nextCheckAt: new Date(Date.now() + 3600000).toISOString() }).where(eq(uptimeMonitor.userId, owner.id));
    const retargeted = await apply({ active: true, url: "https://example.invalid/new-path" });
    expect(Date.parse(retargeted.nextCheckAt!)).toBeLessThan(Date.now() + 5000);
    expect((await apply({ active: false, url: retargeted.url })).nextCheckAt).toBeNull();
  });
});
