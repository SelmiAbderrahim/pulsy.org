import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiKey, db, uptimeIncident, uptimeMonitor, uptimeMonitorTemplate, uptimeMonitorView, uptimeNotificationChannel, uptimeShareLink, uptimeStatusPage } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { createTestApiKey, createTestChannel, createTestEmailProvider, createTestMonitor, createTestSlaReportSubscription, createTestShareLink, createTestStatusPage, createTestStatusPageMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";

// ---------------------------------------------------------------------------
// Cross-user isolation. For every procedure that takes an id, user B acting on
// user A's id must get exactly what B gets for an id that does not exist:
// NOT_FOUND, same message, no data and no side effect. A's rows are re-read
// afterwards to prove nothing changed.
// ---------------------------------------------------------------------------

vi.mock("../../../services/uptime", async importActual => ({
	...(await importActual<typeof import("../../../services/uptime")>()),
	scheduleMonitorCheck: vi.fn(),
	rescheduleMonitorCheck: vi.fn(),
	cancelMonitorCheck: vi.fn(),
}));
vi.mock("../../../services/uptime/scheduler-service", async importActual => ({
	...(await importActual<typeof import("../../../services/uptime/scheduler-service")>()),
	scheduleMonitorCheck: vi.fn(),
	rescheduleMonitorCheck: vi.fn(),
}));

useCleanDatabase();

type Caller = ReturnType<typeof authedCaller>;
type Victim = {
	monitorId: string;
	channelId: string;
	statusPageId: string;
	shareLinkId: string;
	apiKeyId: string;
	viewId: string;
	templateId: string;
	incidentId: string;
	emailProviderId: string;
	slaId: string;
};

let a: Awaited<ReturnType<typeof createTestUser>>;
let b: Awaited<ReturnType<typeof createTestUser>>;
let victim: Victim;
const asA = () => authedCaller({ id: a.id, email: a.email });
const asB = () => authedCaller({ id: b.id, email: b.email });
const MISSING = "does-not-exist";

beforeEach(async () => {
	vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true"); // isolate ownership from egress policy
	a = await createTestUser({ email: "a@pulsy.test" });
	b = await createTestUser({ email: "b@pulsy.test" });
	const monitor = await createTestMonitor(a.id, { name: "A monitor", url: "https://a.example.com" });
	const channel = await createTestChannel(monitor.uptimeMonitorId, { channelType: "webhook", webhookUrl: "https://hooks.example.com/a" });
	const page = await createTestStatusPage(a.id, { title: "A page" });
	await createTestStatusPageMonitor(page.statusPageId, monitor.uptimeMonitorId);
	const link = await createTestShareLink(a.id, [monitor.uptimeMonitorId]);
	const { row: key } = await createTestApiKey(a.id, { name: "A key" });
	const view = await asA().uptimeMonitor.view.save({ name: "A view", filters: { search: "", tags: [], tagMode: "any", health: "all", sort: "status", direction: "asc" } });
	const template = await asA().uptimeMonitor.template.save({ name: "A template", configuration: { method: "GET", expectedStatus: 200, timeout: 5000, interval: 300, failureThreshold: 3, tags: [] } });
	const provider = await createTestEmailProvider(a.id);
	const sla = await createTestSlaReportSubscription(a.id, { uptimeMonitorId: monitor.uptimeMonitorId, emailProviderId: provider.emailProviderId });
	const [incident] = await db.insert(uptimeIncident).values({ uptimeMonitorId: monitor.uptimeMonitorId }).returning();
	victim = { monitorId: monitor.uptimeMonitorId, channelId: channel.channelId, statusPageId: page.statusPageId, shareLinkId: link.shareLinkId, apiKeyId: key.apiKeyId, viewId: view.id, templateId: template.id, incidentId: incident!.incidentId, emailProviderId: provider.emailProviderId, slaId: sla.slaReportSubscriptionId };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

/** Every id-taking procedure, parameterised on the id of the target resource. */
const OPERATIONS: Array<[string, (caller: Caller, id: Victim | Record<keyof Victim, string>) => Promise<unknown>]> = [
	["monitor.one", (c, v) => c.uptimeMonitor.monitor.one({ uptimeMonitorId: v.monitorId })],
	["monitor.update", (c, v) => c.uptimeMonitor.monitor.update({ uptimeMonitorId: v.monitorId, name: "pwned" })],
	["monitor.updateBulk", (c, v) => c.uptimeMonitor.monitor.updateBulk({ monitorIds: [v.monitorId], patch: { timeout: 1000 } })],
	["monitor.toggleActive", (c, v) => c.uptimeMonitor.monitor.toggleActive({ uptimeMonitorId: v.monitorId })],
	["monitor.delete", (c, v) => c.uptimeMonitor.monitor.delete({ uptimeMonitorId: v.monitorId })],
	["monitor.testConfiguration (stored id)", (c, v) => c.uptimeMonitor.monitor.testConfiguration({ uptimeMonitorId: v.monitorId, configuration: { name: "x", url: "https://example.com", method: "GET", expectedStatus: 200, timeout: 5000, interval: 300, failureThreshold: 3, active: true, tags: [] } })],
	["checkLog.list", (c, v) => c.uptimeMonitor.checkLog.list({ uptimeMonitorId: v.monitorId })],
	["statusChange.list", (c, v) => c.uptimeMonitor.statusChange.list({ uptimeMonitorId: v.monitorId })],
	["incident.list", (c, v) => c.uptimeMonitor.incident.list({ uptimeMonitorId: v.monitorId })],
	["incident.one", (c, v) => c.uptimeMonitor.incident.one({ incidentId: v.incidentId })],
	["notificationLog.list (monitor)", (c, v) => c.uptimeMonitor.notificationLog.list({ uptimeMonitorId: v.monitorId })],
	["channel.list", (c, v) => c.uptimeMonitor.channel.list({ uptimeMonitorId: v.monitorId })],
	["channel.create (on A's monitor)", (c, v) => c.uptimeMonitor.channel.create({ uptimeMonitorId: v.monitorId, channelType: "webhook", webhookUrl: "https://hooks.example.com/b" })],
	["channel.update", (c, v) => c.uptimeMonitor.channel.update({ channelId: v.channelId, webhookUrl: "https://hooks.example.com/pwn" })],
	["channel.test", (c, v) => c.uptimeMonitor.channel.test({ channelId: v.channelId })],
	["channel.delete", (c, v) => c.uptimeMonitor.channel.delete({ channelId: v.channelId })],
	["statusPage.one", (c, v) => c.uptimeMonitor.statusPage.one({ statusPageId: v.statusPageId })],
	["statusPage.update", (c, v) => c.uptimeMonitor.statusPage.update({ statusPageId: v.statusPageId, title: "pwned" })],
	["statusPage.duplicate", (c, v) => c.uptimeMonitor.statusPage.duplicate({ statusPageId: v.statusPageId, title: "copy" })],
	["statusPage.delete", (c, v) => c.uptimeMonitor.statusPage.delete({ statusPageId: v.statusPageId })],
	["share.revoke", (c, v) => c.uptimeMonitor.share.revoke({ shareLinkId: v.shareLinkId })],
	["apiKey.revoke", (c, v) => c.apiKey.revoke({ apiKeyId: v.apiKeyId })],
	["view.save (existing id)", (c, v) => c.uptimeMonitor.view.save({ id: v.viewId, name: "pwned", filters: { search: "", tags: [], tagMode: "any", health: "all", sort: "status", direction: "asc" } })],
	["view.remove", (c, v) => c.uptimeMonitor.view.remove({ id: v.viewId })],
	["template.save (existing id)", (c, v) => c.uptimeMonitor.template.save({ id: v.templateId, name: "pwned", configuration: { method: "GET", expectedStatus: 200, timeout: 5000, interval: 300, failureThreshold: 3, tags: [] } })],
	["template.remove", (c, v) => c.uptimeMonitor.template.remove({ id: v.templateId })],
	["template.fromMonitor", (c, v) => c.uptimeMonitor.template.fromMonitor({ monitorId: v.monitorId })],
	["template.detachChannel", (c, v) => c.uptimeMonitor.template.detachChannel({ monitorId: v.monitorId, channelId: v.channelId })],
	["apiKey.remove", (c, v) => c.apiKey.remove({ apiKeyId: v.apiKeyId })],
	["channel.rotateSecret", (c, v) => c.uptimeMonitor.channel.rotateSecret({ channelId: v.channelId, signingSecret: "ab".repeat(32) })],
	["statusPage.verifyDomain", (c, v) => c.uptimeMonitor.statusPage.verifyDomain({ statusPageId: v.statusPageId })],
	["statusPage.detachDomain", (c, v) => c.uptimeMonitor.statusPage.detachDomain({ statusPageId: v.statusPageId })],
	["statusPage.domainStatus", (c, v) => c.uptimeMonitor.statusPage.domainStatus({ statusPageId: v.statusPageId })],
	["checkLog.daily", (c, v) => c.uptimeMonitor.checkLog.daily({ uptimeMonitorId: v.monitorId })],
	["checkLog.stats", (c, v) => c.uptimeMonitor.checkLog.stats({ uptimeMonitorId: v.monitorId })],
	["emailProvider.update", (c, v) => c.uptimeMonitor.emailProvider.update({ emailProviderId: v.emailProviderId, name: "pwned" })],
	["emailProvider.delete", (c, v) => c.uptimeMonitor.emailProvider.delete({ emailProviderId: v.emailProviderId })],
	["slaReport.subscription.remove", (c, v) => c.uptimeMonitor.slaReport.subscription.remove({ slaReportSubscriptionId: v.slaId })],
	["incidentWorkspace.one", (c, v) => c.uptimeMonitor.incidentWorkspace.one({ incidentId: v.incidentId })],
	["incidentWorkspace.acknowledge", (c, v) => c.uptimeMonitor.incidentWorkspace.acknowledge({ incidentId: v.incidentId })],
	["incidentWorkspace.unacknowledge", (c, v) => c.uptimeMonitor.incidentWorkspace.unacknowledge({ incidentId: v.incidentId })],
	["incidentWorkspace.note", (c, v) => c.uptimeMonitor.incidentWorkspace.note({ incidentId: v.incidentId, text: "pwned" })],
	["incidentWorkspace.runbook", (c, v) => c.uptimeMonitor.incidentWorkspace.runbook({ incidentId: v.incidentId, description: "pwned" })],
	["incidentWorkspace.escalation", (c, v) => c.uptimeMonitor.incidentWorkspace.escalation({ incidentId: v.incidentId, steps: [{ channelId: v.channelId, afterSeconds: 300 }] })],
	["incidentWorkspace.cancelEscalation", (c, v) => c.uptimeMonitor.incidentWorkspace.cancelEscalation({ incidentId: v.incidentId })],
];

const missing = Object.fromEntries(["monitorId", "channelId", "statusPageId", "shareLinkId", "apiKeyId", "viewId", "templateId", "incidentId", "emailProviderId", "slaId"].map(key => [key, MISSING])) as Record<keyof Victim, string>;

async function failure(run: () => Promise<unknown>) {
	try { await run(); } catch (error) { return error as { code?: string; message?: string }; }
	return null;
}

describe("another user's ids behave exactly like missing ids", () => {
	it.each(OPERATIONS)("%s", async (_name, operation) => {
		const foreign = await failure(() => operation(asB(), victim));
		const absent = await failure(() => operation(asB(), missing));
		expect(foreign, "foreign id must be rejected").not.toBeNull();
		expect(foreign?.code).toBe("NOT_FOUND");
		expect(absent?.code).toBe("NOT_FOUND");
		// Same message for both: existence cannot be probed.
		expect(foreign?.message).toBe(absent?.message);
	});

	it.each(OPERATIONS)("%s leaves the owner's data untouched", async (_name, operation) => {
		const before = await snapshot();
		await failure(() => operation(asB(), victim));
		expect(await snapshot()).toEqual(before);
	});
});

async function snapshot() {
	return {
		monitors: await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, a.id)),
		channels: await db.select().from(uptimeNotificationChannel).where(eq(uptimeNotificationChannel.userId, a.id)),
		pages: await db.select().from(uptimeStatusPage).where(eq(uptimeStatusPage.userId, a.id)),
		links: await db.select().from(uptimeShareLink).where(eq(uptimeShareLink.userId, a.id)),
		keys: await db.select().from(apiKey).where(eq(apiKey.userId, a.id)),
		views: await db.select().from(uptimeMonitorView).where(eq(uptimeMonitorView.userId, a.id)),
		templates: await db.select().from(uptimeMonitorTemplate).where(eq(uptimeMonitorTemplate.userId, a.id)),
		incidents: await db.select().from(uptimeIncident),
	};
}

describe("monitor.deleteBulk reports foreign ids exactly like missing ids", () => {
	it("rejects them with the same reason and deletes nothing", async () => {
		const result = await asB().uptimeMonitor.monitor.deleteBulk({ ids: [victim.monitorId, MISSING], count: 2 });
		expect(result.map(row => row.status)).toEqual(["rejected", "rejected"]);
		expect(result[0]?.status === "rejected" && result[0].reason).toBe(result[1]?.status === "rejected" && result[1].reason);
		expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, a.id))).toHaveLength(1);
	});
});

