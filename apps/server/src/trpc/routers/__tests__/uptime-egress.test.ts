import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, uptimeMonitor, uptimeMonitorTemplate, uptimeNotificationChannel } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { createTestChannel, createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { getTranslator } from "../../../lib/i18n";

// ---------------------------------------------------------------------------
// Egress policy at the router boundary. Every input path that stores or probes
// a destination (monitor create/update/bulk, network, template, import, share
// clone, test-configuration and every channel type) must reject the same
// private targets server-side, with a localized error, and leave the database
// untouched. DNS is faked; the strict policy is selected explicitly for every test.
// ---------------------------------------------------------------------------

const { scheduleMonitorCheck, rescheduleMonitorCheck, cancelMonitorCheck } = vi.hoisted(() => ({
	scheduleMonitorCheck: vi.fn(),
	rescheduleMonitorCheck: vi.fn(),
	cancelMonitorCheck: vi.fn(),
}));
vi.mock("../../../services/uptime", async importActual => ({
	...(await importActual<typeof import("../../../services/uptime")>()),
	scheduleMonitorCheck: (...a: unknown[]) => scheduleMonitorCheck(...a),
	rescheduleMonitorCheck: (...a: unknown[]) => rescheduleMonitorCheck(...a),
	cancelMonitorCheck: (...a: unknown[]) => cancelMonitorCheck(...a),
}));
vi.mock("../../../services/uptime/scheduler-service", async importActual => ({
	...(await importActual<typeof import("../../../services/uptime/scheduler-service")>()),
	scheduleMonitorCheck: (...a: unknown[]) => scheduleMonitorCheck(...a),
	rescheduleMonitorCheck: (...a: unknown[]) => rescheduleMonitorCheck(...a),
}));
const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", async importActual => ({ ...(await importActual<typeof import("node:dns/promises")>()), lookup: lookupMock }));

useCleanDatabase();

const t = getTranslator("en");
const BLOCKED = t("errors.targetBlocked");
const ORIGINAL = process.env.MONITOR_ALLOW_PRIVATE_NETWORKS;
const PUBLIC = [{ address: "93.184.216.34", family: 4 }];

// Literal, encoded and service-name targets must obey the same egress policy.
const DENIED_HTTP = [
	"http://169.254.169.254/latest/meta-data/",
	"http://localhost",
	"http://127.0.0.1:4000",
	"http://[::1]",
	"http://10.0.0.1",
	"http://pulsy-postgres:5432",
	"http://127.0.0.1.nip.io",
	"http://2852039166",
	"http://0xa9fea9fe",
	"http://[::ffff:169.254.169.254]",
	"http://metadata.google.internal",
];
const DENIED_HOSTS = ["169.254.169.254", "localhost", "127.0.0.1", "::1", "10.0.0.1", "pulsy-postgres", "127.0.0.1.nip.io", "2130706433"];
const ALLOWED_URL = "https://api.example.com/health";

let owner: Awaited<ReturnType<typeof createTestUser>>;
let other: Awaited<ReturnType<typeof createTestUser>>;
const caller = () => authedCaller({ id: owner.id, email: owner.email });
const otherCaller = () => authedCaller({ id: other.id, email: other.email });

beforeEach(async () => {
	process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = "false";
	lookupMock.mockReset();
	lookupMock.mockResolvedValue(PUBLIC);
	scheduleMonitorCheck.mockClear();
	rescheduleMonitorCheck.mockClear();
	cancelMonitorCheck.mockClear();
	owner = await createTestUser({ email: "owner@pulsy.test" });
	other = await createTestUser({ email: "other@pulsy.test" });
});
afterEach(() => {
	if (ORIGINAL === undefined) delete process.env.MONITOR_ALLOW_PRIVATE_NETWORKS;
	else process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = ORIGINAL;
	vi.restoreAllMocks();
});

const monitorRows = () => db.select().from(uptimeMonitor);
const channelRows = () => db.select().from(uptimeNotificationChannel);
const httpInput = (url: string) => ({ name: "Target", url, method: "GET" as const, expectedStatus: 200, timeout: 10_000, interval: 300, failureThreshold: 3, active: true, tags: [] });
const network = (hostname: string, type: "tcp" | "dns" = "tcp") => ({
	name: "Network",
	interval: 300 as const,
	timeout: 5000,
	failureThreshold: 3,
	active: false,
	tags: [],
	configuration: type === "tcp" ? { type: "tcp" as const, hostname, port: 5432 } : { type: "dns" as const, hostname, recordType: "A" as const, mode: "exists" as const, expected: [] },
});
const blocked = { code: "BAD_REQUEST", message: BLOCKED };

describe("monitor.create / createBulk / update", () => {
	it.each(DENIED_HTTP)("create rejects %s and stores nothing", async url => {
		await expect(caller().uptimeMonitor.monitor.create(httpInput(url))).rejects.toMatchObject(blocked);
		expect(await monitorRows()).toHaveLength(0);
		expect(scheduleMonitorCheck).not.toHaveBeenCalled();
	});

	it("create accepts a public destination", async () => {
		const created = await caller().uptimeMonitor.monitor.create(httpInput(ALLOWED_URL));
		expect(created.url).toBe(ALLOWED_URL);
		expect(await monitorRows()).toHaveLength(1);
	});

	it("create rejects a public name that resolves to a private address (rebinding at input time)", async () => {
		lookupMock.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
		await expect(caller().uptimeMonitor.monitor.create(httpInput("https://rebind.example.com"))).rejects.toMatchObject(blocked);
		expect(await monitorRows()).toHaveLength(0);
	});

	it("create rejects a name with mixed public and private answers", async () => {
		lookupMock.mockResolvedValue([...PUBLIC, { address: "192.168.1.10", family: 4 }]);
		await expect(caller().uptimeMonitor.monitor.create(httpInput("https://mixed.example.com"))).rejects.toMatchObject(blocked);
		expect(await monitorRows()).toHaveLength(0);
	});

	it("create surfaces a field error on url", async () => {
		await expect(caller().uptimeMonitor.monitor.create(httpInput("http://localhost"))).rejects.toMatchObject({ cause: expect.objectContaining({ field: "url" }) });
	});

	it("create returns the localized message for the caller's language", async () => {
		const es = authedCaller({ id: owner.id, language: "es" });
		await expect(es.uptimeMonitor.monitor.create(httpInput("http://10.0.0.1"))).rejects.toMatchObject({ message: getTranslator("es")("errors.targetBlocked") });
	});

	it("createBulk rejects the whole batch when one target is denied (no partial insert)", async () => {
		await expect(caller().uptimeMonitor.monitor.createBulk({ monitors: [httpInput(ALLOWED_URL), httpInput("http://169.254.169.254")] })).rejects.toMatchObject(blocked);
		expect(await monitorRows()).toHaveLength(0);
		expect(scheduleMonitorCheck).not.toHaveBeenCalled();
	});

	it.each(DENIED_HTTP.slice(0, 5))("update rejects %s and leaves the monitor unchanged", async url => {
		const monitor = await createTestMonitor(owner.id, { url: ALLOWED_URL });
		await expect(caller().uptimeMonitor.monitor.update({ uptimeMonitorId: monitor.uptimeMonitorId, url })).rejects.toMatchObject(blocked);
		const [row] = await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId));
		expect(row?.url).toBe(ALLOWED_URL);
		expect(rescheduleMonitorCheck).not.toHaveBeenCalled();
	});

	it("update accepts a public destination", async () => {
		const monitor = await createTestMonitor(owner.id, { url: ALLOWED_URL });
		await caller().uptimeMonitor.monitor.update({ uptimeMonitorId: monitor.uptimeMonitorId, url: "https://other.example.com" });
		const [row] = await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId));
		expect(row?.url).toBe("https://other.example.com/");
	});

	it("updateBulk cannot change destinations: a url in the patch is not applied", async () => {
		const monitor = await createTestMonitor(owner.id, { url: ALLOWED_URL });
		await caller().uptimeMonitor.monitor.updateBulk({ monitorIds: [monitor.uptimeMonitorId], patch: { timeout: 5000, url: "http://169.254.169.254" } as never });
		const [row] = await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId));
		expect(row).toMatchObject({ url: ALLOWED_URL, timeout: 5000 });
	});
});

