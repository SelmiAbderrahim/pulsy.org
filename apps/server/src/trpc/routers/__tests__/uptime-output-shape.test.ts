import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApiKey, createTestChannel, createTestDefaultChannel, createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
import { appRouter } from "../../router";

// ---------------------------------------------------------------------------
// Owner output shaping and the public-procedure whitelist. Owner projections
// must never carry owner ids, persistence-only fields or secrets; the only
// procedures reachable without a session are the four documented ones.
// ---------------------------------------------------------------------------

vi.mock("../../../services/uptime", async importActual => ({
	...(await importActual<typeof import("../../../services/uptime")>()),
	scheduleMonitorCheck: vi.fn(),
	rescheduleMonitorCheck: vi.fn(),
	cancelMonitorCheck: vi.fn(),
}));

useCleanDatabase();

const FORBIDDEN_KEYS = ["userId", "organizationId", "requestCipher", "hashedKey", "tokenCipher", "tokenHash", "externalKey", "encryptedApiKey", "smtpPassword", "signingSecretCipher", "secretVersion", "consecutiveSlow", "consecutiveHealthy", "notificationOutageId", "lastOperationalAlertId", "lastOperationalAlertAt"];
const WEBHOOK_SECRET = "https://hooks.example.com/in/s3cr3t-path-token";
const HEADER_SECRET = "header-secret-value-1234";

/** Every key at every depth. */
function allKeys(value: unknown, found = new Set<string>()): Set<string> {
	if (Array.isArray(value)) for (const item of value) allKeys(item, found);
	else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { found.add(key); allKeys(child, found); }
	return found;
}
function expectNoForbidden(value: unknown, extra: string[] = []) {
	const keys = allKeys(value);
	for (const key of [...FORBIDDEN_KEYS, ...extra]) expect(keys.has(key), `forbidden key "${key}" present`).toBe(false);
}

let owner: Awaited<ReturnType<typeof createTestUser>>;
const caller = () => authedCaller({ id: owner.id, email: owner.email });

beforeEach(async () => {
	vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
	owner = await createTestUser();
});

afterEach(() => vi.unstubAllEnvs());

