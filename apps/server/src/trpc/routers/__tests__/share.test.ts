import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, uptimeMonitor, uptimeShareLink } from "@pulsy/db";
import { eq } from "drizzle-orm";
import {
	createTestMonitor,
	createTestShareLink,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";

// ---------------------------------------------------------------------------
// Share-link procedures: share.create/list/revoke/clone + public.sharedLink.
// Mock ONLY the scheduler side-effects (same approach as uptime.test.ts) so
// cloning never touches real node-schedule timers; everything else runs
// against the real DB so ownership/expiry/sanitization branches are honestly
// exercised.
// ---------------------------------------------------------------------------

const { scheduleMonitorCheck } = vi.hoisted(() => ({
	scheduleMonitorCheck: vi.fn(),
}));

vi.mock("../../../services/uptime", async (importActual) => {
	const actual =
		await importActual<typeof import("../../../services/uptime")>();
	return {
		...actual,
		scheduleMonitorCheck: (...a: unknown[]) => scheduleMonitorCheck(...a),
	};
});

useCleanDatabase();

let owner: Awaited<ReturnType<typeof createTestUser>>;
let recipient: Awaited<ReturnType<typeof createTestUser>>;

beforeEach(async () => {
	owner = await createTestUser({ email: "owner@pulsy.test" });
	recipient = await createTestUser({ email: "recipient@pulsy.test" });
	scheduleMonitorCheck.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

function ownerCaller() {
	return authedCaller({ id: owner.id, email: owner.email });
}
function recipientCaller() {
	return authedCaller({ id: recipient.id, email: recipient.email });
}

const PAST_ISO = new Date(Date.now() - 60_000).toISOString();

// ===========================================================================
// share.create
// ===========================================================================

describe("share.create", () => {
	it("creates a link with a high-entropy token and the default 30-day expiry", async () => {
		const monitor = await createTestMonitor(owner.id);
		const before = Date.now();
		const link = await ownerCaller().uptimeMonitor.share.create({
			uptimeMonitorIds: [monitor.uptimeMonitorId],
		});

		expect(link.token.length).toBeGreaterThanOrEqual(32);
		expect(link.userId).toBe(owner.id);
		expect(link.monitorIds).toEqual([monitor.uptimeMonitorId]);

		const expiresMs = new Date(link.expiresAt).getTime();
		const thirtyDays = 30 * 24 * 60 * 60 * 1000;
		expect(expiresMs).toBeGreaterThanOrEqual(before + thirtyDays - 5_000);
		expect(expiresMs).toBeLessThanOrEqual(Date.now() + thirtyDays + 5_000);
	});

	it.each([7, 90] as const)("honors a %s-day expiry", async (days) => {
		const monitor = await createTestMonitor(owner.id);
		const link = await ownerCaller().uptimeMonitor.share.create({
			uptimeMonitorIds: [monitor.uptimeMonitorId],
			expiresInDays: days,
		});
		const expiresMs = new Date(link.expiresAt).getTime();
		const window = days * 24 * 60 * 60 * 1000;
		expect(expiresMs).toBeGreaterThanOrEqual(Date.now() + window - 60_000);
		expect(expiresMs).toBeLessThanOrEqual(Date.now() + window + 60_000);
	});

	it("dedupes repeated monitor ids", async () => {
		const monitor = await createTestMonitor(owner.id);
		const link = await ownerCaller().uptimeMonitor.share.create({
			uptimeMonitorIds: [monitor.uptimeMonitorId, monitor.uptimeMonitorId],
		});
		expect(link.monitorIds).toEqual([monitor.uptimeMonitorId]);
	});

	it("throws NOT_FOUND when any id belongs to another user (IDOR)", async () => {
		const ownMonitor = await createTestMonitor(owner.id);
		const foreignMonitor = await createTestMonitor(recipient.id);
		await expect(
			ownerCaller().uptimeMonitor.share.create({
				uptimeMonitorIds: [
					ownMonitor.uptimeMonitorId,
					foreignMonitor.uptimeMonitorId,
				],
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("throws NOT_FOUND for a missing monitor id", async () => {
		await expect(
			ownerCaller().uptimeMonitor.share.create({
				uptimeMonitorIds: ["missing"],
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects an empty id list and more than 50 ids", async () => {
		await expect(
			ownerCaller().uptimeMonitor.share.create({ uptimeMonitorIds: [] }),
		).rejects.toThrow();
		await expect(
			ownerCaller().uptimeMonitor.share.create({
				uptimeMonitorIds: Array.from({ length: 51 }, (_, i) => `m${i}`),
			}),
		).rejects.toThrow();
	});

	it("requires authentication", async () => {
		await expect(
			publicCaller().uptimeMonitor.share.create({
				uptimeMonitorIds: ["m1"],
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

// ===========================================================================
// share.list
// ===========================================================================

describe("share.list", () => {
	it("returns only the caller's links, newest first, with monitor names", async () => {
		const monitorA = await createTestMonitor(owner.id, { name: "A" });
		const monitorB = await createTestMonitor(owner.id, { name: "B" });
		const older = await createTestShareLink(
			owner.id,
			[monitorA.uptimeMonitorId],
			{ createdAt: new Date(Date.now() - 120_000).toISOString() },
		);
		const newer = await createTestShareLink(owner.id, [
			monitorA.uptimeMonitorId,
			monitorB.uptimeMonitorId,
		]);

		const foreignMonitor = await createTestMonitor(recipient.id);
		await createTestShareLink(recipient.id, [foreignMonitor.uptimeMonitorId]);

		const links = await ownerCaller().uptimeMonitor.share.list();
		expect(links).toHaveLength(2);
		expect(links[0]).toMatchObject({
			shareLinkId: newer.shareLinkId,
			token: newer.token,
			monitorCount: 2,
			monitorNames: ["A", "B"],
		});
		expect(links[1]).toMatchObject({
			shareLinkId: older.shareLinkId,
			monitorCount: 1,
			monitorNames: ["A"],
		});
	});

	it("omits names of monitors deleted after sharing but keeps the count", async () => {
		const kept = await createTestMonitor(owner.id, { name: "Kept" });
		const doomed = await createTestMonitor(owner.id, { name: "Doomed" });
		await createTestShareLink(owner.id, [
			kept.uptimeMonitorId,
			doomed.uptimeMonitorId,
		]);
		await db
			.delete(uptimeMonitor)
			.where(eq(uptimeMonitor.uptimeMonitorId, doomed.uptimeMonitorId));

		const links = await ownerCaller().uptimeMonitor.share.list();
		expect(links[0]).toMatchObject({
			monitorCount: 2,
			monitorNames: ["Kept"],
		});
	});

	it("returns an empty list when the user has no links", async () => {
		await expect(ownerCaller().uptimeMonitor.share.list()).resolves.toEqual(
			[],
		);
	});

	it("requires authentication", async () => {
		await expect(
			publicCaller().uptimeMonitor.share.list(),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

// ===========================================================================
// share.revoke
// ===========================================================================

describe("share.revoke", () => {
	it("deletes the caller's link", async () => {
		const monitor = await createTestMonitor(owner.id);
		const link = await createTestShareLink(owner.id, [
			monitor.uptimeMonitorId,
		]);

		const result = await ownerCaller().uptimeMonitor.share.revoke({
			shareLinkId: link.shareLinkId,
		});
		expect(result).toEqual({ success: true });

		const remaining = await db.query.uptimeShareLink.findFirst({
			where: eq(uptimeShareLink.shareLinkId, link.shareLinkId),
		});
		expect(remaining).toBeUndefined();
	});

	it("throws NOT_FOUND when revoking another user's link (IDOR)", async () => {
		const monitor = await createTestMonitor(owner.id);
		const link = await createTestShareLink(owner.id, [
			monitor.uptimeMonitorId,
		]);
		await expect(
			recipientCaller().uptimeMonitor.share.revoke({
				shareLinkId: link.shareLinkId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("throws NOT_FOUND for a missing link", async () => {
		await expect(
			ownerCaller().uptimeMonitor.share.revoke({ shareLinkId: "missing" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("requires authentication", async () => {
		await expect(
			publicCaller().uptimeMonitor.share.revoke({ shareLinkId: "s1" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

// ===========================================================================
// public.sharedLink
// ===========================================================================

describe("public.sharedLink", () => {
	it("returns only sanitized config fields and the sharer's display name", async () => {
		const monitor = await createTestMonitor(owner.id, {
			name: "Prod API",
			tags: ["prod"],
		});
		const link = await createTestShareLink(owner.id, [
			monitor.uptimeMonitorId,
		], { showSharerName: true });

		const resolved = await publicCaller().uptimeMonitor.public.sharedLink({
			token: link.token,
		});

		expect(resolved.sharedBy).toBe(owner.name);
		expect(resolved.expiresAt).toBe(link.expiresAt);
		expect(resolved.monitors).toHaveLength(1);
		// Exact key set — nothing owner-scoped may ever leak through this
		// public endpoint.
		expect(Object.keys(resolved.monitors[0]!).sort()).toEqual([
			"expectedStatus",
			"expectedStatuses",
			"failureThreshold",
			"interval",
			"method",
			"name",
			"tags",
			"timeout",
			"tlsMonitoringEnabled",
			"uptimeMonitorId",
			"url",
		]);
		expect(resolved.monitors[0]).toMatchObject({
			name: "Prod API",
			url: "https://example.com",
			tags: ["prod"],
		});
	});

	it("normalizes null tags to an empty array", async () => {
		const monitor = await createTestMonitor(owner.id, { tags: null });
		const link = await createTestShareLink(owner.id, [
			monitor.uptimeMonitorId,
		]);

		const resolved = await publicCaller().uptimeMonitor.public.sharedLink({
			token: link.token,
		});
		expect(resolved.monitors[0]?.tags).toEqual([]);
	});

	it("throws NOT_FOUND for an unknown token", async () => {
		await expect(
			publicCaller().uptimeMonitor.public.sharedLink({
				token: "x".repeat(32),
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("throws BAD_REQUEST for an expired link", async () => {
		const monitor = await createTestMonitor(owner.id);
		const link = await createTestShareLink(
			owner.id,
			[monitor.uptimeMonitorId],
			{ expiresAt: PAST_ISO },
		);
		await expect(
			publicCaller().uptimeMonitor.public.sharedLink({ token: link.token }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "This share link has expired",
		});
	});

	it("translates the expired error for Arabic callers", async () => {
		const monitor = await createTestMonitor(owner.id);
		const link = await createTestShareLink(
			owner.id,
			[monitor.uptimeMonitorId],
			{ expiresAt: PAST_ISO },
		);
		await expect(
			publicCaller("ar").uptimeMonitor.public.sharedLink({
				token: link.token,
			}),
		).rejects.toMatchObject({
			message: "انتهت صلاحية رابط المشاركة هذا",
		});
	});

	it("drops monitors deleted after sharing", async () => {
		const kept = await createTestMonitor(owner.id, { name: "Kept" });
		const doomed = await createTestMonitor(owner.id, { name: "Doomed" });
		const link = await createTestShareLink(owner.id, [
			kept.uptimeMonitorId,
			doomed.uptimeMonitorId,
		]);
		await db
			.delete(uptimeMonitor)
			.where(eq(uptimeMonitor.uptimeMonitorId, doomed.uptimeMonitorId));

		const resolved = await publicCaller().uptimeMonitor.public.sharedLink({
			token: link.token,
		});
		expect(resolved.monitors).toHaveLength(1);
		expect(resolved.monitors[0]?.name).toBe("Kept");
	});

	it("returns an empty monitor list when every shared monitor was deleted", async () => {
		const doomed = await createTestMonitor(owner.id);
		const link = await createTestShareLink(owner.id, [
			doomed.uptimeMonitorId,
		]);
		await db
			.delete(uptimeMonitor)
			.where(eq(uptimeMonitor.uptimeMonitorId, doomed.uptimeMonitorId));

		const resolved = await publicCaller().uptimeMonitor.public.sharedLink({
			token: link.token,
		});
		expect(resolved.monitors).toEqual([]);
	});
});

// ===========================================================================
// share.clone
// ===========================================================================

describe("share.clone", () => {
	it("clones the shared monitors into the recipient's account with a fresh state", async () => {
		const monitorA = await createTestMonitor(owner.id, {
			name: "A",
			tags: ["prod"],
			status: "up",
			consecutiveFailures: 2,
			isPublic: true,
			statusPageTitle: "Owner page",
			uptimePercentage: 99.9,
		});
		const monitorB = await createTestMonitor(owner.id, { name: "B" });
		const link = await createTestShareLink(owner.id, [
			monitorA.uptimeMonitorId,
			monitorB.uptimeMonitorId,
		]);

		const cloned = await recipientCaller().uptimeMonitor.share.clone({
			token: link.token,
			uptimeMonitorIds: [
				monitorA.uptimeMonitorId,
				monitorB.uptimeMonitorId,
			],
		});

		expect(cloned).toHaveLength(2);
		for (const monitor of cloned) {
			expect(monitor.userId).toBe(recipient.id);
			expect(monitor.status).toBe("pending");
			expect(monitor.active).toBe(true);
			expect(monitor.consecutiveFailures).toBe(0);
			expect(monitor.isPublic).toBe(false);
			expect(monitor.statusPageTitle).toBeNull();
			expect(monitor.uptimePercentage).toBeNull();
			expect(monitor.nextCheckAt).toBeTruthy();
			// New identity — never the original monitor's id.
			expect([
				monitorA.uptimeMonitorId,
				monitorB.uptimeMonitorId,
			]).not.toContain(monitor.uptimeMonitorId);
		}
		const clonedA = cloned.find((m) => m.name === "A");
		expect(clonedA).toMatchObject({
			url: "https://example.com",
			tags: ["prod"],
		});
		expect(scheduleMonitorCheck).toHaveBeenCalledTimes(2);
	});

	it("clones only the selected subset", async () => {
		const monitorA = await createTestMonitor(owner.id, { name: "A" });
		const monitorB = await createTestMonitor(owner.id, { name: "B" });
		const link = await createTestShareLink(owner.id, [
			monitorA.uptimeMonitorId,
			monitorB.uptimeMonitorId,
		]);

		const cloned = await recipientCaller().uptimeMonitor.share.clone({
			token: link.token,
			uptimeMonitorIds: [monitorB.uptimeMonitorId],
		});
		expect(cloned).toHaveLength(1);
		expect(cloned[0]?.name).toBe("B");
	});

	it("keeps clone batches uncapped", async () => {
		const existingCount = 25;
		await db.insert(uptimeMonitor).values(
			Array.from({ length: existingCount }, (_, i) => ({
				userId: recipient.id,
				name: `existing-${i}`,
				url: "https://example.com",
				interval: 30,
				active: false,
			})),
		);
		const shared = await Promise.all([
			createTestMonitor(owner.id, { name: "OSS clone A", interval: 30 }),
			createTestMonitor(owner.id, { name: "OSS clone B", interval: 30 }),
		]);
		const link = await createTestShareLink(
			owner.id,
			shared.map((monitor) => monitor.uptimeMonitorId),
		);

		const cloned = await recipientCaller().uptimeMonitor.share.clone({
			token: link.token,
			uptimeMonitorIds: shared.map((monitor) => monitor.uptimeMonitorId),
		});

		expect(cloned).toHaveLength(2);
		const recipientMonitors = await db.query.uptimeMonitor.findMany({
			where: eq(uptimeMonitor.userId, recipient.id),
		});
		expect(recipientMonitors).toHaveLength(existingCount + 2);
		expect(scheduleMonitorCheck).toHaveBeenCalledTimes(2);
	});

	it("silently drops requested ids that are not part of the share", async () => {
		const shared = await createTestMonitor(owner.id, { name: "Shared" });
		const unshared = await createTestMonitor(owner.id, { name: "Private" });
		const link = await createTestShareLink(owner.id, [
			shared.uptimeMonitorId,
		]);

		const cloned = await recipientCaller().uptimeMonitor.share.clone({
			token: link.token,
			uptimeMonitorIds: [shared.uptimeMonitorId, unshared.uptimeMonitorId],
		});
		expect(cloned).toHaveLength(1);
		expect(cloned[0]?.name).toBe("Shared");
	});

	it("throws BAD_REQUEST when nothing requested is available", async () => {
		const monitor = await createTestMonitor(owner.id);
		const link = await createTestShareLink(owner.id, [
			monitor.uptimeMonitorId,
		]);
		await expect(
			recipientCaller().uptimeMonitor.share.clone({
				token: link.token,
				uptimeMonitorIds: ["not-in-share"],
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "None of the selected monitors are available to add",
		});
	});

	it("throws BAD_REQUEST for an expired link", async () => {
		const monitor = await createTestMonitor(owner.id);
		const link = await createTestShareLink(
			owner.id,
			[monitor.uptimeMonitorId],
			{ expiresAt: PAST_ISO },
		);
		await expect(
			recipientCaller().uptimeMonitor.share.clone({
				token: link.token,
				uptimeMonitorIds: [monitor.uptimeMonitorId],
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("throws NOT_FOUND for an unknown token", async () => {
		await expect(
			recipientCaller().uptimeMonitor.share.clone({
				token: "x".repeat(32),
				uptimeMonitorIds: ["m1"],
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("lets the owner clone their own share (duplicates)", async () => {
		const monitor = await createTestMonitor(owner.id, { name: "Mine" });
		const link = await createTestShareLink(owner.id, [
			monitor.uptimeMonitorId,
		]);

		const cloned = await ownerCaller().uptimeMonitor.share.clone({
			token: link.token,
			uptimeMonitorIds: [monitor.uptimeMonitorId],
		});
		expect(cloned).toHaveLength(1);
		expect(cloned[0]?.userId).toBe(owner.id);
		expect(cloned[0]?.uptimeMonitorId).not.toBe(monitor.uptimeMonitorId);
	});

	it("requires authentication", async () => {
		await expect(
			publicCaller().uptimeMonitor.share.clone({
				token: "x".repeat(32),
				uptimeMonitorIds: ["m1"],
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

describe("share secret disclosure boundary", () => {
  it("rejects private URLs, removes newly unsafe legacy members and redacts repeated stored request values", async () => {
    const owner = await createTestUser(), caller = authedCaller(owner);
    const { httpConfigPatch } = await import("../../../services/uptime/http-config");
    const { getTranslator } = await import("../../../lib/i18n");
    const secret = "private-share-fixture";
    const monitor = await createTestMonitor(owner.id, { url: "https://example.invalid/health", name: `Service ${secret}`, tags: [secret], ...httpConfigPatch({ requestConfig: { headers: [{ name: "X-Private", value: secret }] } }, "GET", getTranslator("en")) });
    const preview = await caller.uptimeMonitor.share.preview({ uptimeMonitorIds: [monitor.uptimeMonitorId] });
    expect(JSON.stringify(preview)).not.toContain(secret); expect(preview).toHaveLength(1);
    expect(await db.select().from(uptimeShareLink).where(eq(uptimeShareLink.userId, owner.id))).toHaveLength(0);
    const link = await caller.uptimeMonitor.share.create({ uptimeMonitorIds: [monitor.uptimeMonitorId], expiresInDays: 7 });
    const resolved = await caller.uptimeMonitor.public.sharedLink({ token: link.token });
    expect(JSON.stringify(resolved)).not.toContain(secret); expect(resolved.monitors).toHaveLength(1);
    await db.update(uptimeMonitor).set({ url: `https://example.invalid/health?token=${secret}` }).where(eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId));
    await expect(caller.uptimeMonitor.share.create({ uptimeMonitorIds: [monitor.uptimeMonitorId], expiresInDays: 7 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await caller.uptimeMonitor.public.sharedLink({ token: link.token })).monitors).toHaveLength(0);
    await expect(caller.uptimeMonitor.share.clone({ token: link.token, uptimeMonitorIds: [monitor.uptimeMonitorId] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

it("reveals the sharer's name only when explicitly included in the link", async () => {
  const monitor = await createTestMonitor(owner.id);
  for (const showSharerName of [false, true]) {
    const link = await ownerCaller().uptimeMonitor.share.create({ uptimeMonitorIds: [monitor.uptimeMonitorId], showSharerName });
    const shared = await publicCaller().uptimeMonitor.public.sharedLink({ token: link.token });
    expect(shared.sharedBy).toBe(showSharerName ? owner.name : null);
  }
});

it("enforces the same live-link abuse ceiling atomically without counting expired links or other owners", async () => {
  const { and, count, gt } = await import("drizzle-orm");
  const { uptimeShareLink } = await import("@pulsy/db");
  const monitor = await createTestMonitor(owner.id);
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  const links = await db.insert(uptimeShareLink).values(Array.from({ length: 200 }, (_, index) => ({ userId: owner.id, token: `bounded-fixture-link-${index}`, monitorIds: [monitor.uptimeMonitorId], expiresAt }))).returning();
  await expect(ownerCaller().uptimeMonitor.share.create({ uptimeMonitorIds: [monitor.uptimeMonitorId] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await db.update(uptimeShareLink).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(and(eq(uptimeShareLink.userId, owner.id), eq(uptimeShareLink.shareLinkId, links[0]!.shareLinkId)));
  const results = await Promise.allSettled([1, 2].map(() => ownerCaller().uptimeMonitor.share.create({ uptimeMonitorIds: [monitor.uptimeMonitorId] })));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const [total] = await db.select({ value: count() }).from(uptimeShareLink).where(and(eq(uptimeShareLink.userId, owner.id), gt(uptimeShareLink.expiresAt, new Date().toISOString())));
  expect(total!.value).toBe(200);
  const foreign = await createTestMonitor(recipient.id);
  expect(await recipientCaller().uptimeMonitor.share.create({ uptimeMonitorIds: [foreign.uptimeMonitorId] })).toMatchObject({ userId: recipient.id });
});