describe("list endpoints never include another user's rows", () => {
	it("monitor.list, channel/default lists, statusPage.list, share.list, apiKey.list, view.list and template.list are empty for B", async () => {
		const c = asB();
		expect(await c.uptimeMonitor.monitor.list()).toEqual([]);
		expect(await c.uptimeMonitor.channel.listDefaults()).toEqual([]);
		// Accounts may own an auto-created default page; none of A's pages may appear.
		expect((await c.uptimeMonitor.statusPage.list()).map(page => page.statusPageId)).not.toContain(victim.statusPageId);
		expect(await c.uptimeMonitor.share.list()).toEqual([]);
		expect(await c.apiKey.list()).toEqual([]);
		expect(await c.uptimeMonitor.view.list()).toEqual([]);
		expect(await c.uptimeMonitor.template.list()).toEqual([]);
		expect(JSON.stringify(await c.uptimeMonitor.notificationLog.list({}))).not.toContain(victim.monitorId);
	});

	it("A still sees all of their own rows (isolation does not hide the owner's data)", async () => {
		const c = asA();
		expect(await c.uptimeMonitor.monitor.list()).toHaveLength(1);
		expect(await c.uptimeMonitor.statusPage.list()).not.toHaveLength(0);
		expect(await c.uptimeMonitor.share.list()).toHaveLength(1);
		expect(await c.apiKey.list()).toHaveLength(1);
	});
});

