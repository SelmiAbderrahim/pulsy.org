import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, uptimeNotificationChannel } from "@pulsy/db";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { mockFetch } from "../../../../test/fetch-mock";
import { decrypt } from "../../../lib/crypto";
import { decryptNotificationChannelSecrets } from "../notification-channel-secrets";

vi.mock("../scheduler-service", () => ({ scheduleMonitorCheck: vi.fn(), cancelMonitorCheck: vi.fn(), rescheduleMonitorCheck: vi.fn() }));
useCleanDatabase();

describe("OSS webhook signing credentials", () => {
  it("encrypts signing keys separately, exposes them only on create/rotate, and signs the exact delivered body", async () => {
    const owner = await createTestUser(), caller = authedCaller(owner);
    const input = { channelType: "webhook" as const, webhookUrl: "https://fixture.invalid/private-target", webhookHeaders: { Authorization: "Bearer private-header", "X-Pulsy-Signature": "spoof", "Content-Type": "application/xml" } };
    const created = await caller.uptimeMonitor.channel.createDefault(input);
    expect(created.signingSecret).toMatch(/^[a-f0-9]{64}$/);
    const scope = and(eq(uptimeNotificationChannel.userId, owner.id), eq(uptimeNotificationChannel.channelId, created.channelId));
    const read = async () => (await db.select().from(uptimeNotificationChannel).where(scope))[0]!;
    const stored = await read();
    expect(stored.secretVersion).toBe(1);
    expect(stored.signingSecretCipher).toBeTruthy();
    expect(decrypt(stored.signingSecretCipher!)).toBe(created.signingSecret);
    expect(JSON.stringify(stored)).not.toContain(created.signingSecret);
    expect(decryptNotificationChannelSecrets(stored)).toMatchObject({ webhookUrl: input.webhookUrl, webhookHeaders: input.webhookHeaders });
    const listed = await caller.uptimeMonitor.channel.listDefaults();
    expect(JSON.stringify(listed)).not.toMatch(/private-target|private-header|signingSecretCipher|secretVersion/);
    expect(JSON.stringify(listed)).not.toContain(created.signingSecret);
    const delivery = mockFetch();
    try {
      await caller.uptimeMonitor.channel.test({ channelId: created.channelId });
      expect(delivery.calls).toHaveLength(1);
      const sent = delivery.calls[0]!;
      expect(sent.url).toBe(input.webhookUrl);
      expect(sent.headers.Authorization).toBe(input.webhookHeaders.Authorization);
      expect(sent.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(String(sent.body))).toMatchObject({ version: 1, event: "test", test: true });
      expect(sent.headers["X-Pulsy-Signature"]).toBe(`sha256=${createHmac("sha256", created.signingSecret!).update(String(sent.body)).digest("hex")}`);
    } finally { delivery.restore(); }
    const changed = await caller.uptimeMonitor.channel.update({ channelId: created.channelId, notifyOnRecovery: false });
    expect(changed).not.toHaveProperty("signingSecret");
    expect(decrypt((await read()).signingSecretCipher!)).toBe(created.signingSecret);
    await expect(authedCaller(await createTestUser()).uptimeMonitor.channel.rotateSecret({ channelId: created.channelId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const rotated = await caller.uptimeMonitor.channel.rotateSecret({ channelId: created.channelId });
    expect(Object.keys(rotated)).toEqual(["signingSecret"]);
    expect(rotated.signingSecret).not.toBe(created.signingSecret);
    expect(decrypt((await read()).signingSecretCipher!)).toBe(rotated.signingSecret);
    expect(JSON.stringify(await caller.uptimeMonitor.channel.listDefaults())).not.toContain(rotated.signingSecret);
    await caller.uptimeMonitor.channel.update({ channelId: created.channelId, channelType: "telegram", webhookUrl: "123456:ABCD:123456789", webhookHeaders: null });
    expect((await read()).signingSecretCipher).toBeNull();
  });

  it("rejects rotation for other channel types and rejects vendor credentials sent to arbitrary destinations", async () => {
    const caller = authedCaller(await createTestUser());
    for (const channelType of ["slack", "discord"] as const) {
      await expect(caller.uptimeMonitor.channel.createDefault({ channelType, webhookUrl: "https://attacker.invalid/private" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    const telegram = await caller.uptimeMonitor.channel.createDefault({ channelType: "telegram", webhookUrl: "123456:ABCD:123456789" });
    await expect(caller.uptimeMonitor.channel.rotateSecret({ channelId: telegram.channelId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("enforces the same technical channel ceiling under concurrent creation without affecting another owner", async () => {
    const owner = await createTestUser(), caller = authedCaller(owner);
    await db.insert(uptimeNotificationChannel).values(Array.from({ length: 1999 }, () => ({ userId: owner.id, channelType: "webhook" as const })));
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => caller.uptimeMonitor.channel.createDefault({ channelType: "webhook", webhookUrl: "https://fixture.invalid/hooks" })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(2);
    expect(await db.select({ id: uptimeNotificationChannel.channelId }).from(uptimeNotificationChannel).where(eq(uptimeNotificationChannel.userId, owner.id))).toHaveLength(2000);
    const other = authedCaller(await createTestUser());
    await expect(other.uptimeMonitor.channel.createDefault({ channelType: "webhook", webhookUrl: "https://fixture.invalid/hooks" })).resolves.toHaveProperty("channelId");
  });
});
