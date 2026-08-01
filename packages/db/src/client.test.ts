import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
	closeDb,
	db,
	schema,
	user,
	uptimeCheckLog,
	uptimeEmailProvider,
	uptimeIncident,
	uptimeMonitor,
	uptimeNotificationChannel,
	uptimeStatusChange,
} from "./index";

// ---------------------------------------------------------------------------
// Exercises the real Drizzle client (client.ts) against the provisioned
// Postgres: a full insert/select round-trip through every table, which also
// fires each table's nanoid()/timestamp $defaultFn. closeDb() is verified last
// (it ends the shared pool, so nothing may query afterwards).
// ---------------------------------------------------------------------------

describe("@pulsy/db client", () => {
	afterAll(async () => {
		await expect(closeDb()).resolves.toBeUndefined();
	});

	it("re-exports the schema object", () => {
		expect(schema.uptimeMonitor).toBe(uptimeMonitor);
	});

	it("round-trips a row through every table, applying defaults", async () => {
		// Start from an empty schema: `make test` shares one database with the
		// server suite, and the relation lookups below use unscoped `findFirst`.
		await db.execute(sql.raw('TRUNCATE TABLE "user" RESTART IDENTITY CASCADE'));

		const userId = "client_test_user";
		await db
			.insert(user)
			.values({ id: userId, name: "Client", email: "client@pulsy.test" });

		// Monitor — omit id + createdAt so the $defaultFn (nanoid / ISO date) fire.
		const [monitor] = await db
			.insert(uptimeMonitor)
			.values({ name: "M", url: "https://example.com", userId })
			.returning();
		expect(monitor?.uptimeMonitorId).toMatch(/.+/);
		expect(monitor?.createdAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
		const monitorId = monitor!.uptimeMonitorId;

		const [statusChange] = await db
			.insert(uptimeStatusChange)
			.values({
				uptimeMonitorId: monitorId,
				statusBefore: "pending",
				statusAfter: "up",
			})
			.returning();
		expect(statusChange?.statusChangeId).toMatch(/.+/);
		expect(statusChange?.createdAt).toMatch(/T/);

		const [checkLog] = await db
			.insert(uptimeCheckLog)
			.values({ uptimeMonitorId: monitorId, status: "up" })
			.returning();
		expect(checkLog?.checkLogId).toMatch(/.+/);
		expect(checkLog?.createdAt).toMatch(/T/);

		const [provider] = await db
			.insert(uptimeEmailProvider)
			.values({
				name: "P",
				providerType: "resend",
				fromAddress: "a@pulsy.test",
				userId,
			})
			.returning();
		expect(provider?.emailProviderId).toMatch(/.+/);
		expect(provider?.createdAt).toMatch(/T/);

		const [channel] = await db
			.insert(uptimeNotificationChannel)
			.values({ uptimeMonitorId: monitorId, userId, channelType: "webhook" })
			.returning();
		expect(channel?.channelId).toMatch(/.+/);
		expect(channel?.createdAt).toMatch(/T/);

		const [incident] = await db
			.insert(uptimeIncident)
			.values({ uptimeMonitorId: monitorId })
			.returning();
		expect(incident?.incidentId).toMatch(/.+/);
		expect(incident?.status).toBe("ongoing");
		expect(incident?.startedAt).toMatch(/T/);

		// Link the channel to the provider so the email-provider relations
		// resolve to a row.
		await db
			.update(uptimeNotificationChannel)
			.set({ emailProviderId: provider!.emailProviderId });

		// Traverse every relation so each relations() callback is invoked.
		const withChildren = await db.query.uptimeMonitor.findFirst({
			with: {
				statusChanges: true,
				checkLogs: true,
				notificationChannels: { with: { emailProvider: true } },
				incidents: true,
			},
		});
		expect(withChildren?.uptimeMonitorId).toBe(monitorId);
		expect(withChildren?.statusChanges).toHaveLength(1);
		expect(withChildren?.checkLogs).toHaveLength(1);
		expect(withChildren?.incidents).toHaveLength(1);

		// Inverse ("one") relations back to the parent monitor.
		const sc = await db.query.uptimeStatusChange.findFirst({
			with: { monitor: true },
		});
		expect(sc?.monitor?.uptimeMonitorId).toBe(monitorId);
		const cl = await db.query.uptimeCheckLog.findFirst({
			with: { monitor: true },
		});
		expect(cl?.monitor?.uptimeMonitorId).toBe(monitorId);
		const inc = await db.query.uptimeIncident.findFirst({
			with: { monitor: true },
		});
		expect(inc?.monitor?.uptimeMonitorId).toBe(monitorId);
		const prov = await db.query.uptimeEmailProvider.findFirst({
			with: { channels: true },
		});
		expect(prov?.channels).toHaveLength(1);

		// Clean up so a reused external DB doesn't accumulate rows.
		await db.execute(
			sql.raw('TRUNCATE TABLE "user" RESTART IDENTITY CASCADE'),
		);
	});
});