describe("monitor.testConfiguration", () => {
	it.each(DENIED_HTTP.slice(0, 6))("rejects %s before any request is made", async url => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		await expect(caller().uptimeMonitor.monitor.testConfiguration({ configuration: httpInput(url) })).rejects.toMatchObject(blocked);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe("network monitors (DNS / TCP)", () => {
	it.each(DENIED_HOSTS)("network.create rejects tcp %s and stores nothing", async host => {
		await expect(caller().uptimeMonitor.network.create(network(host))).rejects.toMatchObject(blocked);
		expect(await monitorRows()).toHaveLength(0);
	});

	it.each(DENIED_HOSTS.filter(host => host !== "::1"))("network.create rejects dns %s", async host => {
		await expect(caller().uptimeMonitor.network.create(network(host, "dns"))).rejects.toMatchObject(blocked);
		expect(await monitorRows()).toHaveLength(0);
	});

	it("network.create rejects a TCP host that resolves to a private address", async () => {
		lookupMock.mockResolvedValue([{ address: "10.0.0.9", family: 4 }]);
		await expect(caller().uptimeMonitor.network.create(network("rebind.example.com"))).rejects.toMatchObject(blocked);
		expect(await monitorRows()).toHaveLength(0);
	});

	it("network.create accepts a public host; network.update rejects a private one without writing", async () => {
		const created = await caller().uptimeMonitor.network.create(network("db.example.com"));
		await expect(caller().uptimeMonitor.network.update({ ...network("169.254.169.254"), monitorId: created.uptimeMonitorId })).rejects.toMatchObject(blocked);
		const [row] = await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, created.uptimeMonitorId));
		expect(row?.networkConfig).toMatchObject({ hostname: "db.example.com" });
	});
});

describe("template.save", () => {
	const template = (hostname: string) => ({ name: "Template", configuration: { monitorType: "tcp" as const, networkConfig: { type: "tcp" as const, hostname, port: 22 }, timeout: 5000, interval: 300 as const, failureThreshold: 3, tags: [] } });

	it.each(DENIED_HOSTS)("rejects a network template for %s and stores nothing", async host => {
		await expect(caller().uptimeMonitor.template.save(template(host))).rejects.toMatchObject(blocked);
		expect(await db.select().from(uptimeMonitorTemplate)).toHaveLength(0);
	});

	it("saves a public template", async () => {
		await caller().uptimeMonitor.template.save(template("ssh.example.com"));
		expect(await db.select().from(uptimeMonitorTemplate)).toHaveLength(1);
	});
});

describe("portability import (preview + apply)", () => {
	const text = (url: string, extra: Record<string, unknown> = {}) => JSON.stringify({ format: "pulsy-monitor-configuration", version: 1, monitors: [{ key: "t", type: "http", name: "T", url, method: "GET", expectedStatus: 200, timeout: 10000, interval: 300, failureThreshold: 3, active: false, tags: [], redirectPolicy: "follow", ...extra }] });
	const tcp = (hostname: string) => JSON.stringify({ format: "pulsy-monitor-configuration", version: 1, monitors: [{ key: "n", type: "tcp", name: "N", configuration: { type: "tcp", hostname, port: 22 }, timeout: 5000, interval: 300, failureThreshold: 3, active: false, tags: [] }] });

	it.each(DENIED_HTTP.slice(0, 7))("preview rejects %s with targetBlocked; apply is refused and writes nothing", async url => {
		const preview = await caller().uptimeMonitor.portability.preview({ text: text(url) });
		expect(preview.counts.rejected).toBe(1);
		expect(preview.entries[0]).toMatchObject({ action: "rejected", reasons: expect.arrayContaining(["targetBlocked"]) });
		await expect(caller().uptimeMonitor.portability.reconcile({ text: text(url), revision: preview.revision })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await monitorRows()).toHaveLength(0);
	});

	it.each(["169.254.169.254", "localhost", "pulsy-postgres"])("preview rejects TCP host %s and apply writes nothing", async host => {
		const preview = await caller().uptimeMonitor.portability.preview({ text: tcp(host) });
		expect(preview.entries[0]).toMatchObject({ action: "rejected", reasons: expect.arrayContaining(["targetBlocked"]) });
		await expect(caller().uptimeMonitor.portability.reconcile({ text: tcp(host), revision: preview.revision })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await monitorRows()).toHaveLength(0);
	});

	it("preview and apply both accept a public destination", async () => {
		const preview = await caller().uptimeMonitor.portability.preview({ text: text(ALLOWED_URL) });
		expect(preview.counts).toMatchObject({ create: 1, rejected: 0 });
		await caller().uptimeMonitor.portability.reconcile({ text: text(ALLOWED_URL), revision: preview.revision });
		expect(await monitorRows()).toHaveLength(1);
	});

	it("one denied entry rejects the batch: the allowed entry is not applied either", async () => {
		const mixed = JSON.stringify({ format: "pulsy-monitor-configuration", version: 1, monitors: [JSON.parse(text(ALLOWED_URL)).monitors[0], { ...JSON.parse(text("http://10.0.0.1")).monitors[0], key: "bad" }] });
		const preview = await caller().uptimeMonitor.portability.preview({ text: mixed });
		expect(preview.counts).toMatchObject({ create: 1, rejected: 1 });
		await expect(caller().uptimeMonitor.portability.reconcile({ text: mixed, revision: preview.revision })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await monitorRows()).toHaveLength(0);
	});
});

describe("share.clone (share import)", () => {
	it("refuses to clone a shared monitor whose stored target is private and writes nothing for the recipient", async () => {
		// A legacy row from before the policy exists; the recipient must not inherit it.
		const legacy = await createTestMonitor(owner.id, { url: "http://169.254.169.254/latest" });
		const link = await caller().uptimeMonitor.share.create({ uptimeMonitorIds: [legacy.uptimeMonitorId] });
		await expect(otherCaller().uptimeMonitor.share.clone({ token: link.token, uptimeMonitorIds: [legacy.uptimeMonitorId] })).rejects.toMatchObject({ code: "BAD_REQUEST", message: BLOCKED });
		expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, other.id))).toHaveLength(0);
		expect(scheduleMonitorCheck).not.toHaveBeenCalled();
	});

	it("still clones a public shared monitor", async () => {
		const shared = await createTestMonitor(owner.id, { url: ALLOWED_URL });
		const link = await caller().uptimeMonitor.share.create({ uptimeMonitorIds: [shared.uptimeMonitorId] });
		const cloned = await otherCaller().uptimeMonitor.share.clone({ token: link.token, uptimeMonitorIds: [shared.uptimeMonitorId] });
		expect(cloned).toHaveLength(1);
		expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, other.id))).toHaveLength(1);
	});
});

