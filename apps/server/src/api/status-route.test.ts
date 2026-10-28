import { createServer } from "node:http";
import express from "express";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { db, uptimeStatusPage, uptimeStatusPageMonitor, uptimeStatusSubscriber, uptimeReliabilityDay, uptimeMonitor } from "@pulsy/db";
import { createTestUser, createTestMonitor, createTestEmailProvider, useCleanDatabase } from "../../test/db";
import { authedCaller } from "../../test/trpc-caller";
import { encrypt } from "../lib/crypto";
import { PUBLIC_WEB_URL } from "../lib/auth-config";
import { getTranslator } from "../lib/i18n";
import { configureSubscriptions } from "../services/uptime/status-subscription";
import { createPublicStatusRouter } from "./status-route";
useCleanDatabase();
async function serve(run: (origin: string) => Promise<void>) {
  const app = express(); app.use("/api/status", createPublicStatusRouter()); const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address");
  try { await run(`http://127.0.0.1:${address.port}/api/status`); } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
describe("opt-in compact public history", () => {
  it("returns seven completed UTC days for only selected active owned components, with neutral gaps and no private fields", async () => serve(async origin => {
    const owner = await createTestUser(), other = await createTestUser();
    const monitor = await createTestMonitor(owner.id, { active: true, name: "Private product" }), foreign = await createTestMonitor(other.id, { active: true });
    const [page] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "history", title: "Customer", isPublished: true, historyEnabled: true }).returning();
    const [member] = await db.insert(uptimeStatusPageMonitor).values({ statusPageId: page!.statusPageId, uptimeMonitorId: monitor.uptimeMonitorId, publicName: "Customer component" }).returning();
    await db.insert(uptimeStatusPageMonitor).values({ statusPageId: page!.statusPageId, uptimeMonitorId: foreign.uptimeMonitorId });
    const { emptyReliabilityBucket, dayStart, DAY_MS } = await import("../services/uptime/reliability-storage");
    const bucket = emptyReliabilityBucket(); bucket.raw.observedMs = 60000; bucket.raw.downMs = 60000; bucket.adjusted = { ...bucket.raw }; bucket.checks = 1;
    await db.insert(uptimeReliabilityDay).values({ userId: owner.id, monitorId: monitor.uptimeMonitorId, day: new Date(dayStart(Date.now()) - DAY_MS).toISOString().slice(0, 10), bucket });
    const response = await fetch(`${origin}/pages/${page!.statusPageId}/history.json`); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const schema = z.object({ version: z.literal(1), components: z.array(z.object({ componentId: z.string(), days: z.array(z.object({ raw: z.object({ availabilityPercent: z.number().nullable(), unknownMs: z.number() }).passthrough() }).passthrough()) }).passthrough()) }).passthrough();
    const value = schema.parse(await response.json()); expect(value.components).toHaveLength(1); expect(value.components[0]!.componentId).toBe(member!.id); expect(value.components[0]!.days).toHaveLength(7);
    expect(value.components[0]!.days.at(-1)!.raw.availabilityPercent).toBe(0); expect(value.components[0]!.days[0]!.raw.availabilityPercent).toBeNull();
    const serialized = JSON.stringify(value); for (const secret of [owner.email, owner.id, monitor.uptimeMonitorId, monitor.url, monitor.name, foreign.uptimeMonitorId, "policyIds", "requestCipher"]) expect(serialized).not.toContain(secret);
  }));
  it("includes the unfinished observation clipped to the last completed UTC day, then remains identical after its next check", async () => serve(async origin => {
    const owner = await createTestUser(), monitor = await createTestMonitor(owner.id, { active: true, interval: 60 });
    const [page] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "live-cursor", title: "Customer", isPublished: true, historyEnabled: true }).returning();
    await db.insert(uptimeStatusPageMonitor).values({ statusPageId: page!.statusPageId, uptimeMonitorId: monitor.uptimeMonitorId });
    const { dayStart, insertObservedCheck } = await import("../services/uptime/reliability-storage"), { and, eq } = await import("drizzle-orm"); const midnight = dayStart(Date.now());
    const observe = (at: number) => db.transaction(async tx => { const [current] = await tx.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, owner.id), eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId))).for("update"); await insertObservedCheck(tx, current!, { createdAt: new Date(at).toISOString(), status: "up", responseTime: 15 }); });
    await observe(midnight - 40000);
    const read = async () => z.object({ components: z.array(z.object({ days: z.array(z.object({ raw: z.object({ upMs: z.number(), observedMs: z.number() }) })) })) }).parse(await (await fetch(`${origin}/pages/${page!.statusPageId}/history.json`)).json()).components[0]!.days.at(-1)!.raw;
    expect(await read()).toEqual({ upMs: 40000, observedMs: 40000 }); await observe(midnight + 20000); expect(await read()).toEqual({ upMs: 40000, observedMs: 40000 });
  }));
  it("requires explicit history enablement and rejects drafts, unexpected query parameters and foreign component access", async () => serve(async origin => {
    const owner = await createTestUser();
    const [disabled] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "off", title: "Off", isPublished: true }).returning();
    const [draft] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "draft-history", title: "Draft", isPublished: false, historyEnabled: true }).returning();
    for (const page of [disabled!, draft!]) expect((await fetch(`${origin}/pages/${page.statusPageId}/history.json`)).status).toBe(404);
    expect((await fetch(`${origin}/pages/${disabled!.statusPageId}/history.json?monitorId=foreign`)).status).toBe(400);
  }));
});
async function serveBehindProxy(run: (origin: string) => Promise<void>) {
  const app = express(); app.set("trust proxy", 1); app.use("/api/status", createPublicStatusRouter()); const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address");
  try { await run(`http://127.0.0.1:${address.port}/api/status`); } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
describe("public rate-limit buckets", () => {
  it("never turns away a new visitor because the bucket table is full of other visitors", async () => serveBehindProxy(async origin => {
    const statuses = new Set<number>();
    for (let index = 0; index < 1100; index++) statuses.add((await fetch(`${origin}/pages/missing/status.json`, { headers: { "X-Forwarded-For": `198.51.${Math.floor(index / 250)}.${index % 250 + 1}` } })).status);
    expect(statuses).toEqual(new Set([404]));
  }));
  it("treats one IPv6 /64 as one client, so rotating addresses inside it does not mint new allowance", async () => serveBehindProxy(async origin => {
    const statuses: number[] = [];
    for (let index = 0; index < 245; index++) statuses.push((await fetch(`${origin}/pages/missing/status.json`, { headers: { "X-Forwarded-For": `2001:db8:77:5::${(index + 1).toString(16)}` } })).status);
    expect(statuses).toContain(429);
    // A different /64 is unaffected.
    expect((await fetch(`${origin}/pages/missing/status.json`, { headers: { "X-Forwarded-For": "2001:db8:77:6::1" } })).status).toBe(404);
  }));
});
describe("feed well-formedness", () => {
  it("strips characters XML 1.0 forbids, so one odd announcement cannot break every feed reader", async () => serve(async origin => {
    const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { name: "Component" });
    const [page] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "xml", title: "Status\u0008 page", isPublished: true }).returning();
    const [member] = await db.insert(uptimeStatusPageMonitor).values({ statusPageId: page!.statusPageId, uptimeMonitorId: monitor.uptimeMonitorId }).returning(); const caller = authedCaller(owner);
    const draft = await caller.uptimeMonitor.statusPage.communication.draft({ statusPageId: page!.statusPageId, title: "Bell\u0007 and \u001f unit", text: "Line one\u0000\nLine two \ud800 end", stage: "investigating", componentIds: [member!.id] });
    const preview = await caller.uptimeMonitor.statusPage.communication.preview({ id: draft.id }); await caller.uptimeMonitor.statusPage.communication.publish({ id: draft.id, revision: preview.revision });
    for (const format of ["feed.rss", "feed.atom"]) {
      const text = await (await fetch(`${origin}/pages/${page!.statusPageId}/${format}`)).text();
      expect(text, format).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/);
      expect(text, format).toContain("Bell and  unit");
      expect(text, format).toContain("Line one");
    }
  }));
});
describe("dedicated published status projections", () => {
  it("accepts bounded opt-in only from the exact page origins and keeps tokens out of URL inputs", async () => serve(async origin => {
    const owner = await createTestUser(); const provider = await createTestEmailProvider(owner.id, { verified: true, apiKey: encrypt("fixture-secret") });
    const [page] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "subscribe", title: "Customer", isPublished: true, customDomain: "customer.audit.invalid", domainVerified: true }).returning();
    await configureSubscriptions(owner.id, { statusPageId: page!.statusPageId, enabled: true, providerId: provider.emailProviderId, messagesPerMinute: 30, confirmChange: true }, getTranslator("en"));
    const url = `${origin}/pages/${page!.statusPageId}/subscribe`, payload = { email: "person@fixtures.invalid", componentIds: [], language: "en" };
    const post = (requestOrigin?: string, body = JSON.stringify(payload), suffix = "") => fetch(url + suffix, { method: "POST", headers: { "Content-Type": "application/json", ...(requestOrigin ? { Origin: requestOrigin } : {}) }, body });
    expect((await post()).status).toBe(403); expect((await post("https://other.audit.invalid")).status).toBe(403);
    expect((await post(new URL(PUBLIC_WEB_URL).origin, JSON.stringify(payload), "?token=forbidden")).status).toBe(400);
    expect((await post(new URL(PUBLIC_WEB_URL).origin, "{" )).status).toBe(400);
    expect((await post(new URL(PUBLIC_WEB_URL).origin, JSON.stringify({ ...payload, email: "x".repeat(20_000) }))).status).toBe(413);
    const response = await post("https://customer.audit.invalid"); expect(response.status).toBe(202); expect(await response.json()).toEqual({ outcome: "accepted" });
    expect(response.headers.get("access-control-allow-origin")).toBe("https://customer.audit.invalid"); expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    const preflight = await fetch(url, { method: "OPTIONS", headers: { Origin: "https://customer.audit.invalid", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } }); expect(preflight.status).toBe(204);
    const [subscriber] = await db.select().from(uptimeStatusSubscriber); expect(subscriber).toMatchObject({ state: "pending" }); expect(subscriber!.emailCipher).not.toContain("person@");
    const json = await (await fetch(`${origin}/pages/${page!.statusPageId}/status.json`)).text(); expect(json).not.toContain("person@"); expect(json).not.toContain("fixture-secret");
  }));

  it("serves escaped published RSS/Atom, versioned safe JSON and a small stored-state badge", async () => serve(async origin => {
    const owner = await createTestUser(); const monitor = await createTestMonitor(owner.id, { status: "down", name: "Deliberately public component" });
    const [page] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "feed", title: "Service & status", isPublished: true, domainVerifyToken: "private-domain-challenge" }).returning();
    const [member] = await db.insert(uptimeStatusPageMonitor).values({ statusPageId: page!.statusPageId, uptimeMonitorId: monitor.uptimeMonitorId }).returning(); const caller = authedCaller(owner);
    const draft = await caller.uptimeMonitor.statusPage.communication.draft({ statusPageId: page!.statusPageId, title: "Investigating & updating", text: "<script>never execute</script>\nCustomer update", stage: "investigating", componentIds: [member!.id] });
    const preview = await caller.uptimeMonitor.statusPage.communication.preview({ id: draft.id }); await caller.uptimeMonitor.statusPage.communication.publish({ id: draft.id, revision: preview.revision });
    const base = `${origin}/pages/${page!.statusPageId}`;
    const rss = await fetch(base + "/feed.rss"); expect(rss.status).toBe(200); expect(rss.headers.get("content-type")).toContain("application/rss+xml"); expect(rss.headers.get("cache-control")).toBe("no-store");
    const rssText = await rss.text(); expect(rssText).toContain("&lt;script&gt;"); expect(rssText).not.toContain("<script>"); expect(rssText).toContain("Investigating &amp; updating");
    const atom = await fetch(base + "/feed.atom"); expect(atom.status).toBe(200); expect(await atom.text()).toContain('type="text"');
    const json = await fetch(base + "/status.json"); const view = z.object({ version: z.literal(1), overallStatus: z.enum(["unknown", "outage", "partial", "degraded", "operational"]), announcements: z.array(z.unknown()) }).passthrough().parse(await json.json()); expect(view).toMatchObject({ version: 1, overallStatus: "outage" }); expect(view.announcements).toHaveLength(1);
    const svg = await fetch(base + "/badge.svg"); expect(svg.status).toBe(200); expect(await svg.text()).toContain("Outage");
    const arabicBadge = await fetch(base + "/badge.svg", { headers: { "Accept-Language": "ar" } }); expect(arabicBadge.headers.get("content-language")).toBe("ar"); expect(await arabicBadge.text()).toContain("متوقف");
    const encoded = JSON.stringify(view) + rssText; for (const privateValue of [monitor.url, "private-domain-challenge", owner.email]) expect(encoded).not.toContain(privateValue);
  }));
  it("keeps unpublished/missing pages unavailable and unknown data neutral, with bounded ingress", async () => serve(async origin => {
    const owner = await createTestUser(); const [draft] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "draft", title: "Draft", isPublished: false }).returning();
    const [published] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "empty", title: "Empty", isPublished: true }).returning();
    expect((await fetch(`${origin}/pages/${draft!.statusPageId}/status.json`)).status).toBe(404);
    expect((await fetch(`${origin}/pages/missing/status.json`)).status).toBe(404);
    expect(await (await fetch(`${origin}/pages/${published!.statusPageId}/status.json`)).json()).toMatchObject({ overallStatus: "unknown" });
    expect(await (await fetch(`${origin}/pages/${published!.statusPageId}/badge.svg`)).text()).toContain("Unknown");
    expect((await fetch(`${origin}/pages/${published!.statusPageId}/status.json?token=not-accepted`)).status).toBe(400);
    const statuses: number[] = []; for (let index = 0; index < 245; index++) statuses.push((await fetch(`${origin}/pages/missing/status.json`)).status);
    expect(statuses).toContain(429);
  }));
});

