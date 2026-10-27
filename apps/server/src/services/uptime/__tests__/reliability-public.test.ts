import { afterEach, expect, it, vi } from "vitest";
import { db, uptimeMonitor, uptimeStatusPageMonitor, uptimeStatusPage } from "@pulsy/db";
import { and, eq } from "drizzle-orm";
import { createTestUser, createTestMonitor, createTestStatusPage, createTestStatusPageMonitor, useCleanDatabase } from "../../../../test/db";
import { readPublicReliability } from "../reliability-public";
useCleanDatabase(); afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it("requires explicit published history and omits private facts and foreign components", async () => {
  const owner = await createTestUser(); const other = await createTestUser();
  const own = await createTestMonitor(owner.id, { name: "Private monitor label", url: "https://secret.example/private?token=private-marker" });
  const foreign = await createTestMonitor(other.id);
  const page = await createTestStatusPage(owner.id, { isPublished: true, historyEnabled: false });
  await createTestStatusPageMonitor(page.statusPageId, own.uptimeMonitorId);
  await createTestStatusPageMonitor(page.statusPageId, foreign.uptimeMonitorId);
  expect(await readPublicReliability(page.statusPageId)).toBeNull();
  await db.update(uptimeStatusPage).set({ historyEnabled: true }).where(and(eq(uptimeStatusPage.statusPageId, page.statusPageId), eq(uptimeStatusPage.userId, owner.id)));
  const result = await readPublicReliability(page.statusPageId);
  expect(result?.components).toHaveLength(1); expect(result?.components[0]?.days).toHaveLength(7);
  for (const value of [owner.id, other.id, own.uptimeMonitorId, foreign.uptimeMonitorId, "private-marker", "Private monitor label", "secret.example"]) expect(JSON.stringify(result)).not.toContain(value);
  await db.update(uptimeStatusPage).set({ isPublished: false }).where(eq(uptimeStatusPage.statusPageId, page.statusPageId));
  expect(await readPublicReliability(page.statusPageId)).toBeNull();
});
it("returns every public component through bounded reads without a page monitor count gate", async () => {
  const owner = await createTestUser(); const page = await createTestStatusPage(owner.id, { isPublished: true, historyEnabled: true });
  const monitors = await db.insert(uptimeMonitor).values(Array.from({ length: 101 }, (_, index) => ({ userId: owner.id, name: `Component ${index}`, url: `https://fixture.invalid/${index}`, active: true }))).returning();
  await db.insert(uptimeStatusPageMonitor).values(monitors.map((monitor, index) => ({ statusPageId: page.statusPageId, uptimeMonitorId: monitor.uptimeMonitorId, sortOrder: index })));
  const result = await readPublicReliability(page.statusPageId);
  expect(result?.components).toHaveLength(101); expect(result?.components.every(component => component.days.length === 7)).toBe(true);
});
