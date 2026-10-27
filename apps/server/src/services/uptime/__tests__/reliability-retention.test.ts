import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeReliabilityDay, uptimeReliabilityAnnotation, uptimeReliabilityPolicy } from "@pulsy/db";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { emptyReliabilityBucket } from "../reliability-storage";
import { getTranslator } from "../../../lib/i18n";
import { annotateReliability, readReliability } from "../reliability-service";
const cleanup = await import("../cleanup-service");
useCleanDatabase(); const DAY = 86400000, now = Date.parse("2026-10-10T12:00:00.000Z"), t = getTranslator("en");
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function seed(userId: string) {
  const monitor = await createTestMonitor(userId, { active: false });
  for (const ago of [10, 100, 500, 800]) {
    const at = new Date(now - ago * DAY).toISOString();
    await db.insert(uptimeReliabilityDay).values({ userId, monitorId: monitor.uptimeMonitorId, day: at.slice(0, 10), bucket: emptyReliabilityBucket() });
    await db.insert(uptimeReliabilityAnnotation).values({ userId, monitorId: monitor.uptimeMonitorId, actorId: userId, at, text: "Private marker" });
  }
  return monitor;
}
describe("reliability retention", () => {
  it.each([30, 120])("prunes every owner equally at the configured %s-day retention", async days => {
     vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    const owners = [await createTestUser(), await createTestUser(), await createTestUser()];
    vi.stubEnv("CHECK_LOG_RETENTION_DAYS", String(days));
    for (const owner of owners) await seed(owner.id);
    expect(cleanup.cleanupReliabilityHistory).toBeTypeOf("function");
    await cleanup.cleanupReliabilityHistory(days);
    const retained = await db.select().from(uptimeReliabilityDay), annotations = await db.select().from(uptimeReliabilityAnnotation);
    expect(owners.map(owner => retained.filter(row => row.userId === owner.id).length)).toEqual(Array(3).fill(days === 30 ? 1 : 2));
    expect(owners.map(owner => annotations.filter(row => row.userId === owner.id).length)).toEqual(Array(3).fill(days === 30 ? 1 : 2));
  });
  it("retains the policy spanning the cutoff, newer and current unobserved versions", async () => {
     vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    const owner = await createTestUser(), monitor = await createTestMonitor(owner.id, { active: false });
    for (const [version, ago] of [[1, 800], [2, 100], [3, 10], [4, null]] as const) await db.insert(uptimeReliabilityPolicy).values({ userId: owner.id, monitorId: monitor.uptimeMonitorId, version, firstObservedAt: ago === null ? null : new Date(now - ago * DAY).toISOString() });
    await cleanup.cleanupReliabilityHistory(30); expect((await db.select().from(uptimeReliabilityPolicy)).map(row => row.version).sort()).toEqual([2, 3, 4]);
  });
  it("honors configured self-hosted cleanup and rejects invisible out-of-retention annotations", async () => {
     vi.stubEnv("CHECK_LOG_RETENTION_DAYS", "30"); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    const owner = await createTestUser(), monitor = await seed(owner.id);
    await expect(annotateReliability(owner.id, monitor.uptimeMonitorId, { at: new Date(now - 31 * DAY).toISOString(), environment: "", version: "", text: "Too old", link: null }, t)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(readReliability(owner.id, monitor.uptimeMonitorId, { from: new Date(now - 31 * DAY).toISOString(), to: new Date(now).toISOString() }, t)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(cleanup.cleanupReliabilityHistory).toBeTypeOf("function"); await cleanup.cleanupReliabilityHistory(30);
    expect(await db.select().from(uptimeReliabilityDay)).toHaveLength(1); expect(await db.select().from(uptimeReliabilityAnnotation)).toHaveLength(1);
  });
  it("caps annotations per monitor, per monitor only", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { active: false }); const other = await createTestMonitor(owner.id, { active: false });
    await db.insert(uptimeReliabilityAnnotation).values(Array.from({ length: 1000 }, (_, index) => ({ userId: owner.id, monitorId: monitor.uptimeMonitorId, actorId: owner.id, at: new Date(now - 60_000 - index).toISOString(), text: `note ${index}` })));
    const input = { at: new Date(now - 1000).toISOString(), environment: "", version: "", text: "one too many", link: null };
    await expect(annotateReliability(owner.id, monitor.uptimeMonitorId, input, t)).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("1,000") });
    await expect(annotateReliability(owner.id, other.uptimeMonitorId, input, t)).resolves.toMatchObject({ text: "one too many" });
  });
});

it("keeps the technical annotation ceiling atomic under concurrent writes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { active: false });
  await db.insert(uptimeReliabilityAnnotation).values(Array.from({ length: 999 }, (_, index) => ({ userId: owner.id, monitorId: monitor.uptimeMonitorId, actorId: owner.id, at: new Date(now - 60_000 - index).toISOString(), text: `note ${index}` })));
  const input = { at: new Date(now - 1000).toISOString(), environment: "", version: "", text: "Concurrent note", link: null };
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => annotateReliability(owner.id, monitor.uptimeMonitorId, input, t)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(await db.select().from(uptimeReliabilityAnnotation)).toHaveLength(1000);
});