it("applies the same publication guard and token operation to case and trailing-slash variants", async () => serve(async origin => {
  const owner = await createTestUser();
  const [draft] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "private-variants", title: "Private", isPublished: false }).returning();
  const [published] = await db.insert(uptimeStatusPage).values({ userId: owner.id, slug: "public-variants", title: "Public", isPublished: true }).returning();
  const headers = { Origin: new URL(PUBLIC_WEB_URL).origin, "Content-Type": "application/json" };
  for (const suffix of ["SUBSCRIBE", "subscribe/"]) {
    const body = JSON.stringify({ email: "subscriber@fixtures.invalid", componentIds: [], language: "en" });
    const hidden = await fetch(`${origin}/pages/${draft!.statusPageId}/${suffix}`, { method: "POST", headers, body });
    const missing = await fetch(`${origin}/pages/missing/${suffix}`, { method: "POST", headers, body });
    expect(hidden.status).toBe(404); expect(missing.status).toBe(404);
    expect(await hidden.json()).toEqual(await missing.json());
  }
  for (const suffix of ["SUBSCRIPTION", "subscription/"]) {
    const response = await fetch(`${origin}/pages/${published!.statusPageId}/${suffix}`, { method: "POST", headers, body: JSON.stringify({ action: "unsubscribe", token: "a".repeat(43) }) });
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ outcome: "accepted" });
  }
}));
