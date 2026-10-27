import { db, uptimeIncident } from "@pulsy/db";
import { isUniqueViolation } from "../../../lib/db-errors";
import { beforeEach, describe, expect, it } from "vitest";
import {
	createTestMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";
import {
	createIncident,
	findIncidentsByMonitor,
	getOngoingIncident,
	resolveIncident,
} from "../incident-service";

useCleanDatabase();

let monitorId: string;
let userId: string;

beforeEach(async () => {
	const u = await createTestUser();
	userId = u.id;
	const m = await createTestMonitor(u.id);
	monitorId = m.uptimeMonitorId;
});

describe("createIncident", () => {
	it("opens an ongoing incident with a cause", async () => {
		const incident = await createIncident(monitorId, "3 failures");
		expect(incident.status).toBe("ongoing");
		expect(incident.uptimeMonitorId).toBe(monitorId);
		expect(incident.cause).toBe("3 failures");
		expect(incident.startedAt).toBeTruthy();
		expect(incident.resolvedAt).toBeNull();
	});

	it("defaults cause to null when omitted", async () => {
		const incident = await createIncident(monitorId);
		expect(incident.cause).toBeNull();
	});
});

describe("getOngoingIncident", () => {
	it("returns null when none is open", async () => {
		expect(await getOngoingIncident(monitorId)).toBeNull();
	});

	it("returns the open incident", async () => {
		const created = await createIncident(monitorId);
		const ongoing = await getOngoingIncident(monitorId);
		expect(ongoing?.incidentId).toBe(created.incidentId);
	});
});

describe("resolveIncident", () => {
	it("returns null when there is nothing to resolve", async () => {
		expect(await resolveIncident(monitorId)).toBeNull();
	});

	it("resolves the ongoing incident and computes a duration", async () => {
		const created = await createIncident(monitorId);
		const resolved = await resolveIncident(monitorId);
		expect(resolved?.incidentId).toBe(created.incidentId);
		expect(resolved?.status).toBe("resolved");
		expect(resolved?.resolvedAt).toBeTruthy();
		expect(typeof resolved?.durationSeconds).toBe("number");
		expect(resolved?.durationSeconds).toBeGreaterThanOrEqual(0);
		// Nothing ongoing afterwards.
		expect(await getOngoingIncident(monitorId)).toBeNull();
	});
});

describe("findIncidentsByMonitor", () => {
	it("lists incidents newest-first and respects the limit", async () => {
		await createIncident(monitorId, "a");
		await resolveIncident(monitorId);
		await createIncident(monitorId, "b");

		const all = await findIncidentsByMonitor(monitorId, userId);
		expect(all).toHaveLength(2);

		const limited = await findIncidentsByMonitor(monitorId, userId, 1);
		expect(limited).toHaveLength(1);
	});

	it("returns no child rows to a different owner", async () => {
		await createIncident(monitorId);
		const other = await createTestUser();
		expect(
			await findIncidentsByMonitor(monitorId, other.id),
		).toEqual([]);
	});
});

describe("one ongoing incident per monitor is a database guarantee", () => {
	const open = (uptimeMonitorId: string) => db.insert(uptimeIncident).values({ uptimeMonitorId, status: "ongoing", startedAt: new Date().toISOString() });

	it("rejects a second ongoing incident even from a writer that skips the monitor lock", async () => {
		await open(monitorId);
		const error = await open(monitorId).then(() => null, (e: unknown) => e);
		expect(isUniqueViolation(error)).toBe(true);
	});

	it("still allows any number of resolved incidents, and a new ongoing one after resolution", async () => {
		const first = await createIncident(monitorId, "first");
		await resolveIncident(monitorId);
		await db.insert(uptimeIncident).values({ uptimeMonitorId: monitorId, status: "resolved", startedAt: new Date().toISOString(), resolvedAt: new Date().toISOString(), durationSeconds: 1 });
		const second = await createIncident(monitorId, "second");
		expect(second.incidentId).not.toBe(first.incidentId);
		expect(second.status).toBe("ongoing");
	});

	it("is per monitor: two monitors can each be down", async () => {
		const other = await createTestMonitor((await createTestUser()).id);
		await open(monitorId);
		await expect(open(other.uptimeMonitorId)).resolves.toBeDefined();
	});
});


it("uses the observation timestamp for incident opening, recovery and exact duration", async () => {
  const observedDownAt = "2026-10-09T12:00:10.000Z", observedUpAt = "2026-10-09T12:02:47.000Z";
  const incident = await createIncident(monitorId, "HTTP 503", db, "critical", observedDownAt);
  expect(incident.startedAt).toBe(observedDownAt);
  const resolved = await resolveIncident(monitorId, db, observedUpAt);
  expect(resolved?.resolvedAt).toBe(observedUpAt);
  expect(resolved?.durationSeconds).toBe(157);
});


it("keeps duration nonnegative if an older internal observation is supplied", async () => {
  await createIncident(monitorId, "HTTP 503", db, "critical", "2026-10-09T12:00:10.000Z");
  const resolved = await resolveIncident(monitorId, db, "2026-10-09T12:00:09.000Z");
  expect(resolved?.durationSeconds).toBe(0);
});

describe("concurrent recovery claim", () => {
	it("allows only one state-aware recovery transition", async () => {
		await createIncident(monitorId);
		const results = await Promise.all([
			resolveIncident(monitorId, db, "2026-10-15T12:00:00.000Z"),
			resolveIncident(monitorId, db, "2026-10-15T12:00:01.000Z"),
		]);
		expect(results.filter(Boolean)).toHaveLength(1);
		expect(await getOngoingIncident(monitorId)).toBeNull();
	});
});
