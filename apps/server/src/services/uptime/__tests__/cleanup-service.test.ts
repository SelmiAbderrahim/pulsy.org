import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	db,
	uptimeCheckLog,
	uptimeIncident,
	uptimeNotificationLog,
	uptimeStatusChange,
} from "@pulsy/db";
import {
	createTestMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";

// Use a tiny batch size so the batched delete loop exercises both the
// "full batch -> continue" and "partial batch -> break" paths. BATCH_SIZE is
// read at module load, so stub it before a fresh dynamic import.
let cleanup: typeof import("../cleanup-service");

beforeAll(async () => {
	vi.stubEnv("CLEANUP_BATCH_SIZE", "2");
	vi.resetModules();
	cleanup = await import("../cleanup-service");
});

afterAll(() => {
	vi.unstubAllEnvs();
});

useCleanDatabase();

let monitorId: string;

beforeAll(async () => {
	const u = await createTestUser({ id: "cleanup_user" });
	const m = await createTestMonitor(u.id, { uptimeMonitorId: "cleanup_mon" });
	monitorId = m.uptimeMonitorId;
});

// useCleanDatabase truncates before each test (incl. the user/monitor above),
// so re-create them per test.
const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
const RETENTION = 30;

async function seed(): Promise<string> {
	const u = await createTestUser();
	const m = await createTestMonitor(u.id);
	return m.uptimeMonitorId;
}

describe("cleanupOldCheckLogs", () => {
	it("deletes old logs in batches and keeps recent ones", async () => {
		const mon = await seed();
		for (let i = 0; i < 3; i++) {
			await db.insert(uptimeCheckLog).values({
				uptimeMonitorId: mon,
				status: "up",
				createdAt: old,
			});
		}
		await db
			.insert(uptimeCheckLog)
			.values({ uptimeMonitorId: mon, status: "up", createdAt: recent });

		const deleted = await cleanup.cleanupOldCheckLogs(RETENTION);
		expect(deleted).toBe(3);
		const remaining = await db.query.uptimeCheckLog.findMany();
		expect(remaining).toHaveLength(1);
	});

	it("returns 0 when nothing is old enough", async () => {
		const mon = await seed();
		await db
			.insert(uptimeCheckLog)
			.values({ uptimeMonitorId: mon, status: "up", createdAt: recent });
		expect(await cleanup.cleanupOldCheckLogs(RETENTION)).toBe(0);
	});
});

describe("cleanupOldStatusChanges", () => {
	it("deletes old status changes in batches", async () => {
		const mon = await seed();
		for (let i = 0; i < 3; i++) {
			await db.insert(uptimeStatusChange).values({
				uptimeMonitorId: mon,
				statusBefore: "up",
				statusAfter: "down",
				createdAt: old,
			});
		}
		expect(await cleanup.cleanupOldStatusChanges(RETENTION)).toBe(3);
	});

	it("returns 0 when there is nothing old", async () => {
		await seed();
		expect(await cleanup.cleanupOldStatusChanges(RETENTION)).toBe(0);
	});
});

describe("cleanupOldNotificationLogs", () => {
	it("deletes old notification logs in batches and keeps recent ones", async () => {
		const u = await createTestUser();
		const m = await createTestMonitor(u.id);
		for (let i = 0; i < 3; i++) {
			await db.insert(uptimeNotificationLog).values({
				userId: u.id,
				uptimeMonitorId: m.uptimeMonitorId,
				channelId: null,
				channelType: "webhook",
				target: "hooks.example.com",
				event: "down",
				statusChangeId: null,
				outcome: "sent",
				attempts: 1,
				providerMessageId: null,
				error: null,
				createdAt: old,
			});
		}
		await db.insert(uptimeNotificationLog).values({
			userId: u.id,
			uptimeMonitorId: m.uptimeMonitorId,
			channelId: null,
			channelType: "webhook",
			target: "hooks.example.com",
			event: "recovery",
			statusChangeId: null,
			outcome: "sent",
			attempts: 1,
			providerMessageId: null,
			error: null,
			createdAt: recent,
		});

		const deleted = await cleanup.cleanupOldNotificationLogs(RETENTION);
		expect(deleted).toBe(3);
		const remaining = await db.query.uptimeNotificationLog.findMany();
		expect(remaining).toHaveLength(1);
	});

	it("returns 0 when there is nothing old", async () => {
		await seed();
		expect(await cleanup.cleanupOldNotificationLogs(RETENTION)).toBe(0);
	});
});

describe("cleanupOldIncidents", () => {
	it("deletes only old resolved incidents, keeping ongoing and recent", async () => {
		const mon = await seed();
		// 3 old + resolved (deleted, exercises the batch loop)
		for (let i = 0; i < 3; i++) {
			await db.insert(uptimeIncident).values({
				uptimeMonitorId: mon,
				status: "resolved",
				startedAt: old,
			});
		}
		// old but still ongoing -> kept
		await db
			.insert(uptimeIncident)
			.values({ uptimeMonitorId: mon, status: "ongoing", startedAt: old });
		// resolved but recent -> kept
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: mon,
			status: "resolved",
			startedAt: recent,
		});

		const deleted = await cleanup.cleanupOldIncidents(RETENTION);
		expect(deleted).toBe(3);
		const remaining = await db.query.uptimeIncident.findMany();
		expect(remaining).toHaveLength(2);
	});

	it("returns 0 when there are no old resolved incidents", async () => {
		await seed();
		expect(await cleanup.cleanupOldIncidents(RETENTION)).toBe(0);
	});
});