describe("batch operations cannot smuggle a foreign id alongside an owned one", () => {
	it("updateBulk with an owned and a foreign id fails as a whole and changes neither", async () => {
		const mine = await createTestMonitor(b.id, { name: "B monitor", timeout: 10_000 });
		await expect(asB().uptimeMonitor.monitor.updateBulk({ monitorIds: [mine.uptimeMonitorId, victim.monitorId], patch: { timeout: 1000 } })).rejects.toMatchObject({ code: "NOT_FOUND" });
		const [row] = await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, mine.uptimeMonitorId));
		expect(row?.timeout).toBe(10_000);
		const [theirs] = await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, victim.monitorId));
		expect(theirs?.timeout).toBe(10_000);
	});

	it("share.create with a foreign monitor id is a plain NOT_FOUND identical to a missing id", async () => {
		const mine = await createTestMonitor(b.id);
		const foreign = await failure(() => asB().uptimeMonitor.share.create({ uptimeMonitorIds: [mine.uptimeMonitorId, victim.monitorId] }));
		const absent = await failure(() => asB().uptimeMonitor.share.create({ uptimeMonitorIds: [mine.uptimeMonitorId, MISSING] }));
		expect(foreign?.code).toBe("NOT_FOUND");
		expect(foreign?.message).toBe(absent?.message);
		expect(await db.select().from(uptimeShareLink).where(eq(uptimeShareLink.userId, b.id))).toHaveLength(0);
	});

	it("a status page cannot be pointed at a foreign monitor", async () => {
		const page = await createTestStatusPage(b.id, { title: "B page" });
		const result = await failure(() => asB().uptimeMonitor.statusPage.setMonitors({ statusPageId: page.statusPageId, uptimeMonitorIds: [victim.monitorId] }));
		expect(result).not.toBeNull();
		expect(result?.code).toBe("NOT_FOUND");
		expect(await db.select().from(uptimeStatusPage).where(eq(uptimeStatusPage.statusPageId, page.statusPageId))).toHaveLength(1);
	});

	it("a monitor cannot bind a foreign channel by id", async () => {
		const mine = await createTestMonitor(b.id);
		await expect(asB().uptimeMonitor.network.create({ name: "n", interval: 300, timeout: 5000, failureThreshold: 3, active: false, tags: [], configuration: { type: "tcp", hostname: "db.example.com", port: 22 }, channelIds: [victim.channelId] })).rejects.toBeTruthy();
		expect(mine.userId).toBe(b.id);
	});
});
