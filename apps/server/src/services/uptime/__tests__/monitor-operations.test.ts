import { describe, expect, it, vi } from "vitest";
import { db, uptimeMonitor, uptimeStatusChange, uptimeCheckLog } from "@pulsy/db";
import { eq } from "drizzle-orm";
import {
	createTestMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";

// The winning-claim path of runManualCheck is exercised end-to-end by the REST
// API tests (api/v1/router.test.ts). This file covers the losing side of the
// optimistic transition claim, which needs a probe hook to mutate the row
// mid-check — mock only the probe and the side-effecting collaborators.
const mocks = vi.hoisted(() => ({
	performHttpCheckMock: vi.fn<(...args: unknown[]) => unknown>(),
	dispatchNotificationsMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(
		async () => undefined,
	),
	createIncidentMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(
		async () => undefined,
	),
	resolveIncidentMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(
		async () => null,
	),
	getOngoingIncidentMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(
		async () => null,
	),
}));

vi.mock("../checker-service", () => ({
	performHttpCheck: (...args: unknown[]) => mocks.performHttpCheckMock(...args),
}));

vi.mock("../notification-service", () => ({
	dispatchNotifications: (...args: unknown[]) =>
		mocks.dispatchNotificationsMock(...args),
}));

vi.mock("../incident-service", () => ({
	createIncident: (...args: unknown[]) => mocks.createIncidentMock(...args),
	resolveIncident: (...args: unknown[]) => mocks.resolveIncidentMock(...args),
	getOngoingIncident: (...args: unknown[]) =>
		mocks.getOngoingIncidentMock(...args),
}));

const { runManualCheck } = await import("../monitor-operations");

useCleanDatabase();

describe("runManualCheck — completed observation consistency", () => {
	it("records the latest timing without duplicating a concurrent recovery", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const user = await createTestUser();
			const monitor = await createTestMonitor(user.id, {
				active: true,
				status: "down",
				url: "http://example.com",
			});
			// A concurrent scheduled check wins the down→up transition while this
			// manual probe is in flight. Record the new timing, without repeating recovery.
			mocks.performHttpCheckMock.mockImplementationOnce(async () => {
				await db
					.update(uptimeMonitor)
					.set({ status: "up", consecutiveFailures: 0 })
					.where(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId));
				return { status: "up", httpStatus: 200, responseTime: 30 };
			});

			const updated = await runManualCheck(monitor);

			expect(updated.status).toBe("up");
			expect(warnSpy).not.toHaveBeenCalled();
      expect(updated.responseTime).toBe(30);
      expect(updated.lastCheckedAt).not.toBeNull();
			const changes = await db
				.select()
				.from(uptimeStatusChange)
				.where(eq(uptimeStatusChange.uptimeMonitorId, monitor.uptimeMonitorId));
			expect(changes).toHaveLength(0);
			expect(mocks.resolveIncidentMock).not.toHaveBeenCalled();
			expect(mocks.dispatchNotificationsMock).not.toHaveBeenCalled();
		} finally {
			warnSpy.mockRestore();
		}
	});
});


describe("latest completed observation", () => {
  it("keeps sequential 593 ms Degraded and 63 ms Up snapshots consistent even from an old caller snapshot", async () => {
    const owner = await createTestUser();
    const monitor = await createTestMonitor(owner.id, { active: true, status: "up", url: "http://example.com" });
    mocks.performHttpCheckMock.mockResolvedValueOnce({ status: "degraded", httpStatus: 200, responseTime: 593 });
    const slow = await runManualCheck(monitor);
    expect(slow).toMatchObject({status: "degraded", responseTime: 593});
    mocks.performHttpCheckMock.mockResolvedValueOnce({ status: "up", httpStatus: 200, responseTime: 63 });
    const fast = await runManualCheck(monitor);
    expect(fast).toMatchObject({status: "up", responseTime: 63});
    const logs = await db.query.uptimeCheckLog.findMany({where:eq(uptimeCheckLog.uptimeMonitorId,monitor.uptimeMonitorId)});
    expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({status:"degraded",responseTime:593,createdAt:slow.lastCheckedAt}),expect.objectContaining({status:"up",responseTime:63,createdAt:fast.lastCheckedAt})]));
  });
  it("does not rewind a newer committed completion or append misleading history", async () => {
    const owner = await createTestUser();
    const at = new Date(Date.now()+60_000).toISOString();
    const monitor = await createTestMonitor(owner.id, { active:true,status:"up",url:"http://example.com",lastCheckedAt:at,responseTime:63 });
    mocks.performHttpCheckMock.mockResolvedValueOnce({status:"degraded",httpStatus:200,responseTime:593});
    expect(await runManualCheck(monitor)).toMatchObject({status:"up",responseTime:63,lastCheckedAt:at});
    expect(await db.query.uptimeCheckLog.findMany({where:eq(uptimeCheckLog.uptimeMonitorId,monitor.uptimeMonitorId)})).toHaveLength(0);
  });
});


it("threads the same observation time through manual opening and recovery", async () => {
  const owner = await createTestUser();
  const monitor = await createTestMonitor(owner.id, { active: true, status: "up", failureThreshold: 1, url: "http://example.com" });
  mocks.performHttpCheckMock.mockResolvedValueOnce({ status: "down", httpStatus: 503, responseTime: 80, errorMessage: "HTTP 503" });
  await runManualCheck(monitor);
  const [down] = await db.select().from(uptimeStatusChange).where(eq(uptimeStatusChange.uptimeMonitorId, monitor.uptimeMonitorId));
  expect(mocks.createIncidentMock.mock.calls.at(-1)?.[4]).toBe(down?.createdAt);
  mocks.performHttpCheckMock.mockResolvedValueOnce({ status: "up", httpStatus: 200, responseTime: 30 });
  await runManualCheck(monitor);
  const changes = await db.select().from(uptimeStatusChange).where(eq(uptimeStatusChange.uptimeMonitorId, monitor.uptimeMonitorId));
  expect(mocks.resolveIncidentMock.mock.calls.at(-1)?.[2]).toBe(changes.find(change => change.statusAfter === "up")?.createdAt);
});
