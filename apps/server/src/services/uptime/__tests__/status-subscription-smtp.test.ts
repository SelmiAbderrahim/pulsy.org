import net from "node:net";
import { describe, expect, it } from "vitest";
import { db, uptimeStatusPage, uptimeStatusPageMonitor, uptimeStatusMailJob, uptimeStatusSubscriber, uptimeMonitor } from "@pulsy/db";
import { and, eq } from "drizzle-orm";
import { createTestUser, createTestMonitor, useCleanDatabase } from "../../../../test/db";
import { getTranslator } from "../../../lib/i18n";
import { createEmailProvider, testEmailProvider, findEmailProviderById, sendViaProvider } from "../email-provider-service";
import { configureSubscriptions, requestSubscription, redeemSubscriptionToken, runStatusSubscriptions } from "../status-subscription";
import { saveAnnouncementDraft, previewAnnouncement, publishAnnouncement } from "../status-communication";
import { isTransientSendError, isAmbiguousDeliveryError } from "../../../lib/retry";
useCleanDatabase();
/** Local disposable SMTP sink: never forwards, accepts .invalid recipients only, records in memory. */
async function sink(run: (port: number, messages: string[]) => Promise<void>) {
  const messages: string[] = [], sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {}); socket.setTimeout(8000, () => socket.destroy());
    socket.write("220 fixture.invalid local SMTP\r\n"); let buffer = "", content = "", receiving = false;
    socket.on("data", data => {
      buffer += data.toString();
      if (buffer.length + content.length > 100_000) { socket.destroy(); return; }
      while (buffer.includes("\r\n")) {
        const index = buffer.indexOf("\r\n"), line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (receiving) {
          if (line === ".") { messages.push(content.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))); content = ""; receiving = false; socket.write("250 fixture receipt\r\n"); }
          else content += line + "\r\n";
        } else if (/^EHLO/i.test(line)) socket.write("250-fixture.invalid\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH PLAIN/i.test(line)) socket.write("235 authenticated\r\n");
        else if (/^RCPT TO:/i.test(line) && !/@[^<>\s]+\.invalid>?$/i.test(line)) socket.write("550 fixture recipients only\r\n");
        else if (/^DATA/i.test(line)) { receiving = true; socket.write("354 end with dot\r\n"); }
        else if (/^QUIT/i.test(line)) socket.end("221 bye\r\n"); else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("SMTP fixture address");
  try { await run(address.port, messages); } finally { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
function capability(messages: string[], action: string) { const match = messages.join("\n").match(new RegExp(`#subscription=${action}%3A([A-Za-z0-9_-]{43})`)); if (!match) throw new Error("Local capability mail missing"); return match[1]!; }
describe("actual local SMTP status delivery", () => {
  it("keeps connection refusal retryable with definite non-delivery", async () => {
    const server = net.createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture port"); await new Promise<void>(resolve => server.close(() => resolve()));
    const owner = await createTestUser();
    const provider = await createEmailProvider({ name: "Closed fixture", providerType: "smtp", smtpHost: "127.0.0.1", smtpPort: address.port, smtpUsername: "fixture", smtpPassword: "disposable-fixture", smtpSecure: false, fromAddress: "sender@fixtures.invalid" }, owner.id);
    const error = await sendViaProvider(await findEmailProviderById(provider.emailProviderId, owner.id, true), "person@fixtures.invalid", "Closed", "No delivery").catch((error: unknown) => error);
    expect(isTransientSendError(error)).toBe(true);
    expect(isAmbiguousDeliveryError(error)).toBe(false);
  });
  it("blocks private SMTP before opening a connection when private-network egress is disabled", async () => sink(async (port, messages) => {
    const previous = process.env.MONITOR_ALLOW_PRIVATE_NETWORKS;
    const owner = await createTestUser();
    const provider = await createEmailProvider({ name: "Blocked fixture", providerType: "smtp", smtpHost: "127.0.0.1", smtpPort: port, smtpUsername: "fixture", smtpPassword: "disposable-fixture", smtpSecure: false, fromAddress: "sender@fixtures.invalid" }, owner.id);
    try {
      process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = "false";
      const decrypted = await findEmailProviderById(provider.emailProviderId, owner.id, true);
      await expect(sendViaProvider(decrypted, "person@fixtures.invalid", "Blocked", "No outbound private access")).rejects.toThrow("SMTP delivery failed");
      expect(messages).toHaveLength(0);
    } finally { if (previous === undefined) delete process.env.MONITOR_ALLOW_PRIVATE_NETWORKS; else process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = previous; }
  }));
  it("verifies the provider, receives confirmation and one matching publication, then stops after unsubscribe", async () => sink(async (port, messages) => {
    const t = getTranslator("en"), owner = await createTestUser(), monitor = await createTestMonitor(owner.id, { status: "down" });
    const [page] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "local-email", title: "Local customer page", isPublished: true }).returning();
    const [member] = await db.insert(uptimeStatusPageMonitor).values({ statusPageId: page!.statusPageId, uptimeMonitorId: monitor.uptimeMonitorId }).returning();
    const provider = await createEmailProvider({ name: "Local fixture", providerType: "smtp", smtpHost: "127.0.0.1", smtpPort: port, smtpUsername: "fixture", smtpPassword: "disposable-fixture", smtpSecure: false, fromAddress: "sender@fixtures.invalid" }, owner.id);
    expect(await testEmailProvider(provider.emailProviderId, owner.id, "provider-test@fixtures.invalid")).toEqual({ success: true }); expect(messages).toHaveLength(1);
    await configureSubscriptions(owner.id, { statusPageId: page!.statusPageId, enabled: true, providerId: provider.emailProviderId, messagesPerMinute: 60, confirmChange: true }, t);
    await requestSubscription(page!.statusPageId, { email: "subscriber@fixtures.invalid", componentIds: [member!.id], language: "en" }); await runStatusSubscriptions(); expect(messages).toHaveLength(2);
    await redeemSubscriptionToken(page!.statusPageId, { action: "confirm", token: capability(messages, "confirm") });
    expect((await db.select().from(uptimeStatusSubscriber).where(eq(uptimeStatusSubscriber.userId, owner.id)))[0]?.state).toBe("confirmed");
    const draft = await saveAnnouncementDraft(owner.id, { statusPageId: page!.statusPageId, title: "Safe update", text: "<script>plain text only</script>", stage: "resolved", componentIds: [member!.id] }, t);
    await publishAnnouncement(owner.id, draft.id, (await previewAnnouncement(owner.id, draft.id, t)).revision, t);
    await new Promise(resolve => setTimeout(resolve, 1100)); await runStatusSubscriptions(); await runStatusSubscriptions(); await runStatusSubscriptions();
    expect(messages).toHaveLength(3); expect(messages[2]).toContain("&lt;script&gt;"); expect(messages[2]).not.toContain("<script>"); expect(messages[2]).toContain("Safe update");
    expect((await db.select({ status: uptimeMonitor.status }).from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, owner.id), eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId))))[0]?.status).toBe("down");
    await redeemSubscriptionToken(page!.statusPageId, { action: "unsubscribe", token: capability(messages, "unsubscribe") });
    const next = await saveAnnouncementDraft(owner.id, { statusPageId: page!.statusPageId, title: "Later update", text: "No unwanted email", stage: "monitoring", componentIds: [member!.id] }, t);
    await publishAnnouncement(owner.id, next.id, (await previewAnnouncement(owner.id, next.id, t)).revision, t); await runStatusSubscriptions(); await runStatusSubscriptions(); expect(messages).toHaveLength(3);
    const receipts = await db.select().from(uptimeStatusMailJob).where(eq(uptimeStatusMailJob.userId, owner.id)); expect(receipts.filter(job => job.deliveredAt)).toHaveLength(2);
    const encoded = JSON.stringify(receipts); for (const privateValue of ["subscriber@fixtures.invalid", "disposable-fixture", capability(messages, "confirm"), capability(messages, "unsubscribe")]) expect(encoded.includes(privateValue)).toBe(false);
  }));
});
