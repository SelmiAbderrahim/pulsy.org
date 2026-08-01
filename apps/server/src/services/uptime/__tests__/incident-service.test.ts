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
