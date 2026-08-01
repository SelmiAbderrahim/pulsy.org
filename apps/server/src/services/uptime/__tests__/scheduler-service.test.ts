import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	db,
	uptimeCheckLog,
	uptimeMonitor,
	uptimeStatusChange,
} from "@pulsy/db";
import { eq } from "drizzle-orm";
import {
	createTestMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";

// ---------------------------------------------------------------------------
// Mock node-schedule so jobs never really fire, plus the side-effecting
// collaborators runCheck triggers so a run is deterministic and never hits the
// network. All shared mock state lives in a `vi.hoisted` block so it is
// initialized before the hoisted `vi.mock` factories execute (avoids TDZ).
// ---------------------------------------------------------------------------

interface FakeJob {
	name: string;
	cron: string;
	fn: () => void;
	cancel: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => {
	const scheduledJobs: Record<string, FakeJob> = {};
	return {
		scheduledJobs,
		scheduleJobMock: vi.fn(
			(name: string, cron: string, fn: () => void): FakeJob => {
				const job: FakeJob = { name, cron, fn, cancel: vi.fn() };
				scheduledJobs[name] = job;
				return job;
			},
		),
		gracefulShutdownMock: vi.fn<(...args: unknown[]) => Promise<void>>(
			async () => undefined,
		),
		performHttpCheckMock: vi.fn<(...args: unknown[]) => unknown>(),
		checkTlsCertificateMock: vi.fn<(...args: unknown[]) => unknown>(),
		createIncidentMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(
			async () => undefined,
		),
		resolveIncidentMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(
			async () => undefined,
		),
		getOngoingIncidentMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(
			async () => null,
		),
		dispatchNotificationsMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(
			async () => undefined,
		),
		dispatchTlsExpiryNotificationsMock: vi.fn<
			(...args: unknown[]) => Promise<unknown>
		>(async () => undefined),
	};
});

const {
	scheduledJobs,
	scheduleJobMock,
	gracefulShutdownMock,
	performHttpCheckMock,
	checkTlsCertificateMock,
	createIncidentMock,
	resolveIncidentMock,
	getOngoingIncidentMock,
	dispatchNotificationsMock,
	dispatchTlsExpiryNotificationsMock,
} = mocks;

vi.mock("node-schedule", () => ({
	get scheduledJobs() {
		return mocks.scheduledJobs;
	},
	scheduleJob: (name: string, cron: string, fn: () => void) =>
		mocks.scheduleJobMock(name, cron, fn),
	gracefulShutdown: () => mocks.gracefulShutdownMock(),
}));

vi.mock("../checker-service", () => ({
	performHttpCheck: (...args: unknown[]) => mocks.performHttpCheckMock(...args),
}));

vi.mock("../tls-checker-service", () => ({
	checkTlsCertificate: (...args: unknown[]) =>
		mocks.checkTlsCertificateMock(...args),
}));

vi.mock("../incident-service", () => ({
	createIncident: (...args: unknown[]) => mocks.createIncidentMock(...args),
	resolveIncident: (...args: unknown[]) => mocks.resolveIncidentMock(...args),
	getOngoingIncident: (...args: unknown[]) =>
		mocks.getOngoingIncidentMock(...args),
}));

vi.mock("../notification-service", () => ({
	dispatchNotifications: (...args: unknown[]) =>
		mocks.dispatchNotificationsMock(...args),
	dispatchTlsExpiryNotifications: (...args: unknown[]) =>
		mocks.dispatchTlsExpiryNotificationsMock(...args),
}));

import {
	scheduleMonitorCheck,
	cancelMonitorCheck,
	rescheduleMonitorCheck,
	initializeAllMonitors,
	executeCheck,
	shutdownScheduler,
} from "../scheduler-service";
import type { UptimeMonitor } from "../monitor-service";

useCleanDatabase();

let userId: string;

beforeEach(async () => {
	const u = await createTestUser();
	userId = u.id;

	// Reset the in-memory job registry between tests.
	for (const key of Object.keys(scheduledJobs)) {
		delete scheduledJobs[key];
	}
	// Re-establish the registering implementation each time (afterEach's
	// restoreAllMocks wipes vi.fn implementations).
	scheduleJobMock.mockReset();
	scheduleJobMock.mockImplementation(
		(name: string, cron: string, fn: () => void): FakeJob => {
			const job: FakeJob = { name, cron, fn, cancel: vi.fn() };
			scheduledJobs[name] = job;
			return job;
		},
	);
	gracefulShutdownMock.mockReset();
	gracefulShutdownMock.mockResolvedValue(undefined);
	performHttpCheckMock.mockReset();
	checkTlsCertificateMock.mockReset();
	createIncidentMock.mockClear();
	resolveIncidentMock.mockClear();
	getOngoingIncidentMock.mockReset();
	getOngoingIncidentMock.mockResolvedValue(null);
	dispatchNotificationsMock.mockClear();
	dispatchTlsExpiryNotificationsMock.mockClear();

	// Default check result: a healthy "up" check.
	performHttpCheckMock.mockResolvedValue({
		status: "up",
		httpStatus: 200,
		responseTime: 42,
		errorMessage: undefined,
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function fakeMonitor(overrides: Partial<UptimeMonitor> = {}): UptimeMonitor {
	return {
		uptimeMonitorId: "fake-id",
		interval: 300,
		...overrides,
	} as UptimeMonitor;
}

/** Read a monitor row back from the DB for state assertions. */
async function readMonitor(id: string) {
	const [row] = await db
		.select()
		.from(uptimeMonitor)
		.where(eq(uptimeMonitor.uptimeMonitorId, id));
	return row;
}

// ---------------------------------------------------------------------------
// scheduleMonitorCheck / cancelMonitorCheck / rescheduleMonitorCheck
// ---------------------------------------------------------------------------

describe("scheduleMonitorCheck", () => {
	it("registers a node-schedule job named after the monitor", () => {
		scheduleMonitorCheck(fakeMonitor({ uptimeMonitorId: "m1", interval: 300 }));
		expect(scheduleJobMock).toHaveBeenCalledTimes(1);
		expect(scheduledJobs["uptime-m1"]).toBeDefined();
		expect(scheduledJobs["uptime-m1"]?.cron).toBe("*/5 * * * *");
	});

	it("cancels an existing job before re-scheduling the same monitor", () => {
		scheduleMonitorCheck(fakeMonitor({ uptimeMonitorId: "m1", interval: 300 }));
		const first = scheduledJobs["uptime-m1"];
		scheduleMonitorCheck(fakeMonitor({ uptimeMonitorId: "m1", interval: 60 }));
		expect(first?.cancel).toHaveBeenCalledTimes(1);
		expect(scheduledJobs["uptime-m1"]?.cron).toBe("*/1 * * * *");
	});

	it("runs a check when the scheduled callback fires", async () => {
		const m = await createTestMonitor(userId, { active: true });
		scheduleMonitorCheck(fakeMonitor({ uptimeMonitorId: m.uptimeMonitorId }));
		// Invoke the registered callback as node-schedule would.
		scheduledJobs[`uptime-${m.uptimeMonitorId}`]?.fn();
		// Let the async run settle.
		await vi.waitFor(() => {
			expect(performHttpCheckMock).toHaveBeenCalled();
		});
	});

	it("logs and swallows an error thrown inside the scheduled run", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const m = await createTestMonitor(userId, { active: true });
		performHttpCheckMock.mockRejectedValueOnce(new Error("boom"));
		scheduleMonitorCheck(fakeMonitor({ uptimeMonitorId: m.uptimeMonitorId }));
		scheduledJobs[`uptime-${m.uptimeMonitorId}`]?.fn();
		await vi.waitFor(() => {
			expect(consoleSpy).toHaveBeenCalled();
		});
	});
});

describe("cancelMonitorCheck", () => {
	it("cancels an existing job", () => {
		scheduleMonitorCheck(fakeMonitor({ uptimeMonitorId: "c1" }));
		const job = scheduledJobs["uptime-c1"];
		cancelMonitorCheck("c1");
		expect(job?.cancel).toHaveBeenCalledTimes(1);
	});

	it("is a no-op when no job exists for the id", () => {
		expect(() => cancelMonitorCheck("nonexistent")).not.toThrow();
	});
});

describe("rescheduleMonitorCheck", () => {
	it("cancels then re-creates the job", () => {
		scheduleMonitorCheck(fakeMonitor({ uptimeMonitorId: "r1", interval: 60 }));
		const original = scheduledJobs["uptime-r1"];
		rescheduleMonitorCheck(fakeMonitor({ uptimeMonitorId: "r1", interval: 600 }));
		expect(original?.cancel).toHaveBeenCalled();
		expect(scheduledJobs["uptime-r1"]?.cron).toBe("*/10 * * * *");
	});
});

// ---------------------------------------------------------------------------
// intervalToCron — exercised indirectly via the cron stored on each job.
// ---------------------------------------------------------------------------

describe("interval -> cron mapping", () => {
	const cases: Array<[number, string]> = [
		[30, "*/30 * * * * *"], // sub-minute -> seconds field
		[60, "*/1 * * * *"], // exactly 1 minute
		[300, "*/5 * * * *"], // 5 minutes
		[600, "*/10 * * * *"], // 10 minutes
		[1800, "*/30 * * * *"], // 30 minutes
		[3600, "0 */1 * * *"], // exactly 1 hour -> hour field
	];

	for (const [interval, cron] of cases) {
		it(`maps ${interval}s -> "${cron}"`, () => {
			scheduleMonitorCheck(
				fakeMonitor({ uptimeMonitorId: `iv-${interval}`, interval }),
			);
			expect(scheduledJobs[`uptime-iv-${interval}`]?.cron).toBe(cron);
		});
	}

	it("maps a multi-hour interval to the hours field", () => {
		scheduleMonitorCheck(
			fakeMonitor({ uptimeMonitorId: "iv-7200", interval: 7200 }),
		);
		expect(scheduledJobs["uptime-iv-7200"]?.cron).toBe("0 */2 * * *");
	});
});

// ---------------------------------------------------------------------------
// initializeAllMonitors
// ---------------------------------------------------------------------------

describe("initializeAllMonitors", () => {
	it("schedules a job for each active monitor and skips inactive ones", async () => {
		const a = await createTestMonitor(userId, { name: "A", active: true });
		const b = await createTestMonitor(userId, { name: "B", active: true });
		await createTestMonitor(userId, { name: "C", active: false });

		await initializeAllMonitors();

		expect(scheduledJobs[`uptime-${a.uptimeMonitorId}`]).toBeDefined();
		expect(scheduledJobs[`uptime-${b.uptimeMonitorId}`]).toBeDefined();
		// Only the two active monitors were scheduled.
		expect(scheduleJobMock).toHaveBeenCalledTimes(2);
	});

	it("schedules nothing when there are no active monitors", async () => {
		await createTestMonitor(userId, { active: false });
		await initializeAllMonitors();
		expect(scheduleJobMock).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// executeCheck — re-entrancy guard + runCheck behavior (real DB writes)
// ---------------------------------------------------------------------------

describe("executeCheck", () => {
	it("returns early when the monitor row is missing", async () => {
		await executeCheck("does-not-exist");
		expect(performHttpCheckMock).not.toHaveBeenCalled();
	});

	it("returns early when the monitor is inactive", async () => {
		const m = await createTestMonitor(userId, { active: false });
		await executeCheck(m.uptimeMonitorId);
		expect(performHttpCheckMock).not.toHaveBeenCalled();
	});

	it("writes a check log and updates monitor state for an up result", async () => {
		const m = await createTestMonitor(userId, {
			active: true,
			status: "pending",
			interval: 60,
			url: "http://example.com", // non-https -> skip TLS branch
		});

		await executeCheck(m.uptimeMonitorId);

		const logs = await db
			.select()
			.from(uptimeCheckLog)
			.where(eq(uptimeCheckLog.uptimeMonitorId, m.uptimeMonitorId));
		expect(logs).toHaveLength(1);
		expect(logs[0]?.status).toBe("up");

		const updated = await readMonitor(m.uptimeMonitorId);
		expect(updated?.status).toBe("up");
		expect(updated?.consecutiveFailures).toBe(0);
	});

	it("skips the second concurrent call for the same monitor (re-entrancy guard)", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const m = await createTestMonitor(userId, {
			active: true,
			url: "http://example.com",
		});

		// Make performHttpCheck hang until we release it so both calls overlap.
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		performHttpCheckMock.mockImplementationOnce(async () => {
			await gate;
			return { status: "up", httpStatus: 200, responseTime: 10 };
		});

		const first = executeCheck(m.uptimeMonitorId);
		// Second call while the first is still in flight -> skipped.
		await executeCheck(m.uptimeMonitorId);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("previous check still in flight"),
		);

		release();
		await first;
		// Only the first call ran a real check.
		expect(performHttpCheckMock).toHaveBeenCalledTimes(1);
	});

	it("records a down transition, opens an incident, and dispatches notifications", async () => {
		const m = await createTestMonitor(userId, {
			active: true,
			status: "up",
			failureThreshold: 1,
			consecutiveFailures: 0,
			url: "http://example.com",
		});
		performHttpCheckMock.mockResolvedValueOnce({
			status: "down",
			httpStatus: 503,
			responseTime: 80,
			errorMessage: "5xx",
		});

		await executeCheck(m.uptimeMonitorId);

		const changes = await db
			.select()
			.from(uptimeStatusChange)
			.where(eq(uptimeStatusChange.uptimeMonitorId, m.uptimeMonitorId));
		expect(changes).toHaveLength(1);
		expect(changes[0]?.statusAfter).toBe("down");
		expect(getOngoingIncidentMock).toHaveBeenCalled();
		expect(createIncidentMock).toHaveBeenCalled();
		expect(dispatchNotificationsMock).toHaveBeenCalled();
	});

	it("does not re-open an incident when one is already ongoing", async () => {
		const m = await createTestMonitor(userId, {
			active: true,
			status: "up",
			failureThreshold: 1,
			url: "http://example.com",
		});
		getOngoingIncidentMock.mockResolvedValue({ incidentId: "x" });
		performHttpCheckMock.mockResolvedValueOnce({
			status: "down",
			httpStatus: 503,
			responseTime: 80,
			errorMessage: "5xx",
		});

		await executeCheck(m.uptimeMonitorId);
		expect(getOngoingIncidentMock).toHaveBeenCalled();
		expect(createIncidentMock).not.toHaveBeenCalled();
	});

	it("resolves the incident on an up transition", async () => {
		const m = await createTestMonitor(userId, {
			active: true,
			status: "down",
			url: "http://example.com",
		});
		performHttpCheckMock.mockResolvedValueOnce({
			status: "up",
			httpStatus: 200,
			responseTime: 30,
		});

		await executeCheck(m.uptimeMonitorId);
		// The transaction executor is threaded through as the 2nd arg.
		expect(resolveIncidentMock).toHaveBeenCalledWith(
			m.uptimeMonitorId,
			expect.anything(),
		);
		expect(dispatchNotificationsMock).toHaveBeenCalled();
	});

	it("records a degraded transition", async () => {
		const m = await createTestMonitor(userId, {
			active: true,
			status: "up",
			url: "http://example.com",
		});
		performHttpCheckMock.mockResolvedValueOnce({
			status: "degraded",
			httpStatus: 301,
			responseTime: 30,
			errorMessage: "redirect",
		});

		await executeCheck(m.uptimeMonitorId);
		const changes = await db
			.select()
			.from(uptimeStatusChange)
			.where(eq(uptimeStatusChange.uptimeMonitorId, m.uptimeMonitorId));
		expect(changes[0]?.statusAfter).toBe("degraded");
	});

	it("does NOT record a down transition below the failure threshold", async () => {
		const m = await createTestMonitor(userId, {
			active: true,
			status: "up",
			failureThreshold: 3,
			consecutiveFailures: 0,
			url: "http://example.com",
		});
		performHttpCheckMock.mockResolvedValueOnce({
			status: "down",
			httpStatus: 503,
			responseTime: 80,
			errorMessage: "5xx",
		});

		await executeCheck(m.uptimeMonitorId);
		const changes = await db
			.select()
			.from(uptimeStatusChange)
			.where(eq(uptimeStatusChange.uptimeMonitorId, m.uptimeMonitorId));
		expect(changes).toHaveLength(0);
		expect(createIncidentMock).not.toHaveBeenCalled();
		const updated = await readMonitor(m.uptimeMonitorId);
		expect(updated?.status).toBe("up");
		expect(updated?.consecutiveFailures).toBe(1);
	});

	it("records the down transition when accumulated failures reach the threshold", async () => {
		const m = await createTestMonitor(userId, {
			active: true,
			status: "up",
			failureThreshold: 3,
			consecutiveFailures: 2,
			url: "http://example.com",
		});
		performHttpCheckMock.mockResolvedValueOnce({
			status: "down",
			httpStatus: 503,
			responseTime: 80,
			errorMessage: "5xx",
		});

		await executeCheck(m.uptimeMonitorId);
		const changes = await db
			.select()
			.from(uptimeStatusChange)
			.where(eq(uptimeStatusChange.uptimeMonitorId, m.uptimeMonitorId));
		expect(changes).toHaveLength(1);
		expect(changes[0]?.statusAfter).toBe("down");
		expect(createIncidentMock).toHaveBeenCalledTimes(1);
		const updated = await readMonitor(m.uptimeMonitorId);
		expect(updated?.status).toBe("down");
		expect(updated?.consecutiveFailures).toBe(3);
	});

	it("does NOT record an up transition out of the pending state", async () => {
		const m = await createTestMonitor(userId, {
			active: true,
			status: "pending",
			url: "http://example.com",
		});
		// up result; pending -> up should not be recorded as a transition.
		await executeCheck(m.uptimeMonitorId);
		const changes = await db
			.select()
			.from(uptimeStatusChange)
			.where(eq(uptimeStatusChange.uptimeMonitorId, m.uptimeMonitorId));
		expect(changes).toHaveLength(0);
	});

	it("rolls back the entire check when a write inside the transaction fails", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const m = await createTestMonitor(userId, {
			active: true,
			status: "up",
			failureThreshold: 1,
			consecutiveFailures: 0,
			url: "http://example.com",
		});
		performHttpCheckMock.mockResolvedValueOnce({
			status: "down",
			httpStatus: 503,
			responseTime: 80,
			errorMessage: "5xx",
		});
		// createIncident runs INSIDE the transaction; make it throw so the whole
		// check (check log + monitor update + status change) must roll back.
		createIncidentMock.mockRejectedValueOnce(new Error("incident insert failed"));

		await expect(executeCheck(m.uptimeMonitorId)).rejects.toThrow(
			/incident insert failed/,
		);

		// Monitor state is unchanged: no half-applied "down" with a missing
		// status-change row (the bug that silently dropped the notification).
		const updated = await readMonitor(m.uptimeMonitorId);
		expect(updated?.status).toBe("up");
		expect(updated?.consecutiveFailures).toBe(0);

		const changes = await db
			.select()
			.from(uptimeStatusChange)
			.where(eq(uptimeStatusChange.uptimeMonitorId, m.uptimeMonitorId));
		expect(changes).toHaveLength(0);

		const logs = await db
			.select()
			.from(uptimeCheckLog)
			.where(eq(uptimeCheckLog.uptimeMonitorId, m.uptimeMonitorId));
		expect(logs).toHaveLength(0);

		// The commit never happened, so dispatch never ran.
		expect(dispatchNotificationsMock).not.toHaveBeenCalled();
		errSpy.mockRestore();
	});

	it("logs but does not throw when notification dispatch fails", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const m = await createTestMonitor(userId, {
			active: true,
			status: "up",
			failureThreshold: 1,
			url: "http://example.com",
		});
		dispatchNotificationsMock.mockRejectedValueOnce(new Error("notify boom"));
		performHttpCheckMock.mockResolvedValueOnce({
			status: "down",
			httpStatus: 503,
			responseTime: 80,
			errorMessage: "5xx",
		});

		await expect(executeCheck(m.uptimeMonitorId)).resolves.toBeUndefined();
		// Dispatch is fire-and-forget now; let its rejection handler run.
		await new Promise((resolve) => setImmediate(resolve));
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringMatching(
				/Failed to dispatch notifications.*Error/,
			),
		);
		expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain("notify boom");
	});

	it("runs the TLS check for https monitors and dispatches expiry notifications", async () => {
		const m = await createTestMonitor(userId, {
			active: true,
			status: "up",
			url: "https://secure.example.com",
		});
		checkTlsCertificateMock.mockResolvedValueOnce({
			expiresAt: "2099-01-01T00:00:00.000Z",
			expiresInDays: 365,
		});

		await executeCheck(m.uptimeMonitorId);
		expect(checkTlsCertificateMock).toHaveBeenCalledWith(m.url);
		expect(dispatchTlsExpiryNotificationsMock).toHaveBeenCalled();

		const updated = await readMonitor(m.uptimeMonitorId);
		expect(updated?.tlsExpiresInDays).toBe(365);
	});

	it("skips a repeat TLS check within the 24h window", async () => {
		const m = await createTestMonitor(userId, {
			active: true,
			status: "up",
			url: "https://secure2.example.com",
		});
		checkTlsCertificateMock.mockResolvedValue({
			expiresAt: "2099-01-01T00:00:00.000Z",
			expiresInDays: 365,
		});

		await executeCheck(m.uptimeMonitorId);
		expect(checkTlsCertificateMock).toHaveBeenCalledTimes(1);

		// Second run within the window: no further TLS check.
		await executeCheck(m.uptimeMonitorId);
		expect(checkTlsCertificateMock).toHaveBeenCalledTimes(1);
	});

	it("ignores a null TLS result and still records the timestamp", async () => {
		const m = await createTestMonitor(userId, {
			active: true,
			status: "up",
			url: "https://secure3.example.com",
		});
		checkTlsCertificateMock.mockResolvedValueOnce(null);

		await executeCheck(m.uptimeMonitorId);
		expect(checkTlsCertificateMock).toHaveBeenCalledTimes(1);
		expect(dispatchTlsExpiryNotificationsMock).not.toHaveBeenCalled();
	});

	it("logs but does not throw when the TLS check fails", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const m = await createTestMonitor(userId, {
			active: true,
			status: "up",
			url: "https://secure4.example.com",
		});
		checkTlsCertificateMock.mockRejectedValueOnce(new Error("tls boom"));

		await expect(executeCheck(m.uptimeMonitorId)).resolves.toBeUndefined();
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringMatching(/TLS check failed.*Error/),
		);
		expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain("tls boom");
	});
});

// ---------------------------------------------------------------------------
// Concurrency slots — drive many overlapping scheduled runs through the
// semaphore by firing the scheduled callbacks. CHECK_CONCURRENCY defaults to
// 20, so we exceed it to force the queue/acquire-wait path.
// ---------------------------------------------------------------------------

describe("concurrency slots", () => {
	it("queues runs beyond CHECK_CONCURRENCY and drains them all", async () => {
		const monitors = await Promise.all(
			Array.from({ length: 25 }, (_, i) =>
				createTestMonitor(userId, {
					name: `Conc ${i}`,
					active: true,
					url: "http://example.com",
				}),
			),
		);

		// Gate every check so all 25 are requested before any completes; this
		// forces 5 of them to wait for a freed slot.
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		performHttpCheckMock.mockImplementation(async () => {
			await gate;
			return { status: "up", httpStatus: 200, responseTime: 5 };
		});

		for (const m of monitors) {
			scheduleMonitorCheck(fakeMonitor({ uptimeMonitorId: m.uptimeMonitorId }));
			scheduledJobs[`uptime-${m.uptimeMonitorId}`]?.fn();
		}

		// Let the first batch acquire slots, then release everything.
		await vi.waitFor(() => {
			expect(performHttpCheckMock.mock.calls.length).toBeGreaterThanOrEqual(20);
		});
		release();

		await vi.waitFor(() => {
			expect(performHttpCheckMock.mock.calls.length).toBe(25);
		});
	});
});

// ---------------------------------------------------------------------------
// shutdownScheduler
// ---------------------------------------------------------------------------

describe("shutdownScheduler", () => {
	it("cancels all jobs and returns immediately when nothing is in flight", async () => {
		await shutdownScheduler();
		expect(gracefulShutdownMock).toHaveBeenCalledTimes(1);
	});

	it("drains an in-flight check before resolving", async () => {
		const m = await createTestMonitor(userId, {
			active: true,
			url: "http://example.com",
		});

		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let completed = false;
		performHttpCheckMock.mockImplementationOnce(async () => {
			await gate;
			completed = true;
			return { status: "up", httpStatus: 200, responseTime: 5 };
		});

		// Start a scheduled run so it registers in `runningChecks`.
		scheduleMonitorCheck(fakeMonitor({ uptimeMonitorId: m.uptimeMonitorId }));
		scheduledJobs[`uptime-${m.uptimeMonitorId}`]?.fn();
		await vi.waitFor(() => {
			expect(performHttpCheckMock).toHaveBeenCalled();
		});

		const shutdownPromise = shutdownScheduler(5000);
		release();
		await shutdownPromise;
		expect(completed).toBe(true);
	});

	it("returns after the timeout if a check never finishes", async () => {
		const m = await createTestMonitor(userId, {
			active: true,
			url: "http://example.com",
		});

		// A check that never resolves.
		performHttpCheckMock.mockImplementationOnce(
			() => new Promise<never>(() => {}),
		);

		scheduleMonitorCheck(fakeMonitor({ uptimeMonitorId: m.uptimeMonitorId }));
		scheduledJobs[`uptime-${m.uptimeMonitorId}`]?.fn();
		await vi.waitFor(() => {
			expect(performHttpCheckMock).toHaveBeenCalled();
		});

		// A tiny timeout makes the race resolve via the timeout branch quickly.
		await expect(shutdownScheduler(20)).resolves.toBeUndefined();
	});
});
