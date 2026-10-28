import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, uptimeMonitor, uptimeHeartbeat, uptimeHeartbeatRun } from "@pulsy/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
import { createTestUser, createTestMonitor, createTestStatusPage, createTestStatusPageMonitor, useCleanDatabase } from "../../../../test/db";

useCleanDatabase();
afterEach(() => vi.unstubAllEnvs());
const config = { name: "Backup", interval: 300, graceSeconds: 60 };

describe("protected heartbeat configuration", () => {
	it("lists authoritative receipt and grace deadlines without credentials or foreign rows", async () => {
		const user = await createTestUser();
		const other = await createTestUser();
		const owner = authedCaller(user);
		const own = await owner.uptimeMonitor.heartbeat.create(config);
		await authedCaller(other).uptimeMonitor.heartbeat.create({ ...config, name: "Foreign" });
		const info = await owner.uptimeMonitor.heartbeat.one({ monitorId: own.monitor.uptimeMonitorId });
		const rows = await owner.uptimeMonitor.monitor.list();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.heartbeat).toEqual({ lastReceivedAt: null, expectedAt: info.expectedAt, deadlineAt: new Date(Date.parse(info.expectedAt) + 60_000).toISOString() });
		expect(JSON.stringify(rows)).not.toContain(own.token);
		expect(JSON.stringify(rows)).not.toContain("tokenHash");
		const received = "2026-10-11T12:00:00.000Z";
		await db.update(uptimeHeartbeat).set({ lastReceivedAt: received }).where(and(eq(uptimeHeartbeat.monitorId, own.monitor.uptimeMonitorId), eq(uptimeHeartbeat.userId, user.id)));
		expect((await owner.uptimeMonitor.monitor.list())[0]?.heartbeat?.lastReceivedAt).toBe(received);
		expect((await owner.uptimeMonitor.monitor.list())[0]?.lastCheckedAt).toBeNull();
	});

	it("reveals credentials only for the owner, encrypts recovery, and rotates legacy tokens", async () => {
		const user = await createTestUser();
		const other = await createTestUser();
		const owner = authedCaller(user);
		const foreign = authedCaller(other);
		const created = await owner.uptimeMonitor.heartbeat.create(config);
		const monitorId = created.monitor.uptimeMonitorId;
		await expect(publicCaller().uptimeMonitor.heartbeat.reveal({ monitorId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(foreign.uptimeMonitor.heartbeat.reveal({ monitorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(owner.uptimeMonitor.heartbeat.reveal({ monitorId: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await owner.uptimeMonitor.heartbeat.reveal({ monitorId })).toEqual({ token: created.token });
		const [stored] = await db.select().from(uptimeHeartbeat).where(and(eq(uptimeHeartbeat.monitorId, monitorId), eq(uptimeHeartbeat.userId, user.id)));
		expect(stored?.tokenCipher).toBeTruthy();
		expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(stored)).not.toContain(created.token);
		const info = await owner.uptimeMonitor.heartbeat.one({ monitorId });
		expect(info).not.toHaveProperty("tokenCipher");
		expect(info).not.toHaveProperty("tokenHash");
		await db.update(uptimeHeartbeat).set({ tokenCipher: null }).where(and(eq(uptimeHeartbeat.monitorId, monitorId), eq(uptimeHeartbeat.userId, user.id)));
		expect(await owner.uptimeMonitor.heartbeat.reveal({ monitorId })).toEqual({ token: null });
		const rotated = await owner.uptimeMonitor.heartbeat.rotate({ monitorId });
		expect(rotated.token).not.toBe(created.token);
		expect(await owner.uptimeMonitor.heartbeat.reveal({ monitorId })).toEqual(rotated);
	});

	it("requires authentication and scopes configuration, rotation, and history to the owner", async () => {
		const user = await createTestUser();
		const other = await createTestUser();
		const owner = authedCaller(user);
		const foreign = authedCaller(other);
		await expect(publicCaller().uptimeMonitor.heartbeat.create(config)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		const heartbeat = await owner.uptimeMonitor.heartbeat.create(config);
		const monitorId = heartbeat.monitor.uptimeMonitorId;
		await expect(foreign.uptimeMonitor.heartbeat.one({ monitorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(foreign.uptimeMonitor.heartbeat.runs({ monitorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(foreign.uptimeMonitor.heartbeat.rotate({ monitorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(foreign.uptimeMonitor.heartbeat.update({ ...config, monitorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(publicCaller().uptimeMonitor.heartbeat.one({ monitorId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(publicCaller().uptimeMonitor.heartbeat.rotate({ monitorId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(publicCaller().uptimeMonitor.heartbeat.runs({ monitorId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(publicCaller().uptimeMonitor.heartbeat.update({ ...config, monitorId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("validates schedule edits without fabricating health or allowing HTTP actions", async () => {
		const user = await createTestUser();
		const owner = authedCaller(user);
		const heartbeat = await owner.uptimeMonitor.heartbeat.create(config);
		const monitorId = heartbeat.monitor.uptimeMonitorId;
		await expect(owner.uptimeMonitor.heartbeat.create({ ...config, graceSeconds: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(owner.uptimeMonitor.heartbeat.update({ ...config, monitorId, interval: 29 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(owner.uptimeMonitor.monitor.update({ uptimeMonitorId: monitorId, url: "https://example.com" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(owner.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: monitorId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect((await owner.uptimeMonitor.monitor.updateBulk({ monitorIds: [monitorId], patch: { method: "POST" } })).results).toEqual([expect.objectContaining({ id: monitorId, status: "rejected" })]);
		const updated = await owner.uptimeMonitor.heartbeat.update({ ...config, monitorId, interval: 600, graceSeconds: 90 });
		expect(await owner.uptimeMonitor.heartbeat.one({ monitorId })).toMatchObject({ interval: 600, graceSeconds: 90, lastSuccessAt: null });
		expect(await owner.uptimeMonitor.monitor.one({ uptimeMonitorId: monitorId })).toMatchObject({ status: "pending", monitorType: "heartbeat", httpStatus: null });
		for (const projection of [heartbeat.monitor, updated]) {
			for (const field of ["userId", "requestCipher", "notificationOutageId", "lastOperationalAlertId", "consecutiveFailures", "tokenCipher", "tokenHash"]) expect(projection).not.toHaveProperty(field);
		}
	});

	it("returns bounded newest-first history with an explicit projection", async () => {
		const user = await createTestUser();
		const other = await createTestUser();
		const owner = authedCaller(user);
		const own = await owner.uptimeMonitor.heartbeat.create(config);
		const foreign = await authedCaller(other).uptimeMonitor.heartbeat.create(config);
		await db.insert(uptimeHeartbeatRun).values([
			{ userId: user.id, monitorId: own.monitor.uptimeMonitorId, runId: "old", startedAt: "2026-10-10T12:00:00.000Z", finishedAt: "2026-10-10T12:00:10.000Z", outcome: "success", metadata: { environment: "test" } },
			{ userId: user.id, monitorId: own.monitor.uptimeMonitorId, runId: "new", startedAt: "2026-10-11T12:00:00.000Z", finishedAt: null, outcome: "running" },
			{ userId: other.id, monitorId: foreign.monitor.uptimeMonitorId, runId: "foreign", startedAt: "2026-10-12T12:00:00.000Z", outcome: "running" },
		]);
		const rows = await owner.uptimeMonitor.heartbeat.runs({ monitorId: own.monitor.uptimeMonitorId, limit: 1 });
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ runId: "new", outcome: "running", finishedAt: null });
		expect(rows[0]).not.toHaveProperty("userId");
		expect(rows[0]).not.toHaveProperty("monitorId");
		await expect(owner.uptimeMonitor.heartbeat.runs({ monitorId: own.monitor.uptimeMonitorId, limit: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("creates mixed HTTP and heartbeat monitors concurrently beyond ten at the 30-second technical floor", async () => {
		const user = await createTestUser();
		const owner = authedCaller(user);
		for (let index = 0; index < 11; index++) await createTestMonitor(user.id, { active: false });
		const results = await Promise.all([
			owner.uptimeMonitor.heartbeat.create({ ...config, interval: 30, active: false }),
			owner.uptimeMonitor.monitor.create({ name: "HTTP", url: "https://mixed.example.invalid", interval: 30, active: false }),
			owner.uptimeMonitor.heartbeat.create({ ...config, name: "Second job", interval: 30, active: false }),
		]);
		expect(results).toHaveLength(3);
		expect(await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.userId, user.id))).toHaveLength(14);
	});

	it("never makes New or an empty or partially observed page operational and omits heartbeat credentials", async () => {
		const user = await createTestUser(); const owner = authedCaller(user);
		const page = await createTestStatusPage(user.id, { slug: "jobs", isPublished: true });
		const publicPage = () => publicCaller().uptimeMonitor.public.statusPageBySlug({ userId: user.id, slug: "jobs" });
		expect((await publicPage()).overallStatus).toBe("unknown");
		const heartbeat = await owner.uptimeMonitor.heartbeat.create(config);
		await createTestStatusPageMonitor(page.statusPageId, heartbeat.monitor.uptimeMonitorId);
		const up = await createTestMonitor(user.id, { status: "up" });
		await createTestStatusPageMonitor(page.statusPageId, up.uptimeMonitorId);
		const projection = await publicPage();
		expect(projection.overallStatus).toBe("unknown");
		expect(projection.monitors).toHaveLength(2);
		expect(projection.monitors.find(monitor => monitor.monitorType === "heartbeat")).toMatchObject({ status: "pending", uptimePercentage: null });
		await db.update(uptimeMonitor).set({ status: "down" }).where(and(eq(uptimeMonitor.uptimeMonitorId, up.uptimeMonitorId), eq(uptimeMonitor.userId, user.id)));
		const partiallyDown = await publicPage();
		expect(partiallyDown.overallStatus).toBe("partial");
		for (const view of [projection, partiallyDown]) {
			expect(JSON.stringify(view)).not.toContain(heartbeat.token);
			for (const monitor of view.monitors) {
				for (const field of ["userId", "uptimeMonitorId", "token", "tokenHash", "tokenCipher", "heartbeat", "requestCipher"]) expect(monitor).not.toHaveProperty(field);
			}
		}
	});
});
