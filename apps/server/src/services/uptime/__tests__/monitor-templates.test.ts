import { encryptNotificationChannelSecrets } from "../notification-channel-secrets";
import { db, uptimeMonitor, uptimeNotificationChannel, uptimeMonitorTemplate, uptimeMonitorChannelBinding } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestUser, storedMonitorSnapshot, useCleanDatabase } from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
useCleanDatabase();
afterEach(() => vi.unstubAllEnvs());
const config = { method: "POST" as const, expectedStatus: 200, timeout: 10000, interval: 300, failureThreshold: 3, tags: ["prod"], redirectPolicy: "manual" as const, httpAssertions: [{ type: "json" as const, path: "$.status", op: "equals" as const, value: "ok" }] };
describe("owned non-secret creation templates", () => {
  it("omits assertion values repeated from private request credentials, including numeric bodies", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const source = await caller.uptimeMonitor.monitor.create({ ...config, name: "Private API", url: "https://fixture.invalid", active: false,
      requestConfig: { body: '{"pin":1234}' }, httpAssertions: [{ type: "json", path: "$.pin", op: "equals", value: 1234 }] });
    const draft = await caller.uptimeMonitor.template.fromMonitor({ monitorId: source.uptimeMonitorId });
    expect(JSON.stringify(draft)).not.toContain("1234");
    expect(draft).toMatchObject({ needsRequestValues: true, configuration: { httpAssertions: [] } });
  });
  it("returns a redacted duplication draft and never copies facts or publication", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const source = await caller.uptimeMonitor.monitor.create({ ...config, name: "Health", url: "https://fixture.invalid/token?secret=private", active: false, requestConfig: { headers: [{ name: "Authorization", value: "private" }] } });
    await db.update(uptimeMonitor).set({ isPublic: true, status: "down", consecutiveFailures: 8 }).where(eq(uptimeMonitor.userId, owner.id));
    const draft = await caller.uptimeMonitor.template.fromMonitor({ monitorId: source.uptimeMonitorId });
    expect(draft).toMatchObject({ name: "Health", needsRequestValues: true, configuration: config });
    expect(JSON.stringify(draft)).not.toMatch(/private|fixture.invalid|requestCipher|isPublic|consecutiveFailures/);
    const created = await caller.uptimeMonitor.monitor.create({ ...draft.configuration, name: "Health copy", url: "https://new.invalid", active: false });
    expect(created).toMatchObject({ status: "pending", isPublic: false, requestConfigured: false });
    expect(await storedMonitorSnapshot(created.uptimeMonitorId, owner.id)).toMatchObject({
      status: "pending", isPublic: false, consecutiveFailures: 0, requestCipher: null,
    });
    expect(created.uptimeMonitorId).not.toBe(source.uptimeMonitorId);
    await expect(authedCaller(await createTestUser()).uptimeMonitor.template.fromMonitor({ monitorId: source.uptimeMonitorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("retains reusable configuration, edits future creations only and isolates CRUD", async () => {
    const owner = await createTestUser(); const other = await createTestUser(); const caller = authedCaller(owner);
    const template = await caller.uptimeMonitor.template.save({ name: "API", configuration: config });
    const first = await caller.uptimeMonitor.monitor.create({ ...template.configuration, name: "First", url: "https://one.invalid", active: false });
    await caller.uptimeMonitor.template.save({ id: template.id, name: "Changed", configuration: { ...config, method: "GET", timeout: 20000 } });
    expect(await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: first.uptimeMonitorId })).toMatchObject({ method: "POST", timeout: 10000 });
    expect(await authedCaller(other).uptimeMonitor.template.list()).toEqual([]);
    await expect(authedCaller(other).uptimeMonitor.template.save({ id: template.id, name: "Foreign", configuration: config })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authedCaller(other).uptimeMonitor.template.remove({ id: template.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(publicCaller().uptimeMonitor.template.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await caller.uptimeMonitor.template.remove({ id: template.id }); expect(await caller.uptimeMonitor.template.list()).toEqual([]);
  });
  it("rejects secrets, unknown fields and foreign or deleted channel references without creating a monitor", async () => {
    const owner = await createTestUser(); const other = await createTestUser(); const caller = authedCaller(owner);
    const [channel] = await db.insert(uptimeNotificationChannel).values({ userId: owner.id, channelType: "webhook", webhookUrl: "https://sink.invalid/private" }).returning();
    const [foreign] = await db.insert(uptimeNotificationChannel).values({ userId: other.id, channelType: "webhook", webhookUrl: "https://sink.invalid/foreign" }).returning();
    await expect(caller.uptimeMonitor.template.save({ name: "Foreign", configuration: { ...config, channelIds: [foreign!.channelId] } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const unsafe: unknown = { name: "Unsafe", configuration: { ...config, requestConfig: { auth: { type: "bearer", token: "private" } } } };
    await expect(caller.uptimeMonitor.template.save(unsafe as Parameters<typeof caller.uptimeMonitor.template.save>[0])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const template = await caller.uptimeMonitor.template.save({ name: "References", configuration: { ...config, channelIds: [channel!.channelId] } });
    expect(JSON.stringify(template)).not.toContain("sink.invalid");
    await db.delete(uptimeNotificationChannel).where(eq(uptimeNotificationChannel.userId, owner.id));
    await expect(caller.uptimeMonitor.monitor.create({ ...template.configuration, name: "No insertion", url: "https://fixture.invalid", active: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await caller.uptimeMonitor.monitor.list()).toEqual([]);
  });
  it("serializes concurrent template creation at the safety ceiling", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    await db.insert(uptimeMonitorTemplate).values(Array.from({ length: 199 }, (_, i) => ({ userId: owner.id, name: `Template ${i}`, configuration: config })));
    const results = await Promise.allSettled([caller.uptimeMonitor.template.save({ name: "Final", configuration: config }), caller.uptimeMonitor.template.save({ name: "Overflow", configuration: config })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await caller.uptimeMonitor.template.list()).toHaveLength(200);
  });
  it("allows technical-floor cadence and concurrent template-derived creation without count restrictions", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const fast = await caller.uptimeMonitor.template.save({ name: "Fast template", configuration: { ...config, interval: 30 } });
    expect(await caller.uptimeMonitor.monitor.create({ ...fast.configuration, name: "Fast", url: "https://fixture.invalid", active: false })).toMatchObject({ interval: 30 });
    await caller.uptimeMonitor.monitor.createBulk({ monitors: Array.from({ length: 9 }, (_, i) => ({ ...config, name: `Existing ${i}`, url: `https://fixture.invalid/existing/${i}`, active: false })) });
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => caller.uptimeMonitor.monitor.create({ ...config, name: "From template", url: `https://fixture.invalid/new/${i}`, active: false })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(5);
    expect(await caller.uptimeMonitor.monitor.list()).toHaveLength(15);
  });
  it("creates unique owned channel bindings atomically and deletes them with the monitor", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const [channel] = await db.insert(uptimeNotificationChannel).values({ userId: owner.id, channelType: "webhook", webhookUrl: "https://sink.invalid/private" }).returning();
    const created = await caller.uptimeMonitor.monitor.create({ ...config, name: "Bound", url: "https://fixture.invalid", active: false, channelIds: [channel!.channelId, channel!.channelId] });
    expect(await db.select().from(uptimeMonitorChannelBinding).where(eq(uptimeMonitorChannelBinding.userId, owner.id))).toHaveLength(1);
    const detail = await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: created.uptimeMonitorId });
    expect(detail.referencedChannels).toEqual([{ id: channel!.channelId, type: "webhook" }]);
    expect(JSON.stringify(detail.referencedChannels)).not.toMatch(/sink.invalid|private|webhookUrl|recipient/);
    await expect(authedCaller(await createTestUser()).uptimeMonitor.template.detachChannel({ monitorId: created.uptimeMonitorId, channelId: channel!.channelId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await caller.uptimeMonitor.template.detachChannel({ monitorId: created.uptimeMonitorId, channelId: channel!.channelId });
    expect((await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: created.uptimeMonitorId })).referencedChannels).toEqual([]);
    expect(await db.select().from(uptimeNotificationChannel).where(eq(uptimeNotificationChannel.userId, owner.id))).toHaveLength(1);
    await caller.uptimeMonitor.monitor.delete({ uptimeMonitorId: created.uptimeMonitorId });
    expect(await db.select().from(uptimeMonitorChannelBinding).where(eq(uptimeMonitorChannelBinding.userId, owner.id))).toEqual([]);
  });


});


it("lists only owned reusable channels with safe destinations and no secret payloads", async () => {
  const owner = await createTestUser(); const other = await createTestUser();
  const [webhook] = await db.insert(uptimeNotificationChannel).values({ userId: owner.id, channelType: "webhook", ...encryptNotificationChannelSecrets("https://hooks.example.invalid/private-token?key=private-query", { Authorization: "private-header" }) }).returning();
  const [email] = await db.insert(uptimeNotificationChannel).values({ userId: owner.id, channelType: "email", recipientAddresses: ["alerts@example.invalid"] }).returning();
  await db.insert(uptimeNotificationChannel).values({ userId: other.id, channelType: "webhook", webhookUrl: "https://foreign.invalid/private" });
  const channels = await authedCaller(owner).uptimeMonitor.template.channels();
  expect(channels).toHaveLength(2);
  expect(channels).toEqual(expect.arrayContaining([
    { id: webhook!.channelId, type: "webhook", monitorId: null, destination: "hooks.example.invalid" },
    { id: email!.channelId, type: "email", monitorId: null, destination: "***@example.invalid" },
  ]));
  expect(JSON.stringify(channels)).not.toMatch(/private|foreign|webhookUrl|webhookHeaders/);
  await expect(publicCaller().uptimeMonitor.template.channels()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
