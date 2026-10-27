import { describe, expect, it } from "vitest";
import { db, uptimeMonitor, uptimeMonitorChannelBinding } from "@pulsy/db";
import { createTestChannel, createTestDefaultChannel, createTestMonitor, createTestStatusPage, createTestStatusPageMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
useCleanDatabase();

describe("owner monitor-list metadata", () => {
  it("counts unique override channels and named-page memberships without counting foreign metadata", async () => {
    const owner = await createTestUser(), foreign = await createTestUser();
    const monitor = await createTestMonitor(owner.id, { isPublic: false });
    const another = await createTestMonitor(foreign.id);
    const direct = await createTestChannel(monitor.uptimeMonitorId);
    const bound = await createTestDefaultChannel(owner.id);
    const foreignChannel = await createTestDefaultChannel(foreign.id);
    await db.insert(uptimeMonitorChannelBinding).values([
      { userId: owner.id, monitorId: monitor.uptimeMonitorId, channelId: direct.channelId },
      { userId: owner.id, monitorId: monitor.uptimeMonitorId, channelId: bound.channelId },
      { userId: foreign.id, monitorId: another.uptimeMonitorId, channelId: foreignChannel.channelId },
    ]);
    const page = await createTestStatusPage(owner.id);
    await createTestStatusPageMonitor(page.statusPageId, monitor.uptimeMonitorId);
    const foreignPage = await createTestStatusPage(foreign.id);
    await createTestStatusPageMonitor(foreignPage.statusPageId, another.uptimeMonitorId);
    const rows = await authedCaller(owner).uptimeMonitor.monitor.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ uptimeMonitorId: monitor.uptimeMonitorId, isPublic: false, overrideChannelCount: 2, statusPageCount: 1 });
    expect(JSON.stringify(rows)).not.toContain(foreignChannel.channelId);
    expect(JSON.stringify(rows)).not.toContain(foreignPage.statusPageId);
  });

  it("pages beyond exactly 200 monitors without repeats or foreign rows", async () => {
    const owner = await createTestUser(), foreign = await createTestUser();
    await db.insert(uptimeMonitor).values(Array.from({ length: 201 }, (_, index) => ({ userId: owner.id, uptimeMonitorId: `owned-${String(index).padStart(3, "0")}`, name: `Monitor ${index}`, url: `https://example.test/${index}`, method: "GET" as const, expectedStatus: 200, timeout: 10000, interval: 300, failureThreshold: 3, active: false })));
    await createTestMonitor(foreign.id, { uptimeMonitorId: "owned-050-foreign" });
    const caller = authedCaller(owner).uptimeMonitor.monitor;
    const first = await caller.list();
    expect(first).toHaveLength(200);
    const second = await caller.list({ cursor: first.at(-1)!.uptimeMonitorId });
    expect(second).toHaveLength(1);
    expect(new Set([...first, ...second].map(row => row.uptimeMonitorId)).size).toBe(201);
    expect(await caller.list({ cursor: second[0]!.uptimeMonitorId })).toEqual([]);
  });
});
