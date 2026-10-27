import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	db,
	uptimeCheckLog,
	uptimeIncident,
	uptimeMonitor,
	uptimeNotificationChannel,
	uptimeNotificationLog,
	uptimeStatusChange,
} from "@pulsy/db";
import { eq } from "drizzle-orm";
import {
	createTestChannel,
	createTestDefaultChannel,
	createTestEmailProvider,
	createTestMonitor,
	createTestStatusPage,
	createTestStatusPageMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
import { mockFetch, type FetchMock } from "../../../../test/fetch-mock";
import { decryptNotificationChannelSecrets } from "../../../services/uptime/notification-channel-secrets";
import { runManualCheck } from "../../../services/uptime/monitor-operations";

// ---------------------------------------------------------------------------
// Mock ONLY the scheduler side-effects so the router never touches real
// node-schedule timers. Everything else (checker via global.fetch, incidents,
// notifications, email-provider service) runs against the real DB / fetch mock
// so the ownership and business branches are honestly exercised. Shared spies
// live in a `vi.hoisted` block so they exist before the hoisted `vi.mock`
// factory runs (avoids a temporal-dead-zone ReferenceError).
// ---------------------------------------------------------------------------

const { scheduleMonitorCheck, rescheduleMonitorCheck, cancelMonitorCheck } =
	vi.hoisted(() => ({
		scheduleMonitorCheck: vi.fn(),
		rescheduleMonitorCheck: vi.fn(),
		cancelMonitorCheck: vi.fn(),
	}));

vi.mock("../../../services/uptime", async (importActual) => {
	const actual =
		await importActual<typeof import("../../../services/uptime")>();
	return {
		...actual,
		scheduleMonitorCheck: (...a: unknown[]) => scheduleMonitorCheck(...a),
		rescheduleMonitorCheck: (...a: unknown[]) => rescheduleMonitorCheck(...a),
		cancelMonitorCheck: (...a: unknown[]) => cancelMonitorCheck(...a),
	};
});

// DNS is mocked so the custom-domain status/verify branches are deterministic.
const { resolve4Mock, resolveTxtMock } = vi.hoisted(() => ({
	resolve4Mock: vi.fn(async (..._a: unknown[]) => [] as string[]),
	resolveTxtMock: vi.fn(async (..._a: unknown[]) => [] as string[][]),
}));
vi.mock("node:dns/promises", () => ({
	// The router resolves via a dedicated Resolver pinned to public DNS (not the
	// host resolver). Mock the class so its resolve4/resolveTxt hit the spies.
	Resolver: class {
		setServers() {}
		resolve4(...a: unknown[]) {
			return resolve4Mock(...a);
		}
		resolveTxt(...a: unknown[]) {
			return resolveTxtMock(...a);
		}
	},
	resolve4: (...a: unknown[]) => resolve4Mock(...a),
	resolveTxt: (...a: unknown[]) => resolveTxtMock(...a),
}));

useCleanDatabase();

let owner: Awaited<ReturnType<typeof createTestUser>>;
let attacker: Awaited<ReturnType<typeof createTestUser>>;
let fetchMock: FetchMock | undefined;

beforeEach(async () => {
	owner = await createTestUser({ email: "owner@pulsy.test" });
	attacker = await createTestUser({ email: "attacker@pulsy.test" });
	scheduleMonitorCheck.mockClear();
	rescheduleMonitorCheck.mockClear();
	cancelMonitorCheck.mockClear();
});

afterEach(() => {
	fetchMock?.restore();
	fetchMock = undefined;
	vi.restoreAllMocks();
});

function ownerCaller() {
	return authedCaller({ id: owner.id, email: owner.email });
}
function attackerCaller() {
	return authedCaller({ id: attacker.id, email: attacker.email });
}

const validMonitorInput = {
	name: "Prod API",
	url: "https://api.example.com",
	method: "GET" as const,
	expectedStatus: 200,
	timeout: 10_000,
	interval: 300,
	failureThreshold: 3,
	active: true,
	tags: ["prod"],
};

// ===========================================================================
// monitor.*
// ===========================================================================

describe("uptimeMonitor.monitor.list", () => {
	it("returns only the caller's monitors", async () => {
		await createTestMonitor(owner.id, { name: "Mine" });
		await createTestMonitor(attacker.id, { name: "Theirs" });
		const list = await ownerCaller().uptimeMonitor.monitor.list();
		expect(list).toHaveLength(1);
		expect(list[0]?.name).toBe("Mine");
	});

	it("requires authentication", async () => {
		await expect(
			publicCaller().uptimeMonitor.monitor.list(),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

describe("uptimeMonitor.monitor.one", () => {
	it("returns the monitor with relations for the owner", async () => {
		const m = await createTestMonitor(owner.id);
		await createTestChannel(m.uptimeMonitorId, {
			webhookUrl: "https://hooks.example.com/private/path",
			webhookHeaders: { Authorization: "Bearer private" },
		});
		// Simulate inconsistent legacy/corrupt ownership metadata: the child row
		// points at the owner's monitor but belongs to another user. Relation
		// loading must enforce both ownership columns.
		await createTestChannel(m.uptimeMonitorId, {
			userId: attacker.id,
			webhookUrl: "https://hooks.example.com/attacker-secret",
		});
		const got = await ownerCaller().uptimeMonitor.monitor.one({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		expect(got.uptimeMonitorId).toBe(m.uptimeMonitorId);
		expect(got.notificationChannels).toHaveLength(1);
		expect(got.notificationChannels[0]).toMatchObject({
			hasWebhookUrl: true,
			webhookUrlMasked: "https://hooks.example.com/••••••••",
			hasWebhookHeaders: true,
			webhookHeaderNames: ["Authorization"],
		});
		expect(got.notificationChannels[0]).not.toHaveProperty("webhookUrl");
		expect(got.notificationChannels[0]).not.toHaveProperty("webhookHeaders");
		expect(got.notificationChannels[0]).not.toHaveProperty("secretVersion");
		expect(Array.isArray(got.incidents)).toBe(true);
	});

	it("throws NOT_FOUND for another user's monitor (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.monitor.one({
				uptimeMonitorId: m.uptimeMonitorId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("throws NOT_FOUND for a missing monitor", async () => {
		await expect(
			ownerCaller().uptimeMonitor.monitor.one({ uptimeMonitorId: "nope" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("uptimeMonitor.monitor.create", () => {
	it("creates an active monitor scoped to the user and schedules it", async () => {
		const created = await ownerCaller().uptimeMonitor.monitor.create(
			validMonitorInput,
		);
		expect((await db.query.uptimeMonitor.findFirst({ where: eq(uptimeMonitor.uptimeMonitorId, created.uptimeMonitorId) }))?.userId).toBe(owner.id);
		expect(created.status).toBe("pending");
		expect(scheduleMonitorCheck).toHaveBeenCalledTimes(1);
	});

	it("does not schedule an inactive monitor", async () => {
		await ownerCaller().uptimeMonitor.monitor.create({
			...validMonitorInput,
			active: false,
		});
		expect(scheduleMonitorCheck).not.toHaveBeenCalled();
	});

	it("rejects invalid input (bad URL)", async () => {
		await expect(
			ownerCaller().uptimeMonitor.monitor.create({
				...validMonitorInput,
				url: "not-a-url",
			}),
		).rejects.toThrow();
	});

	it("rejects an unsupported interval", async () => {
		await expect(
			ownerCaller().uptimeMonitor.monitor.create({
				...validMonitorInput,
				interval: 45,
			}),
		).rejects.toThrow();
	});
});

describe("uptimeMonitor.monitor.createBulk", () => {
	it("inserts multiple monitors and schedules each active one", async () => {
		const created = await ownerCaller().uptimeMonitor.monitor.createBulk({
			monitors: [
				{ ...validMonitorInput, name: "A", active: true },
				{ ...validMonitorInput, url: "https://example.com/second", name: "B", active: false },
			],
		});
		expect(created).toHaveLength(2);
		for (const monitor of created) expect((await db.query.uptimeMonitor.findFirst({ where: eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId) }))?.userId).toBe(owner.id);
		// Only the active monitor is scheduled.
		expect(scheduleMonitorCheck).toHaveBeenCalledTimes(1);
	});

	it("rejects an empty monitor list", async () => {
		await expect(
			ownerCaller().uptimeMonitor.monitor.createBulk({ monitors: [] }),
		).rejects.toThrow();
	});
});

describe("uptimeMonitor.monitor.update", () => {
	it("updates and reschedules an active monitor", async () => {
		const m = await createTestMonitor(owner.id, { active: true });
		const updated = await ownerCaller().uptimeMonitor.monitor.update({
			uptimeMonitorId: m.uptimeMonitorId,
			name: "Renamed",
		});
		expect(updated.name).toBe("Renamed");
		expect(rescheduleMonitorCheck).toHaveBeenCalledTimes(1);
		expect(cancelMonitorCheck).not.toHaveBeenCalled();
	});

	it("cancels scheduling when the update deactivates the monitor", async () => {
		const m = await createTestMonitor(owner.id, { active: true });
		await ownerCaller().uptimeMonitor.monitor.update({
			uptimeMonitorId: m.uptimeMonitorId,
			active: false,
		});
		expect(cancelMonitorCheck).toHaveBeenCalledTimes(1);
		expect(rescheduleMonitorCheck).not.toHaveBeenCalled();
	});

	it("throws NOT_FOUND when updating another user's monitor (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.monitor.update({
				uptimeMonitorId: m.uptimeMonitorId,
				name: "Hacked",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("uptimeMonitor.monitor.updateBulk", () => {
	it("applies the patch to every selected monitor and reschedules active ones", async () => {
		const a = await createTestMonitor(owner.id, { active: true, timeout: 10_000 });
		const b = await createTestMonitor(owner.id, { active: true, timeout: 10_000 });
		const { updated } = await ownerCaller().uptimeMonitor.monitor.updateBulk({
			monitorIds: [a.uptimeMonitorId, b.uptimeMonitorId],
			patch: { timeout: 5_000 },
		});
		expect(updated).toHaveLength(2);
		expect(updated.every((m) => m.timeout === 5_000)).toBe(true);
		expect(rescheduleMonitorCheck).toHaveBeenCalledTimes(2);
		expect(cancelMonitorCheck).not.toHaveBeenCalled();
	});

	it("cancels scheduling for inactive monitors in the selection", async () => {
		const active = await createTestMonitor(owner.id, { active: true });
		const paused = await createTestMonitor(owner.id, { active: false });
		await ownerCaller().uptimeMonitor.monitor.updateBulk({
			monitorIds: [active.uptimeMonitorId, paused.uptimeMonitorId],
			patch: { failureThreshold: 5 },
		});
		expect(rescheduleMonitorCheck).toHaveBeenCalledTimes(1);
		expect(cancelMonitorCheck).toHaveBeenCalledTimes(1);
	});

	it("replaces tags rather than merging", async () => {
		const m = await createTestMonitor(owner.id, { tags: ["old"] });
		const { updated: [updated] } = await ownerCaller().uptimeMonitor.monitor.updateBulk({
			monitorIds: [m.uptimeMonitorId],
			patch: { tags: ["new"] },
		});
		expect(updated?.tags).toEqual(["new"]);
	});

	it("runs the interval gate when the patch changes the interval", async () => {
		const m = await createTestMonitor(owner.id, { active: true, interval: 300 });
		const { updated: [updated] } = await ownerCaller().uptimeMonitor.monitor.updateBulk({
			monitorIds: [m.uptimeMonitorId],
			patch: { interval: 60 },
		});
		expect(updated?.interval).toBe(60);
		expect(rescheduleMonitorCheck).toHaveBeenCalledTimes(1);
	});

	it("throws NOT_FOUND when the selection includes another user's monitor (IDOR)", async () => {
		const mine = await createTestMonitor(owner.id);
		const theirs = await createTestMonitor(attacker.id);
		await expect(
			ownerCaller().uptimeMonitor.monitor.updateBulk({
				monitorIds: [mine.uptimeMonitorId, theirs.uptimeMonitorId],
				patch: { timeout: 5_000 },
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		// Nothing was changed.
		const [unchanged] = await db
			.select()
			.from(uptimeMonitor)
			.where(eq(uptimeMonitor.uptimeMonitorId, mine.uptimeMonitorId));
		expect(unchanged?.timeout).toBe(mine.timeout);
	});

	it("throws NOT_FOUND when the selection includes a missing monitor", async () => {
		const mine = await createTestMonitor(owner.id);
		await expect(
			ownerCaller().uptimeMonitor.monitor.updateBulk({
				monitorIds: [mine.uptimeMonitorId, "does-not-exist"],
				patch: { timeout: 5_000 },
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects an empty patch", async () => {
		const m = await createTestMonitor(owner.id);
		await expect(
			ownerCaller().uptimeMonitor.monitor.updateBulk({
				monitorIds: [m.uptimeMonitorId],
				patch: {},
			}),
		).rejects.toThrow();
	});
});

describe("uptimeMonitor.monitor.delete", () => {
	it("cancels scheduling and removes the monitor", async () => {
		const m = await createTestMonitor(owner.id);
		const res = await ownerCaller().uptimeMonitor.monitor.delete({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		expect(res).toEqual({ success: true });
		expect(cancelMonitorCheck).toHaveBeenCalledWith(m.uptimeMonitorId);
		const rows = await db
			.select()
			.from(uptimeMonitor)
			.where(eq(uptimeMonitor.uptimeMonitorId, m.uptimeMonitorId));
		expect(rows).toHaveLength(0);
	});

	it("throws NOT_FOUND when deleting another user's monitor (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.monitor.delete({
				uptimeMonitorId: m.uptimeMonitorId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("uptimeMonitor.monitor.toggleActive", () => {
	it("activates an inactive monitor and schedules it", async () => {
		const m = await createTestMonitor(owner.id, { active: false });
		const updated = await ownerCaller().uptimeMonitor.monitor.toggleActive({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		expect(updated.active).toBe(true);
		expect(updated.nextCheckAt).toBeTruthy();
		expect(scheduleMonitorCheck).toHaveBeenCalledTimes(1);
	});

	it("deactivates an active monitor and cancels scheduling", async () => {
		const m = await createTestMonitor(owner.id, { active: true });
		const updated = await ownerCaller().uptimeMonitor.monitor.toggleActive({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		expect(updated.active).toBe(false);
		expect(cancelMonitorCheck).toHaveBeenCalledTimes(1);
	});

	it("throws NOT_FOUND for another user's monitor (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.monitor.toggleActive({
				uptimeMonitorId: m.uptimeMonitorId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("uptimeMonitor.monitor.checkNow", () => {
	it("requires the row owner to match inside the manual-check mutation", async () => {
		fetchMock = mockFetch(() => new Response("ok", { status: 200 }));
		const monitor = await createTestMonitor(owner.id, {
			active: true,
			status: "pending",
		});

		await expect(
			runManualCheck({ ...monitor, userId: attacker.id }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		const [unchanged] = await db
			.select()
			.from(uptimeMonitor)
			.where(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId));
		expect(unchanged?.status).toBe("pending");
		const logs = await db
			.select()
			.from(uptimeCheckLog)
			.where(eq(uptimeCheckLog.uptimeMonitorId, monitor.uptimeMonitorId));
		expect(logs).toHaveLength(0);
	});

	it("rejects checking an inactive monitor", async () => {
		const m = await createTestMonitor(owner.id, { active: false });
		await expect(
			ownerCaller().uptimeMonitor.monitor.checkNow({
				uptimeMonitorId: m.uptimeMonitorId,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("runs an inline check (up) and writes a check log without a transition", async () => {
		fetchMock = mockFetch(() => new Response("ok", { status: 200 }));
		const m = await createTestMonitor(owner.id, {
			active: true,
			status: "pending",
			expectedStatus: 200,
		});
		const updated = await ownerCaller().uptimeMonitor.monitor.checkNow({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		expect(updated.status).toBe("up");
		const logs = await db
			.select()
			.from(uptimeCheckLog)
			.where(eq(uptimeCheckLog.uptimeMonitorId, m.uptimeMonitorId));
		expect(logs).toHaveLength(1);
		// pending -> up is not a recorded transition.
		const changes = await db
			.select()
			.from(uptimeStatusChange)
			.where(eq(uptimeStatusChange.uptimeMonitorId, m.uptimeMonitorId));
		expect(changes).toHaveLength(0);
	});

	it("records a down transition and opens an incident at the threshold", async () => {
		fetchMock = mockFetch(() => new Response("err", { status: 503 }));
		const m = await createTestMonitor(owner.id, {
			active: true,
			status: "up",
			failureThreshold: 1,
			consecutiveFailures: 0,
			expectedStatus: 200,
		});
		await ownerCaller().uptimeMonitor.monitor.checkNow({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		const changes = await db
			.select()
			.from(uptimeStatusChange)
			.where(eq(uptimeStatusChange.uptimeMonitorId, m.uptimeMonitorId));
		expect(changes).toHaveLength(1);
		expect(changes[0]?.statusAfter).toBe("down");
		const incidents = await db
			.select()
			.from(uptimeIncident)
			.where(eq(uptimeIncident.uptimeMonitorId, m.uptimeMonitorId));
		expect(incidents).toHaveLength(1);
		expect(incidents[0]?.status).toBe("ongoing");
	});

	it("records an up transition and resolves the ongoing incident", async () => {
		fetchMock = mockFetch(() => new Response("ok", { status: 200 }));
		const m = await createTestMonitor(owner.id, {
			active: true,
			status: "down",
			expectedStatus: 200,
		});
		// Seed an ongoing incident so resolveIncident has work to do.
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: m.uptimeMonitorId,
			status: "ongoing",
			startedAt: new Date().toISOString(),
		});
		await ownerCaller().uptimeMonitor.monitor.checkNow({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		const incidents = await db
			.select()
			.from(uptimeIncident)
			.where(eq(uptimeIncident.uptimeMonitorId, m.uptimeMonitorId));
		expect(incidents[0]?.status).toBe("resolved");
	});

	it("records a degraded transition", async () => {
		fetchMock = mockFetch(() => new Response("", { status: 302 }));
		const m = await createTestMonitor(owner.id, {
			active: true,
			status: "up",
			expectedStatus: 200,
		});
		await ownerCaller().uptimeMonitor.monitor.checkNow({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		const changes = await db
			.select()
			.from(uptimeStatusChange)
			.where(eq(uptimeStatusChange.uptimeMonitorId, m.uptimeMonitorId));
		expect(changes[0]?.statusAfter).toBe("degraded");
	});

	it("does not record a sub-threshold down result", async () => {
		fetchMock = mockFetch(() => new Response("err", { status: 503 }));
		const m = await createTestMonitor(owner.id, {
			active: true,
			status: "up",
			failureThreshold: 5,
			consecutiveFailures: 0,
			expectedStatus: 200,
		});
		await ownerCaller().uptimeMonitor.monitor.checkNow({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		const changes = await db
			.select()
			.from(uptimeStatusChange)
			.where(eq(uptimeStatusChange.uptimeMonitorId, m.uptimeMonitorId));
		expect(changes).toHaveLength(0);
		const [updated] = await db
			.select()
			.from(uptimeMonitor)
			.where(eq(uptimeMonitor.uptimeMonitorId, m.uptimeMonitorId));
		expect(updated?.status).toBe("up");
		expect(updated?.consecutiveFailures).toBe(1);
	});

	it("records a down transition once prior failures reach the threshold", async () => {
		fetchMock = mockFetch(() => new Response("err", { status: 503 }));
		const m = await createTestMonitor(owner.id, {
			active: true,
			status: "up",
			failureThreshold: 3,
			consecutiveFailures: 2,
			expectedStatus: 200,
		});
		await ownerCaller().uptimeMonitor.monitor.checkNow({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		const changes = await db
			.select()
			.from(uptimeStatusChange)
			.where(eq(uptimeStatusChange.uptimeMonitorId, m.uptimeMonitorId));
		expect(changes).toHaveLength(1);
		expect(changes[0]?.statusAfter).toBe("down");
		const incidents = await db
			.select()
			.from(uptimeIncident)
			.where(eq(uptimeIncident.uptimeMonitorId, m.uptimeMonitorId));
		expect(incidents).toHaveLength(1);
		const [updated] = await db
			.select()
			.from(uptimeMonitor)
			.where(eq(uptimeMonitor.uptimeMonitorId, m.uptimeMonitorId));
		expect(updated?.status).toBe("down");
		expect(updated?.consecutiveFailures).toBe(3);
	});

	it("throws NOT_FOUND for another user's monitor (IDOR)", async () => {
		const m = await createTestMonitor(owner.id, { active: true });
		await expect(
			attackerCaller().uptimeMonitor.monitor.checkNow({
				uptimeMonitorId: m.uptimeMonitorId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ===========================================================================
// statusChange.*
// ===========================================================================

describe("uptimeMonitor.statusChange.list", () => {
	it("lists status changes for an owned monitor", async () => {
		const m = await createTestMonitor(owner.id);
		await db.insert(uptimeStatusChange).values({
			uptimeMonitorId: m.uptimeMonitorId,
			statusBefore: "pending",
			statusAfter: "up",
		});
		const changes = await ownerCaller().uptimeMonitor.statusChange.list({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		expect(changes).toHaveLength(1);
	});

	it("throws NOT_FOUND for another user's monitor (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.statusChange.list({
				uptimeMonitorId: m.uptimeMonitorId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ===========================================================================
// notificationLog.*
// ===========================================================================

describe("uptimeMonitor.notificationLog.list", () => {
	async function seedLog(
		userId: string,
		monitorId: string,
		overrides: Partial<{ outcome: "sent" | "failed"; createdAt: string }> = {},
	) {
		await db.insert(uptimeNotificationLog).values({
			userId,
			uptimeMonitorId: monitorId,
			channelId: null,
			channelType: "email",
			target: "ops@pulsy.test",
			event: "down",
			statusChangeId: null,
			outcome: overrides.outcome ?? "sent",
			attempts: 1,
			providerMessageId: null,
			error: null,
			...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
		});
	}

	it("lists the caller's delivery history and paginates with a total", async () => {
		const m = await createTestMonitor(owner.id);
		for (let i = 0; i < 3; i++) await seedLog(owner.id, m.uptimeMonitorId);
		const page = await ownerCaller().uptimeMonitor.notificationLog.list({
			limit: 2,
			offset: 0,
		});
		expect(page.total).toBe(3);
		expect(page.data).toHaveLength(2);
	});

	it("narrows to a single monitor when uptimeMonitorId is given", async () => {
		const a = await createTestMonitor(owner.id);
		const b = await createTestMonitor(owner.id);
		await seedLog(owner.id, a.uptimeMonitorId);
		await seedLog(owner.id, b.uptimeMonitorId);
		const page = await ownerCaller().uptimeMonitor.notificationLog.list({
			uptimeMonitorId: a.uptimeMonitorId,
		});
		expect(page.total).toBe(1);
		expect(page.data[0]?.uptimeMonitorId).toBe(a.uptimeMonitorId);
	});

	it("never returns another user's rows (global history is user-scoped)", async () => {
		const mine = await createTestMonitor(owner.id);
		const theirs = await createTestMonitor(attacker.id);
		await seedLog(owner.id, mine.uptimeMonitorId);
		await seedLog(attacker.id, theirs.uptimeMonitorId);
		const page = await ownerCaller().uptimeMonitor.notificationLog.list({});
		expect(page.total).toBe(1);
		expect(page.data[0]?.uptimeMonitorId).toBe(mine.uptimeMonitorId);
	});

	it("throws NOT_FOUND when scoping to another user's monitor (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.notificationLog.list({
				uptimeMonitorId: m.uptimeMonitorId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ===========================================================================
// checkLog.*
// ===========================================================================

describe("uptimeMonitor.checkLog.list", () => {
	async function seedLog(monitorId: string, createdAt?: string) {
		await db.insert(uptimeCheckLog).values({
			uptimeMonitorId: monitorId,
			status: "up",
			httpStatus: 200,
			responseTime: 100,
			...(createdAt ? { createdAt } : {}),
		});
	}

	it("paginates and returns a total", async () => {
		const m = await createTestMonitor(owner.id);
		for (let i = 0; i < 3; i++) await seedLog(m.uptimeMonitorId);
		const page = await ownerCaller().uptimeMonitor.checkLog.list({
			uptimeMonitorId: m.uptimeMonitorId,
			limit: 2,
			offset: 0,
		});
		expect(page.total).toBe(3);
		expect(page.data).toHaveLength(2);
	});

	it("filters by start and end date", async () => {
		const m = await createTestMonitor(owner.id);
		const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
		const recent = new Date(Date.now() - 1 * 86_400_000).toISOString();
		await seedLog(m.uptimeMonitorId, old);
		await seedLog(m.uptimeMonitorId, recent);
		const filtered = await ownerCaller().uptimeMonitor.checkLog.list({
			uptimeMonitorId: m.uptimeMonitorId,
			startDate: new Date(Date.now() - 5 * 86_400_000).toISOString(),
			endDate: new Date().toISOString(),
		});
		expect(filtered.total).toBe(1);
	});

	it("throws NOT_FOUND for another user's monitor (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.checkLog.list({
				uptimeMonitorId: m.uptimeMonitorId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("uptimeMonitor.checkLog.stats", () => {
	it("computes aggregate stats over the window", async () => {
		const m = await createTestMonitor(owner.id);
		await db.insert(uptimeCheckLog).values([
			{
				uptimeMonitorId: m.uptimeMonitorId,
				status: "up",
				httpStatus: 200,
				responseTime: 100,
			},
			{
				uptimeMonitorId: m.uptimeMonitorId,
				status: "up",
				httpStatus: 200,
				responseTime: 300,
			},
			{
				uptimeMonitorId: m.uptimeMonitorId,
				status: "down",
				httpStatus: 503,
				responseTime: null,
			},
		]);
		const stats = await ownerCaller().uptimeMonitor.checkLog.stats({
			uptimeMonitorId: m.uptimeMonitorId,
			days: 30,
		});
		expect(stats.totalChecks).toBe(3);
		expect(stats.upChecks).toBe(2);
		expect(stats.downChecks).toBe(1);
		expect(stats.avgResponseTime).toBe(200);
		expect(stats.maxResponseTime).toBe(300);
		expect(stats.minResponseTime).toBe(100);
		expect(stats.uptimePercentage).toBeCloseTo(66.67, 1);
	});

	it("keeps averages unknown when there are no checks in the window", async () => {
		const m = await createTestMonitor(owner.id);
		const stats = await ownerCaller().uptimeMonitor.checkLog.stats({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		expect(stats.totalChecks).toBe(0);
		expect(stats.uptimePercentage).toBeNull();
		expect(stats.avgResponseTime).toBeNull();
		expect(stats.incidentCount).toBe(0);
	});

	it("counts incidents started within the window", async () => {
		const m = await createTestMonitor(owner.id);
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: m.uptimeMonitorId,
			status: "ongoing",
			startedAt: new Date().toISOString(),
		});
		const stats = await ownerCaller().uptimeMonitor.checkLog.stats({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		expect(stats.incidentCount).toBe(1);
	});

	it("throws NOT_FOUND for another user's monitor (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.checkLog.stats({
				uptimeMonitorId: m.uptimeMonitorId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ===========================================================================
// incident.*
// ===========================================================================

describe("uptimeMonitor.incident.list", () => {
	it("lists incidents for an owned monitor", async () => {
		const m = await createTestMonitor(owner.id);
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: m.uptimeMonitorId,
			status: "ongoing",
			startedAt: new Date().toISOString(),
		});
		const incidents = await ownerCaller().uptimeMonitor.incident.list({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		expect(incidents).toHaveLength(1);
	});

	it("throws NOT_FOUND for another user's monitor (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.incident.list({
				uptimeMonitorId: m.uptimeMonitorId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("uptimeMonitor.incident.one", () => {
	it("returns an owned incident", async () => {
		const m = await createTestMonitor(owner.id);
		const [inc] = await db
			.insert(uptimeIncident)
			.values({
				uptimeMonitorId: m.uptimeMonitorId,
				status: "ongoing",
				startedAt: new Date().toISOString(),
			})
			.returning();
		const got = await ownerCaller().uptimeMonitor.incident.one({
			incidentId: inc!.incidentId,
		});
		expect(got.incidentId).toBe(inc!.incidentId);
	});

	it("throws NOT_FOUND for a missing incident", async () => {
		await expect(
			ownerCaller().uptimeMonitor.incident.one({ incidentId: "nope" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "incident not found",
		});
	});

	it("throws NOT_FOUND when the incident belongs to another user's monitor (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		const [inc] = await db
			.insert(uptimeIncident)
			.values({
				uptimeMonitorId: m.uptimeMonitorId,
				status: "ongoing",
				startedAt: new Date().toISOString(),
			})
			.returning();
		await expect(
			attackerCaller().uptimeMonitor.incident.one({
				incidentId: inc!.incidentId,
			}),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "incident not found",
		});
	});
});

describe("uptimeMonitor.incident.search", () => {
	async function seedIncident(
		uptimeMonitorId: string,
		overrides: Partial<typeof uptimeIncident.$inferInsert> = {},
	) {
		const [inc] = await db
			.insert(uptimeIncident)
			.values({
				uptimeMonitorId,
				status: "ongoing",
				startedAt: new Date().toISOString(),
				...overrides,
			})
			.returning();
		return inc!;
	}

	it("matches incidents by monitor name", async () => {
		const m = await createTestMonitor(owner.id, { name: "Prod API" });
		await seedIncident(m.uptimeMonitorId, { cause: "boom" });
		const results = await ownerCaller().uptimeMonitor.incident.search({
			query: "prod",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.monitorName).toBe("Prod API");
	});

	it("matches incidents by monitor url", async () => {
		const m = await createTestMonitor(owner.id, {
			name: "Site",
			url: "https://checkout.example.com",
		});
		await seedIncident(m.uptimeMonitorId);
		const results = await ownerCaller().uptimeMonitor.incident.search({
			query: "checkout",
		});
		expect(results).toHaveLength(1);
	});

	it("matches incidents by cause", async () => {
		const m = await createTestMonitor(owner.id, { name: "Site" });
		await seedIncident(m.uptimeMonitorId, { cause: "Connection timeout" });
		const results = await ownerCaller().uptimeMonitor.incident.search({
			query: "timeout",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.cause).toBe("Connection timeout");
	});

	it("treats LIKE wildcards in the query literally", async () => {
		const m = await createTestMonitor(owner.id, { name: "Site" });
		await seedIncident(m.uptimeMonitorId, { cause: "ok" });
		const results = await ownerCaller().uptimeMonitor.incident.search({
			query: "%",
		});
		expect(results).toHaveLength(0);
	});

	it("respects the result limit", async () => {
		const m = await createTestMonitor(owner.id, { name: "Prod" });
		await seedIncident(m.uptimeMonitorId, {
			status: "resolved",
			resolvedAt: new Date().toISOString(),
			durationSeconds: 0,
		});
		await seedIncident(m.uptimeMonitorId);
		expect(await ownerCaller().uptimeMonitor.incident.search({ query: "prod" })).toHaveLength(2);
		const results = await ownerCaller().uptimeMonitor.incident.search({
			query: "prod",
			limit: 1,
		});
		expect(results).toHaveLength(1);
	});

	it("excludes another user's incidents (IDOR)", async () => {
		const m = await createTestMonitor(owner.id, { name: "Prod API" });
		await seedIncident(m.uptimeMonitorId, { cause: "boom" });
		const results = await attackerCaller().uptimeMonitor.incident.search({
			query: "prod",
		});
		expect(results).toHaveLength(0);
	});
});

// ===========================================================================
// emailProvider.*
// ===========================================================================

describe("uptimeMonitor.emailProvider", () => {
	const resendInput = {
		name: "Resend",
		providerType: "resend" as const,
		apiKey: "re_test_key",
		fromAddress: "alerts@pulsy.test",
		smtpSecure: true,
	};

	it("create + list returns a masked provider for the owner", async () => {
		const created =
			await ownerCaller().uptimeMonitor.emailProvider.create(resendInput);
		expect(created.emailProviderId).toBeTruthy();
		const list = await ownerCaller().uptimeMonitor.emailProvider.list();
		expect(list).toHaveLength(1);
		expect(list[0]?.emailProviderId).toBe(created.emailProviderId);
	});

	it("update modifies fields for the owner", async () => {
		const created =
			await ownerCaller().uptimeMonitor.emailProvider.create(resendInput);
		const updated = await ownerCaller().uptimeMonitor.emailProvider.update({
			emailProviderId: created.emailProviderId,
			name: "Renamed Provider",
		});
		expect(updated.name).toBe("Renamed Provider");
	});

	it("delete removes the provider", async () => {
		const created =
			await ownerCaller().uptimeMonitor.emailProvider.create(resendInput);
		const res = await ownerCaller().uptimeMonitor.emailProvider.delete({
			emailProviderId: created.emailProviderId,
		});
		expect(res).toEqual({ success: true });
		const list = await ownerCaller().uptimeMonitor.emailProvider.list();
		expect(list).toHaveLength(0);
	});

	it("update throws for another user's provider (IDOR)", async () => {
		const created =
			await ownerCaller().uptimeMonitor.emailProvider.create(resendInput);
		await expect(
			attackerCaller().uptimeMonitor.emailProvider.update({
				emailProviderId: created.emailProviderId,
				name: "Hijack",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("delete throws for another user's provider (IDOR)", async () => {
		const created =
			await ownerCaller().uptimeMonitor.emailProvider.create(resendInput);
		await expect(
			attackerCaller().uptimeMonitor.emailProvider.delete({
				emailProviderId: created.emailProviderId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("test succeeds when the provider API returns 200", async () => {
		fetchMock = mockFetch(() => new Response("ok", { status: 200 }));
		const created =
			await ownerCaller().uptimeMonitor.emailProvider.create(resendInput);
		const res = await ownerCaller().uptimeMonitor.emailProvider.test({
			emailProviderId: created.emailProviderId,
			testEmail: "dest@pulsy.test",
		});
		expect(res.success).toBe(true);
		// Provider should now be marked verified.
		const list = await ownerCaller().uptimeMonitor.emailProvider.list();
		expect(list[0]?.verified).toBe(true);
	});

	it("test fails (BAD_REQUEST) when the provider API errors", async () => {
		fetchMock = mockFetch(() => new Response("nope", { status: 500 }));
		const created =
			await ownerCaller().uptimeMonitor.emailProvider.create(resendInput);
		await expect(
			ownerCaller().uptimeMonitor.emailProvider.test({
				emailProviderId: created.emailProviderId,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("test throws for another user's provider (IDOR)", async () => {
		const created =
			await ownerCaller().uptimeMonitor.emailProvider.create(resendInput);
		await expect(
			attackerCaller().uptimeMonitor.emailProvider.test({
				emailProviderId: created.emailProviderId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects an SMTP provider missing required fields", async () => {
		await expect(
			ownerCaller().uptimeMonitor.emailProvider.create({
				name: "SMTP",
				providerType: "smtp",
				fromAddress: "alerts@pulsy.test",
				smtpSecure: true,
			}),
		).rejects.toThrow();
	});
});

// ===========================================================================
// channel.*
// ===========================================================================

describe("uptimeMonitor.channel", () => {
	it("lists channels for an owned monitor", async () => {
		const m = await createTestMonitor(owner.id);
		await createTestChannel(m.uptimeMonitorId, {
			channelType: "webhook",
			webhookHeaders: { Authorization: "Bearer list-secret" },
		});
		const channels = await ownerCaller().uptimeMonitor.channel.list({
			uptimeMonitorId: m.uptimeMonitorId,
		});
		expect(channels).toHaveLength(1);
		expect(channels[0]).toMatchObject({
			hasWebhookUrl: true,
			hasWebhookHeaders: true,
			webhookHeaderNames: ["Authorization"],
		});
		expect(channels[0]).not.toHaveProperty("webhookUrl");
		expect(channels[0]).not.toHaveProperty("webhookHeaders");
		expect(channels[0]).not.toHaveProperty("secretVersion");
	});

	it("list throws NOT_FOUND for another user's monitor (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.channel.list({
				uptimeMonitorId: m.uptimeMonitorId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("creates a webhook channel", async () => {
		const m = await createTestMonitor(owner.id);
		const target = "https://hooks.example.com/in/private-token";
		const headers = {
			Authorization: "Bearer private-header-token",
			"X-Empty": "",
		};
		const created = await ownerCaller().uptimeMonitor.channel.create({
			uptimeMonitorId: m.uptimeMonitorId,
			channelType: "webhook",
			webhookUrl: target,
			webhookHeaders: headers,
			notifyOnDown: true,
			notifyOnRecovery: true,
			notifyOnTlsExpiry: false,
			tlsExpiryThresholdDays: 14,
		});
		expect(created.channelType).toBe("webhook");
		expect(created).toMatchObject({
			hasWebhookUrl: true,
			webhookUrlMasked: "https://hooks.example.com/••••••••",
			hasWebhookHeaders: true,
			webhookHeaderNames: ["Authorization", "X-Empty"],
		});
		expect(created).not.toHaveProperty("webhookUrl");
		expect(created).not.toHaveProperty("webhookHeaders");
		expect(created).not.toHaveProperty("secretVersion");

		const stored = await db.query.uptimeNotificationChannel.findFirst({
			where: eq(uptimeNotificationChannel.channelId, created.channelId),
		});
		expect(stored?.secretVersion).toBe(1);
		expect(stored?.webhookUrl).not.toBe(target);
		expect(stored?.webhookHeaders?.Authorization).not.toBe(
			headers.Authorization,
		);
		expect(
			stored && decryptNotificationChannelSecrets(stored),
		).toMatchObject({ webhookUrl: target, webhookHeaders: headers });
	});

	it("create throws NOT_FOUND for another user's monitor (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.channel.create({
				uptimeMonitorId: m.uptimeMonitorId,
				channelType: "webhook",
				webhookUrl: "https://hooks.example.com/in",
				notifyOnDown: true,
				notifyOnRecovery: true,
				notifyOnTlsExpiry: false,
				tlsExpiryThresholdDays: 14,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects an email channel without a recipient (config guard)", async () => {
		const m = await createTestMonitor(owner.id);
		const provider = await createTestEmailProvider(owner.id);
		// Bypass the Zod superRefine by omitting recipients but supplying provider —
		// the router-level assertNotificationChannelConfig must still reject it.
		await expect(
			ownerCaller().uptimeMonitor.channel.create({
				uptimeMonitorId: m.uptimeMonitorId,
				channelType: "email",
				emailProviderId: provider.emailProviderId,
				recipientAddresses: [],
				notifyOnDown: true,
				notifyOnRecovery: true,
				notifyOnTlsExpiry: false,
				tlsExpiryThresholdDays: 14,
			}),
		).rejects.toThrow();
	});

	it("creates an email channel and validates provider ownership", async () => {
		const m = await createTestMonitor(owner.id);
		const provider = await createTestEmailProvider(owner.id);
		const created = await ownerCaller().uptimeMonitor.channel.create({
			uptimeMonitorId: m.uptimeMonitorId,
			channelType: "email",
			emailProviderId: provider.emailProviderId,
			recipientAddresses: ["to@pulsy.test"],
			// Stale client state must never leave unrelated webhook secrets on an
			// email channel.
			webhookUrl: "https://hooks.example.com/stale-secret",
			webhookHeaders: { Authorization: "Bearer stale-secret" },
			notifyOnDown: true,
			notifyOnRecovery: true,
			notifyOnTlsExpiry: false,
			tlsExpiryThresholdDays: 14,
		});
		expect(created.channelType).toBe("email");
		expect(created.hasWebhookUrl).toBe(false);
		expect(created.hasWebhookHeaders).toBe(false);
		const stored = await db.query.uptimeNotificationChannel.findFirst({
			where: eq(uptimeNotificationChannel.channelId, created.channelId),
		});
		expect(stored).toMatchObject({
			webhookUrl: null,
			webhookHeaders: null,
			secretVersion: 1,
		});
	});

	it("rejects an email channel referencing another user's provider (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		const foreignProvider = await createTestEmailProvider(attacker.id);
		await expect(
			ownerCaller().uptimeMonitor.channel.create({
				uptimeMonitorId: m.uptimeMonitorId,
				channelType: "email",
				emailProviderId: foreignProvider.emailProviderId,
				recipientAddresses: ["to@pulsy.test"],
				notifyOnDown: true,
				notifyOnRecovery: true,
				notifyOnTlsExpiry: false,
				tlsExpiryThresholdDays: 14,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("updates a channel for the owner", async () => {
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "webhook",
			webhookUrl: "https://old.example.com/in",
		});
		const updated = await ownerCaller().uptimeMonitor.channel.update({
			channelId: channel.channelId,
			webhookUrl: "https://new.example.com/in",
		});
		expect(updated.webhookUrlMasked).toBe(
			"https://new.example.com/••••••••",
		);
		expect(updated).not.toHaveProperty("webhookUrl");
		const stored = await db.query.uptimeNotificationChannel.findFirst({
			where: eq(uptimeNotificationChannel.channelId, channel.channelId),
		});
		expect(stored?.secretVersion).toBe(1);
		expect(
			stored && decryptNotificationChannelSecrets(stored).webhookUrl,
		).toBe("https://new.example.com/in");
	});

	it("update throws NOT_FOUND for another user's channel (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId);
		await expect(
			attackerCaller().uptimeMonitor.channel.update({
				channelId: channel.channelId,
				webhookUrl: "https://evil.example.com/in",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("update throws NOT_FOUND for a missing channel", async () => {
		await expect(
			ownerCaller().uptimeMonitor.channel.update({
				channelId: "missing",
				webhookUrl: "https://x.example.com/in",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("deletes a channel for the owner", async () => {
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId);
		const res = await ownerCaller().uptimeMonitor.channel.delete({
			channelId: channel.channelId,
		});
		expect(res).toEqual({ success: true });
		const rows = await db
			.select()
			.from(uptimeNotificationChannel)
			.where(eq(uptimeNotificationChannel.channelId, channel.channelId));
		expect(rows).toHaveLength(0);
	});

	it("delete throws NOT_FOUND for another user's channel (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId);
		await expect(
			attackerCaller().uptimeMonitor.channel.delete({
				channelId: channel.channelId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("test sends a webhook notification when fetch succeeds", async () => {
		fetchMock = mockFetch(() => new Response("ok", { status: 200 }));
		const m = await createTestMonitor(owner.id);
		const channel = await ownerCaller().uptimeMonitor.channel.create({
			uptimeMonitorId: m.uptimeMonitorId,
			channelType: "webhook",
			webhookUrl: "https://hooks.example.com/in",
			webhookHeaders: { Authorization: "Bearer dispatch-secret" },
		});
		const res = await ownerCaller().uptimeMonitor.channel.test({
			channelId: channel.channelId,
		});
		expect(res.success).toBe(true);
		expect(fetchMock.calls).toHaveLength(1);
		expect(fetchMock.calls[0]?.url).toBe("https://hooks.example.com/in");
		expect(fetchMock.calls[0]?.headers.Authorization).toBe(
			"Bearer dispatch-secret",
		);
	});

	it("test reports BAD_REQUEST when the webhook fails", async () => {
		fetchMock = mockFetch(() => new Response("err", { status: 500 }));
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "webhook",
			webhookUrl: "https://hooks.example.com/in",
		});
		await expect(
			ownerCaller().uptimeMonitor.channel.test({
				channelId: channel.channelId,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("test sends a slack notification", async () => {
		fetchMock = mockFetch(() => new Response("ok", { status: 200 }));
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "slack",
			webhookUrl: "https://hooks.slack.com/services/T/B/token",
		});
		const res = await ownerCaller().uptimeMonitor.channel.test({
			channelId: channel.channelId,
		});
		expect(res.success).toBe(true);
	});

	it("test sends a discord notification", async () => {
		fetchMock = mockFetch(() => new Response("ok", { status: 200 }));
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "discord",
			webhookUrl: "https://discord.com/api/webhooks/123/token",
		});
		const res = await ownerCaller().uptimeMonitor.channel.test({
			channelId: channel.channelId,
		});
		expect(res.success).toBe(true);
	});

	it("test sends a telegram notification", async () => {
		fetchMock = mockFetch(() => new Response("ok", { status: 200 }));
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "telegram",
			webhookUrl: "123456:abcdef:-100999",
		});
		const res = await ownerCaller().uptimeMonitor.channel.test({
			channelId: channel.channelId,
		});
		expect(res.success).toBe(true);
	});

	it("test sends a test email through a verified provider", async () => {
		// The email branch dispatches a test message via the provider, which for
		// Resend/SendGrid issues one outbound HTTP request.
		fetchMock = mockFetch(() => new Response("ok", { status: 200 }));
		const m = await createTestMonitor(owner.id);
		const provider = await createTestEmailProvider(owner.id, {
			verified: true,
		});
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "email",
			emailProviderId: provider.emailProviderId,
			recipientAddresses: ["to@pulsy.test"],
			webhookUrl: null,
		});
		const res = await ownerCaller().uptimeMonitor.channel.test({
			channelId: channel.channelId,
		});
		expect(res.success).toBe(true);
		expect(res.message).toMatch(/notification sent/i);
		expect(fetchMock.calls).toHaveLength(1);
	});

	it("test escapes a malicious monitor name/url in the email body (no HTML injection)", async () => {
		// A monitor name/url can carry attacker-controlled markup — most
		// dangerously when the monitor was cloned from a share link authored by
		// another user. The test email body MUST escape it so it never renders as
		// live HTML in the recipient's mail client.
		fetchMock = mockFetch(() => new Response("ok", { status: 200 }));
		const m = await createTestMonitor(owner.id, {
			name: '<img src=x onerror="alert(1)">',
			url: "https://evil.example.com/<script>steal()</script>",
		});
		const provider = await createTestEmailProvider(owner.id, {
			verified: true,
		});
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "email",
			emailProviderId: provider.emailProviderId,
			recipientAddresses: ["to@pulsy.test"],
			webhookUrl: null,
		});

		await ownerCaller().uptimeMonitor.channel.test({
			channelId: channel.channelId,
		});

		const body = fetchMock.calls[0]?.body ?? "";
		const { html } = JSON.parse(body) as { html: string };
		// The raw tags must not survive into the rendered email.
		expect(html).not.toContain("<img src=x");
		expect(html).not.toContain("<script>");
		// They survive only in escaped form.
		expect(html).toContain("&lt;img src=x");
		expect(html).toContain("&lt;script&gt;");
	});

	it("test reports BAD_REQUEST for an email channel with an unverified provider", async () => {
		const m = await createTestMonitor(owner.id);
		const provider = await createTestEmailProvider(owner.id, {
			verified: false,
		});
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "email",
			emailProviderId: provider.emailProviderId,
			recipientAddresses: ["to@pulsy.test"],
			webhookUrl: null,
		});
		await expect(
			ownerCaller().uptimeMonitor.channel.test({
				channelId: channel.channelId,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("test reports BAD_REQUEST for an email channel missing provider/recipients", async () => {
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "email",
			emailProviderId: null,
			recipientAddresses: null,
			webhookUrl: null,
		});
		await expect(
			ownerCaller().uptimeMonitor.channel.test({
				channelId: channel.channelId,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("test throws NOT_FOUND for another user's channel (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId);
		await expect(
			attackerCaller().uptimeMonitor.channel.test({
				channelId: channel.channelId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	// -------------------------------------------------------------------------
	// channel.update re-validates the MERGED channel via
	// assertNotificationChannelConfig. Unlike create, the update Zod schema has
	// no superRefine, so these router-level guards are the only line of defence
	// and are reachable with config that the merged row makes invalid.
	// -------------------------------------------------------------------------

	it("update rejects clearing an email channel's recipients (config guard)", async () => {
		const m = await createTestMonitor(owner.id);
		const provider = await createTestEmailProvider(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "email",
			emailProviderId: provider.emailProviderId,
			recipientAddresses: ["to@pulsy.test"],
			webhookUrl: null,
		});
		await expect(
			ownerCaller().uptimeMonitor.channel.update({
				channelId: channel.channelId,
				recipientAddresses: [],
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("update rejects clearing an email channel's provider (config guard)", async () => {
		const m = await createTestMonitor(owner.id);
		const provider = await createTestEmailProvider(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "email",
			emailProviderId: provider.emailProviderId,
			recipientAddresses: ["to@pulsy.test"],
			webhookUrl: null,
		});
		await expect(
			ownerCaller().uptimeMonitor.channel.update({
				channelId: channel.channelId,
				emailProviderId: null,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("update rejects a webhook channel with an unparseable URL (config guard)", async () => {
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "webhook",
			webhookUrl: "https://ok.example.com/in",
		});
		await expect(
			ownerCaller().uptimeMonitor.channel.update({
				channelId: channel.channelId,
				// Passes the Zod min(1) check but fails `new URL()` parsing,
				// exercising isValidHttpUrl's catch arm.
				webhookUrl: "not-a-valid-url",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("update rejects clearing a webhook channel's URL (config guard)", async () => {
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "webhook",
			webhookUrl: "https://ok.example.com/in",
		});
		await expect(
			ownerCaller().uptimeMonitor.channel.update({
				channelId: channel.channelId,
				webhookUrl: null,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("update accepts a BOT_TOKEN:CHAT_ID telegram target", async () => {
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "telegram",
			webhookUrl: "111:aaa:222",
		});
		const updated = await ownerCaller().uptimeMonitor.channel.update({
			channelId: channel.channelId,
			webhookUrl: "333:bbb:444",
		});
		expect(updated.webhookUrlMasked).toBe("Telegram ••••••••");
		expect(updated).not.toHaveProperty("webhookUrl");
	});

	it("update accepts a full Telegram API URL target", async () => {
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "telegram",
			webhookUrl: "111:aaa:222",
		});
		const updated = await ownerCaller().uptimeMonitor.channel.update({
			channelId: channel.channelId,
			webhookUrl: "https://api.telegram.org/bot999:zzz/sendMessage",
		});
		expect(updated.webhookUrlMasked).toBe("Telegram ••••••••");
		expect(updated).not.toHaveProperty("webhookUrl");
	});

	it("update rejects a telegram channel with an invalid target (config guard)", async () => {
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "telegram",
			webhookUrl: "111:aaa:222",
		});
		await expect(
			ownerCaller().uptimeMonitor.channel.update({
				channelId: channel.channelId,
				// Only two colon-parts → fails isValidTelegramTarget.
				webhookUrl: "onlytwo:parts",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("update rejects clearing a telegram channel's target (config guard)", async () => {
		const m = await createTestMonitor(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "telegram",
			webhookUrl: "111:aaa:222",
		});
		await expect(
			ownerCaller().uptimeMonitor.channel.update({
				channelId: channel.channelId,
				webhookUrl: null,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("update validates a newly-referenced email provider's ownership (IDOR)", async () => {
		const m = await createTestMonitor(owner.id);
		const foreignProvider = await createTestEmailProvider(attacker.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "webhook",
			webhookUrl: "https://ok.example.com/in",
			webhookHeaders: { Authorization: "Bearer old-secret" },
		});
		await expect(
			ownerCaller().uptimeMonitor.channel.update({
				channelId: channel.channelId,
				channelType: "email",
				emailProviderId: foreignProvider.emailProviderId,
				recipientAddresses: ["to@pulsy.test"],
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("update attaches an owned email provider to a channel", async () => {
		const m = await createTestMonitor(owner.id);
		const provider = await createTestEmailProvider(owner.id);
		const channel = await createTestChannel(m.uptimeMonitorId, {
			channelType: "webhook",
			webhookUrl: "https://ok.example.com/in",
		});
		const updated = await ownerCaller().uptimeMonitor.channel.update({
			channelId: channel.channelId,
			channelType: "email",
			emailProviderId: provider.emailProviderId,
			recipientAddresses: ["to@pulsy.test"],
		});
		expect(updated.emailProviderId).toBe(provider.emailProviderId);
		expect(updated.hasWebhookUrl).toBe(false);
		expect(updated.hasWebhookHeaders).toBe(false);
		const stored = await db.query.uptimeNotificationChannel.findFirst({
			where: eq(uptimeNotificationChannel.channelId, channel.channelId),
		});
		expect(stored).toMatchObject({
			webhookUrl: null,
			webhookHeaders: null,
			secretVersion: 1,
		});
	});
});

// ===========================================================================
// channel.* — account-level default channels (uptimeMonitorId IS NULL)
// ===========================================================================

describe("uptimeMonitor.channel defaults", () => {
	it("listDefaults returns only the caller's default channels", async () => {
		const m = await createTestMonitor(owner.id);
		await createTestChannel(m.uptimeMonitorId); // monitor channel — excluded
		const mine = await createTestDefaultChannel(owner.id);
		await createTestDefaultChannel(attacker.id); // other user — excluded

		const defaults = await ownerCaller().uptimeMonitor.channel.listDefaults();
		expect(defaults).toHaveLength(1);
		expect(defaults[0]?.channelId).toBe(mine.channelId);
		expect(defaults[0]?.uptimeMonitorId).toBeNull();
		expect(defaults[0]?.hasWebhookUrl).toBe(true);
		expect(defaults[0]).not.toHaveProperty("webhookUrl");
		expect(defaults[0]).not.toHaveProperty("webhookHeaders");
		expect(defaults[0]).not.toHaveProperty("secretVersion");
	});

	it("createDefault creates a webhook default scoped to the caller", async () => {
		const created = await ownerCaller().uptimeMonitor.channel.createDefault({
			channelType: "webhook",
			webhookUrl: "https://hooks.example.com/default",
			notifyOnDown: true,
			notifyOnRecovery: true,
			notifyOnTlsExpiry: false,
			tlsExpiryThresholdDays: 14,
		});
		expect(created.uptimeMonitorId).toBeNull();
		expect(created.userId).toBe(owner.id);
		expect(created.hasWebhookUrl).toBe(true);
		expect(created).not.toHaveProperty("webhookUrl");
		expect(created).not.toHaveProperty("webhookHeaders");
		expect(created).not.toHaveProperty("secretVersion");
	});

	it("createDefault creates an email default with an owned provider", async () => {
		const provider = await createTestEmailProvider(owner.id);
		const created = await ownerCaller().uptimeMonitor.channel.createDefault({
			channelType: "email",
			emailProviderId: provider.emailProviderId,
			recipientAddresses: ["to@pulsy.test"],
			notifyOnDown: true,
			notifyOnRecovery: true,
			notifyOnTlsExpiry: false,
			tlsExpiryThresholdDays: 14,
		});
		expect(created.uptimeMonitorId).toBeNull();
		expect(created.emailProviderId).toBe(provider.emailProviderId);
	});

	it("createDefault rejects an email default without a recipient (config guard)", async () => {
		const provider = await createTestEmailProvider(owner.id);
		await expect(
			ownerCaller().uptimeMonitor.channel.createDefault({
				channelType: "email",
				emailProviderId: provider.emailProviderId,
				recipientAddresses: [],
				notifyOnDown: true,
				notifyOnRecovery: true,
				notifyOnTlsExpiry: false,
				tlsExpiryThresholdDays: 14,
			}),
		).rejects.toThrow();
	});

	it("createDefault rejects another user's email provider (IDOR)", async () => {
		const foreignProvider = await createTestEmailProvider(attacker.id);
		await expect(
			ownerCaller().uptimeMonitor.channel.createDefault({
				channelType: "email",
				emailProviderId: foreignProvider.emailProviderId,
				recipientAddresses: ["to@pulsy.test"],
				notifyOnDown: true,
				notifyOnRecovery: true,
				notifyOnTlsExpiry: false,
				tlsExpiryThresholdDays: 14,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("updates a default channel for the owner", async () => {
		const channel = await createTestDefaultChannel(owner.id, {
			channelType: "webhook",
			webhookUrl: "https://old.example.com/in",
		});
		const updated = await ownerCaller().uptimeMonitor.channel.update({
			channelId: channel.channelId,
			webhookUrl: "https://new.example.com/in",
		});
		expect(updated.webhookUrlMasked).toBe(
			"https://new.example.com/••••••••",
		);
		expect(updated).not.toHaveProperty("webhookUrl");
		expect(updated.uptimeMonitorId).toBeNull();
	});

	it("update throws NOT_FOUND for another user's default channel (IDOR)", async () => {
		const channel = await createTestDefaultChannel(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.channel.update({
				channelId: channel.channelId,
				webhookUrl: "https://evil.example.com/in",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("deletes a default channel for the owner", async () => {
		const channel = await createTestDefaultChannel(owner.id);
		const res = await ownerCaller().uptimeMonitor.channel.delete({
			channelId: channel.channelId,
		});
		expect(res).toEqual({ success: true });
		const rows = await db
			.select()
			.from(uptimeNotificationChannel)
			.where(eq(uptimeNotificationChannel.channelId, channel.channelId));
		expect(rows).toHaveLength(0);
	});

	it("delete throws NOT_FOUND for another user's default channel (IDOR)", async () => {
		const channel = await createTestDefaultChannel(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.channel.delete({
				channelId: channel.channelId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("test sends through a default webhook channel using a synthetic monitor", async () => {
		fetchMock = mockFetch(() => new Response("ok", { status: 200 }));
		const channel = await createTestDefaultChannel(owner.id, {
			channelType: "webhook",
			webhookUrl: "https://hooks.example.com/default",
		});
		const res = await ownerCaller().uptimeMonitor.channel.test({
			channelId: channel.channelId,
		});
		expect(res.success).toBe(true);
		expect(fetchMock.calls).toHaveLength(1);
		// The synthetic monitor payload is what gets posted.
		expect(fetchMock.calls[0]?.body).toContain("Example monitor");
	});

	it("test sends a default email channel through a verified provider", async () => {
		fetchMock = mockFetch(() => new Response("ok", { status: 200 }));
		const provider = await createTestEmailProvider(owner.id, {
			verified: true,
		});
		const channel = await createTestDefaultChannel(owner.id, {
			channelType: "email",
			emailProviderId: provider.emailProviderId,
			recipientAddresses: ["to@pulsy.test"],
			webhookUrl: null,
		});
		const res = await ownerCaller().uptimeMonitor.channel.test({
			channelId: channel.channelId,
		});
		expect(res.success).toBe(true);
		expect(fetchMock.calls).toHaveLength(1);
	});

	it("test throws NOT_FOUND for another user's default channel (IDOR)", async () => {
		const channel = await createTestDefaultChannel(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.channel.test({
				channelId: channel.channelId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ===========================================================================
// dashboard.*
// ===========================================================================

describe("uptimeMonitor.dashboard.summary", () => {
	it("tallies statuses, uptime, response time, and ongoing incidents", async () => {
		const up = await createTestMonitor(owner.id, {
			status: "up",
			active: true,
			uptimePercentage: 99,
			responseTime: 100,
		});
		const down = await createTestMonitor(owner.id, {
			status: "down",
			active: true,
			uptimePercentage: 50,
			responseTime: 300,
		});
		await createTestMonitor(owner.id, { status: "degraded", active: false });
		await createTestMonitor(owner.id, { status: "pending", active: true });
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: down.uptimeMonitorId,
			status: "ongoing",
			startedAt: new Date().toISOString(),
		});

		await db.insert(uptimeCheckLog).values([up, down].flatMap((monitor, index) => Array.from({ length: 100 }, (_, i) => ({ uptimeMonitorId: monitor.uptimeMonitorId, status: i < (index === 0 ? 99 : 50) ? "up" as const : "down" as const, createdAt: new Date().toISOString() }))));
		const summary = await ownerCaller().uptimeMonitor.dashboard.summary();
		expect(summary.totalMonitors).toBe(4);
		expect(summary.activeMonitors).toBe(3);
		expect(summary.monitorsUp).toBe(1);
		expect(summary.monitorsDown).toBe(1);
		expect(summary.monitorsDegraded).toBe(0);
		expect(summary.monitorsPaused).toBe(1);
		expect(summary.monitorsUp + summary.monitorsDown + summary.monitorsDegraded + summary.monitorsPending + summary.monitorsPaused).toBe(summary.totalMonitors);
		expect(summary.monitorsPending).toBe(1);
		expect(summary.ongoingIncidents).toBe(1);
		expect(summary.avgUptimePercentage).toBe(74.5);
		expect(summary.avgResponseTime).toBe(200);
	});

	it("returns null averages and zero incidents when there are no monitors", async () => {
		const summary = await ownerCaller().uptimeMonitor.dashboard.summary();
		expect(summary.totalMonitors).toBe(0);
		expect(summary.ongoingIncidents).toBe(0);
		expect(summary.avgUptimePercentage).toBeNull();
		expect(summary.avgResponseTime).toBeNull();
	});

	it("requires authentication", async () => {
		await expect(
			publicCaller().uptimeMonitor.dashboard.summary(),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

// ===========================================================================
// public.* (no auth)
// ===========================================================================

describe("uptimeMonitor.public.status", () => {
  it("returns unknown status for an explicitly published empty default page", async () => {
    await createTestStatusPage(owner.id, { slug: "default", isPublished: true });
    const res = await publicCaller().uptimeMonitor.public.status({ userId: owner.id });
    expect(res.overallStatus).toBe("unknown");
    expect(res.monitors).toHaveLength(0);
    expect(res.recentIncidents).toHaveLength(0);
  });

	it("exposes the default page's monitors and recent incidents without leaking URLs", async () => {
		const page = await createTestStatusPage(owner.id, { slug: "default" });
		const upMon = await createTestMonitor(owner.id, {
			name: "Public Up",
			status: "up",
			active: true,
			uptimePercentage: 100,
			responseTime: 80,
		});
		const downMon = await createTestMonitor(owner.id, {
			name: "Public Down",
			status: "down",
			active: true,
		});
		// A monitor NOT linked to the page must NOT be exposed.
		await createTestMonitor(owner.id, { name: "Unlisted", status: "up" });
		await createTestStatusPageMonitor(page.statusPageId, upMon.uptimeMonitorId);
		await createTestStatusPageMonitor(page.statusPageId, downMon.uptimeMonitorId);
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: downMon.uptimeMonitorId,
			status: "ongoing",
			startedAt: new Date().toISOString(),
		});

		const res = await publicCaller().uptimeMonitor.public.status({
			userId: owner.id,
		});
		expect(res.monitors).toHaveLength(2);
		expect(res.overallStatus).toBe("partial");
		expect(res.recentIncidents).toHaveLength(1);
		expect(res.recentIncidents[0]?.monitorName).toBe("Public Down");
		// No sensitive fields leak.
		for (const m of res.monitors) {
			expect(m).not.toHaveProperty("url");
		}
	});

	it("reports degraded overall status when a default-page monitor is degraded", async () => {
		const page = await createTestStatusPage(owner.id, { slug: "default" });
		const mon = await createTestMonitor(owner.id, {
			name: "Degraded",
			status: "degraded",
			active: true,
		});
		await createTestStatusPageMonitor(page.statusPageId, mon.uptimeMonitorId);
		const res = await publicCaller().uptimeMonitor.public.status({
			userId: owner.id,
		});
		expect(res.overallStatus).toBe("degraded");
	});
});

describe("uptimeMonitor.statusPage.domainStatus", () => {
	it("returns ownership, resolved routing IPs, and provisioning state", async () => {
		resolve4Mock.mockResolvedValue(["203.0.113.9"]);
		const page = await createTestStatusPage(owner.id, {
			slug: "ds-ok",
			customDomain: "status.example.com",
			domainVerified: true,
			domainProvisionStatus: "pending",
		});
		const res = await ownerCaller().uptimeMonitor.statusPage.domainStatus({
			statusPageId: page.statusPageId,
		});
		expect(res.customDomain).toBe("status.example.com");
		expect(res.ownershipVerified).toBe(true);
		expect(res.routing.resolvedIps).toEqual(["203.0.113.9"]);
		expect(res.provisionStatus).toBe("pending");
		expect(resolve4Mock).toHaveBeenCalledWith("status.example.com");
	});

	it("treats a DNS resolution failure as no resolved IPs", async () => {
		resolve4Mock.mockRejectedValue(new Error("ENOTFOUND"));
		const page = await createTestStatusPage(owner.id, {
			slug: "ds-fail",
			customDomain: "missing.example.com",
			domainVerified: true,
		});
		const res = await ownerCaller().uptimeMonitor.statusPage.domainStatus({
			statusPageId: page.statusPageId,
		});
		expect(res.routing.resolvedIps).toEqual([]);
		expect(res.routing.ok).toBe(false);
	});

	it("rejects a non-owner", async () => {
		resolve4Mock.mockResolvedValue([]);
		const page = await createTestStatusPage(owner.id, {
			slug: "ds-auth",
			customDomain: "owned.example.com",
			domainVerified: true,
		});
		await expect(
			attackerCaller().uptimeMonitor.statusPage.domainStatus({
				statusPageId: page.statusPageId,
			}),
		).rejects.toThrow();
	});
});
