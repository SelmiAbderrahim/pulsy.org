import { beforeEach, describe, expect, it } from "vitest";
import { db, uptimeNotificationLog } from "@pulsy/db";
import { createTestDefaultChannel, createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";

useCleanDatabase();
let owner: Awaited<ReturnType<typeof createTestUser>>;
let other: Awaited<ReturnType<typeof createTestUser>>;
beforeEach(async () => { owner = await createTestUser(); other = await createTestUser(); });

async function log(userId: string, monitorId: string, channelId: string, outcome: "sent" | "failed", minute: number) {
  await db.insert(uptimeNotificationLog).values({ userId, uptimeMonitorId: monitorId, channelId, channelType: "webhook", target: "fixture.invalid", event: "down", outcome, attempts: 1, error: outcome === "failed" ? "destination unavailable" : null, createdAt: `2026-01-01T00:0${minute}:00.000Z` });
}

describe("channel delivery health", () => {
  it("counts consecutive failures after the last success for owned channels", async () => {
    const monitor = await createTestMonitor(owner.id), channel = await createTestDefaultChannel(owner.id);
    await log(owner.id, monitor.uptimeMonitorId, channel.channelId, "sent", 0);
    for (let minute = 1; minute <= 3; minute++) await log(owner.id, monitor.uptimeMonitorId, channel.channelId, "failed", minute);
    expect(await authedCaller(owner).uptimeMonitor.channel.health()).toEqual([expect.objectContaining({ channelId: channel.channelId, consecutiveFailures: 3, lastError: "destination unavailable", lastSuccessAt: "2026-01-01T00:00:00.000Z", lastAttemptAt: "2026-01-01T00:03:00.000Z" })]);
    await log(owner.id, monitor.uptimeMonitorId, channel.channelId, "sent", 4);
    expect(await authedCaller(owner).uptimeMonitor.channel.health()).toEqual([expect.objectContaining({ consecutiveFailures: 0, lastError: null, lastSuccessAt: "2026-01-01T00:04:00.000Z" })]);
  });

  it("requires a session and excludes foreign channels and mismatched-owner logs", async () => {
    const monitor = await createTestMonitor(owner.id), channel = await createTestDefaultChannel(owner.id);
    const foreign = await createTestDefaultChannel(other.id);
    await log(other.id, monitor.uptimeMonitorId, channel.channelId, "failed", 1);
    await log(other.id, monitor.uptimeMonitorId, foreign.channelId, "failed", 2);
    await expect(publicCaller().uptimeMonitor.channel.health()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const health = await authedCaller(owner).uptimeMonitor.channel.health();
    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({ channelId: channel.channelId, consecutiveFailures: 0, lastError: null, lastSuccessAt: null });
    expect(JSON.stringify(health)).not.toContain(foreign.channelId);
  });
});
