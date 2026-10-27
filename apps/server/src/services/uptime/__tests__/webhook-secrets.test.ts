import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, uptimeNotificationChannel } from "@pulsy/db";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { mockFetch } from "../../../../test/fetch-mock";
import { decrypt } from "../../../lib/crypto";
import { decryptNotificationChannelSecrets } from "../notification-channel-secrets";

vi.mock("../scheduler-service", () => ({ scheduleMonitorCheck: vi.fn(), cancelMonitorCheck: vi.fn(), rescheduleMonitorCheck: vi.fn() }));
useCleanDatabase();

describe("OSS webhook signing credentials", () => {
  it("never returns default-channel signing credentials and signs with the owner's supplied secret", async () => {
    const owner = await createTestUser(), caller = authedCaller(owner);
    const secret = "a1".repeat(32);
    const input = { channelType: "webhook" as const, signingSecret: secret, webhookUrl: "https://fixture.invalid/private-target", webhookHeaders: { Authorization: "Bearer private-header", "X-Pulsy-Signature": "spoof", "Content-Type": "application/xml" } };
    const created = await caller.uptimeMonitor.channel.createDefault(input);
    expect(created).not.toHaveProperty("signingSecret");
    expect(created).not.toHaveProperty("signingSecretCipher");
    expect(JSON.stringify(created)).not.toContain(secret);
    const scope = and(eq(uptimeNotificationChannel.userId, owner.id), eq(uptimeNotificationChannel.channelId, created.channelId));
    const read = async () => (await db.select().from(uptimeNotificationChannel).where(scope))[0]!;
    const stored = await read();
    expect(stored.secretVersion).toBe(1);
    expect(stored.signingSecretCipher).toBeTruthy();
    expect(decrypt(stored.signingSecretCipher!)).toBe(secret);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(decryptNotificationChannelSecrets(stored)).toMatchObject({ webhookUrl: input.webhookUrl, webhookHeaders: input.webhookHeaders });
    const listed = await caller.uptimeMonitor.channel.listDefaults();
    expect(JSON.stringify(listed)).not.toMatch(/private-target|private-header|signingSecretCipher|secretVersion/);
    expect(JSON.stringify(listed)).not.toContain(secret);
    const delivery = mockFetch();
    try {
      await caller.uptimeMonitor.channel.test({ channelId: created.channelId });
      expect(delivery.calls).toHaveLength(1);
      const sent = delivery.calls[0]!;
      expect(sent.url).toBe(input.webhookUrl);
      expect(sent.headers.Authorization).toBe(input.webhookHeaders.Authorization);
      expect(sent.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(String(sent.body))).toMatchObject({ version: 1, event: "test", test: true });
      expect(sent.headers["X-Pulsy-Signature"]).toBe(`sha256=${createHmac("sha256", secret).update(String(sent.body)).digest("hex")}`);
    } finally { delivery.restore(); }
    const changed = await caller.uptimeMonitor.channel.update({ channelId: created.channelId, notifyOnRecovery: false });
    expect(changed).not.toHaveProperty("signingSecret");
    expect(changed).not.toHaveProperty("signingSecretCipher");
    expect(decrypt((await read()).signingSecretCipher!)).toBe(secret);
    await caller.uptimeMonitor.channel.update({ channelId: created.channelId, channelType: "telegram", webhookUrl: "123456:ABCD:123456789", webhookHeaders: null });
    expect((await read()).signingSecretCipher).toBeNull();
  });

  it("stores owner-supplied monitor-channel secrets and keeps legacy omitted-secret creation masked", async () => {
    const owner = await createTestUser(), caller = authedCaller(owner);
    const monitor = await createTestMonitor(owner.id);
    const secret = "b2".repeat(32);
    const supplied = await caller.uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: "https://fixture.invalid/hooks", signingSecret: secret });
    expect(supplied).not.toHaveProperty("signingSecret");
    expect(supplied).not.toHaveProperty("signingSecretCipher");
    const stored = await db.query.uptimeNotificationChannel.findFirst({ where: and(eq(uptimeNotificationChannel.userId, owner.id), eq(uptimeNotificationChannel.channelId, supplied.channelId)) });
    expect(decrypt(stored!.signingSecretCipher!)).toBe(secret);
    for (const create of [
      () => caller.uptimeMonitor.channel.createDefault({ channelType: "webhook", webhookUrl: "https://fixture.invalid/hooks" }),
      () => caller.uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: "https://fixture.invalid/hooks" }),
    ]) {
      const created = await create();
      expect(created).not.toHaveProperty("signingSecret");
      expect(created).not.toHaveProperty("signingSecretCipher");
      const row = await db.query.uptimeNotificationChannel.findFirst({ where: and(eq(uptimeNotificationChannel.userId, owner.id), eq(uptimeNotificationChannel.channelId, created.channelId)) });
      const generated = decrypt(row!.signingSecretCipher!);
      expect(generated).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(created)).not.toContain(generated);
    }
    await expect(authedCaller(await createTestUser()).uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: "https://fixture.invalid/hooks", signingSecret: secret })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rotates only an owned webhook to the supplied secret without returning plaintext or ciphertext", async () => {
    const owner = await createTestUser(), caller = authedCaller(owner);
    const created = await caller.uptimeMonitor.channel.createDefault({ channelType: "webhook", webhookUrl: "https://fixture.invalid/hooks", signingSecret: "c3".repeat(32) });
    const read = async () => (await db.query.uptimeNotificationChannel.findFirst({ where: and(eq(uptimeNotificationChannel.userId, owner.id), eq(uptimeNotificationChannel.channelId, created.channelId)) }))!;
    const initialCipher = (await read()).signingSecretCipher;
    const next = "d4".repeat(32);
    await expect(authedCaller(await createTestUser()).uptimeMonitor.channel.rotateSecret({ channelId: created.channelId, signingSecret: next })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await read()).signingSecretCipher).toBe(initialCipher);
    const rotated = await caller.uptimeMonitor.channel.rotateSecret({ channelId: created.channelId, signingSecret: next });
    expect(rotated).toEqual({ rotated: true });
    expect(decrypt((await read()).signingSecretCipher!)).toBe(next);
    expect(JSON.stringify(await caller.uptimeMonitor.channel.listDefaults())).not.toContain(next);
    const delivery = mockFetch();
    try {
      await caller.uptimeMonitor.channel.test({ channelId: created.channelId });
      expect(delivery.calls).toHaveLength(1);
      const sent = delivery.calls[0]!;
      expect(sent.headers["X-Pulsy-Signature"]).toBe(`sha256=${createHmac("sha256", next).update(String(sent.body)).digest("hex")}`);
      expect(sent.headers["X-Pulsy-Signature"]).not.toBe(`sha256=${createHmac("sha256", "c3".repeat(32)).update(String(sent.body)).digest("hex")}`);
    } finally { delivery.restore(); }
  });

  it("rejects malformed signing credentials and requires a replacement on rotation", async () => {
    const owner = await createTestUser(), caller = authedCaller(owner);
    const monitor = await createTestMonitor(owner.id);
    const created = await caller.uptimeMonitor.channel.createDefault({ channelType: "webhook", webhookUrl: "https://fixture.invalid/hooks" });
    const initial = await db.query.uptimeNotificationChannel.findFirst({ where: eq(uptimeNotificationChannel.channelId, created.channelId) });
    for (const signingSecret of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), " "+"a".repeat(64)]) {
      await expect(caller.uptimeMonitor.channel.createDefault({ channelType: "webhook", webhookUrl: "https://fixture.invalid/hooks", signingSecret })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: "https://fixture.invalid/hooks", signingSecret })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.uptimeMonitor.channel.rotateSecret({ channelId: created.channelId, signingSecret })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    // Exercise unvalidated transport input without bypassing production validation.
    await expect(caller.uptimeMonitor.channel.rotateSecret({ channelId: created.channelId, signingSecret: undefined as unknown as string })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const after = await db.query.uptimeNotificationChannel.findFirst({ where: eq(uptimeNotificationChannel.channelId, created.channelId) });
    expect(after!.signingSecretCipher).toBe(initial!.signingSecretCipher);
  });

  it("rejects supplied signing secrets on other channel types and vendor credentials sent to arbitrary destinations", async () => {
    const owner = await createTestUser(), caller = authedCaller(owner);
    const monitor = await createTestMonitor(owner.id);
    for (const channelType of ["slack", "discord"] as const) {
      await expect(caller.uptimeMonitor.channel.createDefault({ channelType, webhookUrl: "https://attacker.invalid/private" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    for (const create of [
      () => caller.uptimeMonitor.channel.createDefault({ channelType: "telegram", webhookUrl: "123456:ABCD:123456789", signingSecret: "e5".repeat(32) }),
      () => caller.uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "telegram", webhookUrl: "123456:ABCD:123456789", signingSecret: "e5".repeat(32) }),
    ]) await expect(create()).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const telegram = await caller.uptimeMonitor.channel.createDefault({ channelType: "telegram", webhookUrl: "123456:ABCD:123456789" });
    await expect(caller.uptimeMonitor.channel.rotateSecret({ channelId: telegram.channelId, signingSecret: "e5".repeat(32) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
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