describe("owner projections", () => {
	it("monitor.list rows expose exactly the dashboard fields (pinned key set)", async () => {
		await createTestMonitor(owner.id);
		const [row] = await caller().uptimeMonitor.monitor.list();
		expectNoForbidden(row);
		const keys = Object.keys(row!).sort();
		// Any new key must be added here deliberately, after review for owner/secret leakage.
		expect(keys).toEqual([
      "uptimeMonitorId", "name", "monitorType", "url", "method", "networkConfig", "expectedStatus", "expectedStatuses", "tlsMonitoringEnabled", "timeout", "interval", "active", "status", "httpStatus", "responseTime", "lastCheckedAt", "nextCheckAt", "tlsExpiresAt", "tlsExpiresInDays", "failureThreshold", "uptimePercentage", "tags", "isPublic", "statusPageTitle", "statusPageDescription", "createdAt", "latencyPolicy", "httpAssertions", "redirectPolicy", "requestConfigured", "overrideChannelCount", "statusPageCount", "alertSuppression", "heartbeat", "uptimeChecks",
    ].sort());
		expect(keys.filter(key => (/user|owner|secret|cipher|token|hash|password/i.test(key) || key.toLowerCase().endsWith("key")) && key !== "uptimeMonitorId" && key !== "tlsMonitoringEnabled")).toEqual([]);
	});

	it("monitor.one carries no owner ids or secrets, including nested channels", async () => {
		const monitor = await createTestMonitor(owner.id);
		await createTestChannel(monitor.uptimeMonitorId, { channelType: "webhook", webhookUrl: WEBHOOK_SECRET });
		const one = await caller().uptimeMonitor.monitor.one({ uptimeMonitorId: monitor.uptimeMonitorId });
		expectNoForbidden(one);
		expect(JSON.stringify(one)).not.toContain("s3cr3t-path-token");
		expect(JSON.stringify(one)).not.toContain(owner.id);
	});

	it("monitor.create/update responses carry no persistence-only fields or secrets", async () => {
		// Create/update use the same explicitly audited owner monitor DTO.
		const created = await caller().uptimeMonitor.monitor.create({ name: "n", url: "https://example.com", method: "GET", expectedStatus: 200, timeout: 10_000, interval: 300, failureThreshold: 3, active: false, tags: [] });
		const secretKeys = ["requestCipher", "hashedKey", "tokenCipher", "tokenHash", "encryptedApiKey", "smtpPassword"];
		expectNoForbidden(created);
		for (const key of secretKeys) expect(allKeys(created).has(key), key).toBe(false);
		const updated = await caller().uptimeMonitor.monitor.update({ uptimeMonitorId: created.uptimeMonitorId, name: "renamed" });
		expectNoForbidden(updated);
		for (const key of secretKeys) expect(allKeys(updated).has(key), key).toBe(false);
	});

	it("apiKey.list and apiKey.create never return the secret hash or the owner id", async () => {
		await createTestApiKey(owner.id, { name: "listed" });
		const list = await caller().apiKey.list();
		expectNoForbidden(list);
		expect(JSON.stringify(list)).not.toContain(owner.id);
		const created = await caller().apiKey.create({ name: "fresh" });
		expectNoForbidden({ ...created, plaintext: undefined });
		expect(created.plaintext.startsWith("pul_")).toBe(true);
	});

	it("channel.list / listDefaults / create / update never return stored URLs, headers or owner ids", async () => {
		const monitor = await createTestMonitor(owner.id);
		const created = await caller().uptimeMonitor.channel.create({ uptimeMonitorId: monitor.uptimeMonitorId, channelType: "webhook", webhookUrl: WEBHOOK_SECRET, webhookHeaders: { "X-Api-Key": HEADER_SECRET } });
		// Every channel server response is masked, including creation.
		for (const secret of [HEADER_SECRET, "s3cr3t-path-token", owner.id]) expect(JSON.stringify(created)).not.toContain(secret);
		expectNoForbidden(created);
		await createTestDefaultChannel(owner.id, { channelType: "slack", webhookUrl: "https://hooks.slack.com/services/T000/B000/SLACKSECRET" });

		const afterwards = [
			await caller().uptimeMonitor.channel.list({ uptimeMonitorId: monitor.uptimeMonitorId }),
			await caller().uptimeMonitor.channel.listDefaults(),
			await caller().uptimeMonitor.channel.update({ channelId: created.channelId, notifyOnDown: false }),
		];
		for (const output of afterwards) {
			expectNoForbidden(output);
			const text = JSON.stringify(output);
			for (const secret of ["s3cr3t-path-token", HEADER_SECRET, "SLACKSECRET", owner.id]) expect(text).not.toContain(secret);
		}
	});

	it("template.channels shows masked destinations only", async () => {
		const monitor = await createTestMonitor(owner.id);
		await createTestChannel(monitor.uptimeMonitorId, { channelType: "discord", webhookUrl: "https://discord.com/api/webhooks/123456789/DISCORDSECRET" });
		const channels = await caller().uptimeMonitor.template.channels();
		expect(JSON.stringify(channels)).not.toContain("DISCORDSECRET");
		expectNoForbidden(channels);
	});
});

describe("public procedure whitelist", () => {
	const WHITELIST = ["uptimeMonitor.public.status", "uptimeMonitor.public.statusPageByDomain", "uptimeMonitor.public.statusPageBySlug", "uptimeMonitor.public.sharedLink"];
	const procedures = Object.keys(appRouter._def.procedures as Record<string, unknown>);

	it("the router exposes procedures to enumerate", () => {
		expect(procedures.length).toBeGreaterThan(100);
		for (const name of WHITELIST) expect(procedures).toContain(name);
	});

	it("every procedure outside the whitelist rejects an unauthenticated caller with UNAUTHORIZED", async () => {
		const failures: string[] = [];
		for (const name of procedures.filter(name => !WHITELIST.includes(name))) {
			const procedure = (appRouter._def.procedures as unknown as Record<string, { _def: { type: string } }>)[name]!;
			const call = (publicCaller() as unknown as Record<string, unknown>);
			const target = name.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], call) as ((input?: unknown) => Promise<unknown>) | undefined;
			if (typeof target !== "function") { failures.push(`${name}: not callable`); continue; }
			try { await target({}); failures.push(`${name}: succeeded without a session (${procedure._def.type})`); }
			catch (error) { if ((error as { code?: string }).code !== "UNAUTHORIZED") failures.push(`${name}: ${(error as { code?: string }).code}`); }
		}
		expect(failures).toEqual([]);
	});

	it("the whitelisted procedures are the only ones that do not demand a session", async () => {
		for (const name of WHITELIST) {
			const target = name.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], publicCaller()) as (input?: unknown) => Promise<unknown>;
			const error = await target({}).then(() => null, (reason: { code?: string }) => reason);
			expect(error?.code, name).not.toBe("UNAUTHORIZED");
		}
	});
});