describe("channel destinations", () => {
	const SLACK_OK = "https://hooks.slack.com/services/T000/B000/XXXXXXXX";
	const DISCORD_OK = "https://discord.com/api/webhooks/123456789/token-abc";
	const cases = [
		// [channelType, denied destinations, allowed destination]
		["webhook", ["http://169.254.169.254/hook", "http://localhost:9000", "http://10.0.0.1/x", "http://pulsy-server:4000/api", "http://127.0.0.1.nip.io/x", "http://[::1]/x"], "https://hooks.example.com/in/s3cr3t-w3bhook"],
		["slack", ["https://evil.example.com/services/T0/B0/X", "http://hooks.slack.com/services/T0/B0/X", "https://hooks.slack.com:8443/services/T0/B0/X", "https://hooks.slack.com/services/T0/B0/X?next=http://10.0.0.1", "https://hooks.slack.com.evil.example/services/T0/B0/X", "http://10.0.0.1/services/T0/B0/X"], SLACK_OK],
		["discord", ["https://evil.example.com/api/webhooks/1/x", "http://discord.com/api/webhooks/1/x", "https://cdn.discord.com/api/webhooks/1/x", "https://discord.com/api/webhooks/abc/x", "https://discord.com/api/webhooks/1/x#frag", "http://169.254.169.254/api/webhooks/1/x"], DISCORD_OK],
		["telegram", ["http://127.0.0.1:4000/bot123:abc/sendMessage", "http://169.254.169.254/bot1:a/sendMessage"], "https://api.telegram.org/bot123:abc/sendMessage?chat_id=123"],
	] as const;
	const monitorFor = () => createTestMonitor(owner.id);

	for (const [channelType, denied, allowed] of cases) {
		describe(channelType, () => {
			it.each(denied)("create rejects %s with a webhookUrl field error and stores nothing", async webhookUrl => {
				const monitor = await monitorFor();
				await expect(caller().uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType, webhookUrl })).rejects.toMatchObject({ code: "BAD_REQUEST", cause: channelType === "telegram" ? expect.objectContaining({ issues: expect.arrayContaining([expect.objectContaining({ path: ["webhookUrl"], message: "validation.telegramTarget" })]) }) : expect.objectContaining({ field: "webhookUrl" }) });
				expect(await channelRows()).toHaveLength(0);
			});

			it.each(denied.slice(0, 2))("createDefault rejects %s and stores nothing", async webhookUrl => {
				await expect(caller().uptimeMonitor.channel.createDefault({ channelType, webhookUrl })).rejects.toMatchObject({ code: "BAD_REQUEST" });
				expect(await channelRows()).toHaveLength(0);
			});

			it("create accepts the official/public destination and masks the stored target on read", async () => {
				const monitor = await monitorFor();
				const created = await caller().uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType, webhookUrl: allowed });
				expect(created.channelId).toBeTruthy();
				const listed = await caller().uptimeMonitor.channel.list({ uptimeMonitorId: monitor.uptimeMonitorId });
				const secret = { webhook: "s3cr3t-w3bhook", slack: "XXXXXXXX", discord: "token-abc", telegram: "bot123:abc" }[channelType];
				expect(JSON.stringify(listed)).not.toContain(secret);
				expect(listed[0]).toMatchObject({ hasWebhookUrl: true });
				expect(listed[0]).not.toHaveProperty("webhookUrl");
				expect(listed[0]).not.toHaveProperty("webhookHeaders");
				expect(listed[0]).not.toHaveProperty("signingSecretCipher");
			});

			it("update rejects a denied destination and keeps the stored value", async () => {
				const monitor = await monitorFor();
				const created = await caller().uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType, webhookUrl: allowed });
				const [before] = await channelRows();
				await expect(caller().uptimeMonitor.channel.update({ channelId: created.channelId, webhookUrl: denied[0] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
				const [after] = await channelRows();
				expect(after?.webhookUrl).toBe(before?.webhookUrl);
			});

			it("test rejects a stored legacy denied destination before sending", async () => {
				const monitor = await monitorFor();
				// Inserted directly: it predates the policy (plaintext legacy value).
				const legacy = await createTestChannel(monitor.uptimeMonitorId, { channelType, webhookUrl: denied[0] });
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				await expect(caller().uptimeMonitor.channel.test({ channelId: legacy.channelId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
				expect(fetchSpy).not.toHaveBeenCalled();
			});
		});
	}

	it("Slack and Discord vendor allowlists stay enforced when private networks are allowed", async () => {
		process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = "true";
		const monitor = await monitorFor();
		await expect(caller().uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "slack", webhookUrl: "https://internal-chat.example.com/services/T0/B0/X" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(caller().uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "discord", webhookUrl: "http://10.0.0.1/api/webhooks/1/x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await channelRows()).toHaveLength(0);
	});

	it("a generic webhook to a private host is allowed with private-network policy enabled", async () => {
		const monitor = await monitorFor();
		await expect(caller().uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: "http://10.0.0.1/in" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = "true";
		await expect(caller().uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: "http://10.0.0.1/in" })).resolves.toBeTruthy();
		await expect(caller().uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: "http://169.254.169.254/in" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});
