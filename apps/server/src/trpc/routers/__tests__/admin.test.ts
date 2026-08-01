// DB-backed tests for the admin.* router (the /superadmin surface). Exercises
// the adminProcedure gate and every procedure/branch against a real DB.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import {
	apiKey as apiKeyTable,
	session as sessionTable,
	user as userTable,
} from "@pulsy/db";

import {
	db,
	useCleanDatabase,
	createTestUser,
	createTestSuperadmin,
	createTestMonitor,
	createTestApiKey,
} from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";

useCleanDatabase();

let admin: Awaited<ReturnType<typeof createTestSuperadmin>>;
let caller: ReturnType<typeof authedCaller>;

beforeEach(async () => {
	admin = await createTestSuperadmin({ email: "admin@pulsy.test" });
	caller = authedCaller({ id: admin.id });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("adminProcedure gate", () => {
	it("rejects unauthenticated callers", async () => {
		await expect(publicCaller().admin.stats.overview()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("rejects authenticated non-admins", async () => {
		const u = await createTestUser({ email: "plain@pulsy.test" });
		await expect(
			authedCaller({ id: u.id }).admin.stats.overview(),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("rejects a caller with no DB user row", async () => {
		await expect(
			authedCaller({ id: "ghost_user" }).admin.stats.overview(),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("rejects a banned superadmin", async () => {
		const banned = await createTestSuperadmin({
			email: "banned-admin@pulsy.test",
			banned: true,
		});
		await expect(
			authedCaller({ id: banned.id }).admin.stats.overview(),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("allows a superadmin", async () => {
		const res = await caller.admin.stats.overview();
		expect(res.users.total).toBeGreaterThanOrEqual(1);
	});
});

describe("stats.overview", () => {
	it("aggregates users and monitors", async () => {
		const u1 = await createTestUser({
			email: "a@pulsy.test",
			banned: true,
			bannedReason: "x",
		});
		const u2 = await createTestUser({ email: "b@pulsy.test" });
		await createTestMonitor(u1.id);
		await createTestMonitor(u2.id, { active: false });

		const res = await caller.admin.stats.overview();
		expect(res.users.total).toBe(3);
		expect(res.users.new30d).toBe(3);
		expect(res.users.banned).toBe(1);
		expect(res.users.superadmins).toBe(1);
		expect(res.monitors.total).toBe(2);
		expect(res.monitors.active).toBe(1);
		expect(res.monitors.byStatus.length).toBeGreaterThanOrEqual(1);
	});
});

describe("users.list", () => {
	it("lists users with monitor counts, newest first", async () => {
		const withMonitors = await createTestUser({ email: "withmon@pulsy.test" });
		await createTestMonitor(withMonitors.id);
		await createTestMonitor(withMonitors.id);
		const plain = await createTestUser({ email: "plain@pulsy.test" });

		const res = await caller.admin.users.list({ limit: 50, offset: 0 });
		expect(res.total).toBe(3);

		const withMonitorsItem = res.items.find((i) => i.id === withMonitors.id)!;
		expect(withMonitorsItem.monitorCount).toBe(2);

		const plainItem = res.items.find((i) => i.id === plain.id)!;
		expect(plainItem.monitorCount).toBe(0);
	});

	it("filters by search across email and name", async () => {
		await createTestUser({ email: "needle@pulsy.test", name: "Zenith" });
		await createTestUser({ email: "other@pulsy.test", name: "Findme" });
		const byEmail = await caller.admin.users.list({ search: "needle" });
		expect(byEmail.items).toHaveLength(1);
		const byName = await caller.admin.users.list({ search: "Findme" });
		expect(byName.items).toHaveLength(1);
	});

	it("filters by role", async () => {
		await createTestUser({ email: "plain2@pulsy.test" });
		const res = await caller.admin.users.list({ role: "superadmin" });
		expect(res.items).toHaveLength(1);
		expect(res.items.every((i) => i.role === "superadmin")).toBe(true);
	});

	it("filters by banned", async () => {
		await createTestUser({ email: "banned2@pulsy.test", banned: true });
		const res = await caller.admin.users.list({ banned: true });
		expect(res.items).toHaveLength(1);
		expect(res.items[0]?.banned).toBe(true);
	});

	it("returns an empty page when nothing matches", async () => {
		const res = await caller.admin.users.list({ search: "zzz-no-match-zzz" });
		expect(res.items).toHaveLength(0);
		expect(res.total).toBe(0);
	});
});

describe("users.one", () => {
	it("returns a user's detail with the monitor count", async () => {
		const u = await createTestUser({ email: "detail@pulsy.test" });
		await createTestMonitor(u.id);
		const res = await caller.admin.users.one({ userId: u.id });
		expect(res.user.email).toBe("detail@pulsy.test");
		expect(res.monitorCount).toBe(1);
	});

	it("throws NOT_FOUND for an unknown user", async () => {
		await expect(
			caller.admin.users.one({ userId: "nope" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("users.setRole", () => {
	it("promotes a user to superadmin", async () => {
		const u = await createTestUser({ email: "promote@pulsy.test" });
		const res = await caller.admin.users.setRole({
			userId: u.id,
			role: "superadmin",
		});
		expect(res.role).toBe("superadmin");
		const row = await db.query.user.findFirst({ where: eq(userTable.id, u.id) });
		expect(row?.role).toBe("superadmin");
	});

	it("demotes another superadmin to user", async () => {
		const other = await createTestSuperadmin({ email: "other2@pulsy.test" });
		const res = await caller.admin.users.setRole({
			userId: other.id,
			role: "user",
		});
		expect(res.role).toBe("user");
	});

	it("rejects acting on yourself", async () => {
		await expect(
			caller.admin.users.setRole({ userId: admin.id, role: "user" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("throws NOT_FOUND for an unknown user", async () => {
		await expect(
			caller.admin.users.setRole({ userId: "nope", role: "user" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("users.ban / unban", () => {
	it("bans a user and permanently revokes their sessions and live API keys", async () => {
		const u = await createTestUser({ email: "toban@pulsy.test" });
		const other = await createTestUser({ email: "not-banned@pulsy.test" });
		const liveKey = await createTestApiKey(u.id);
		const priorRevocation = "2025-01-01T00:00:00.000Z";
		const alreadyRevokedKey = await createTestApiKey(u.id, {
			revokedAt: priorRevocation,
		});
		const otherKey = await createTestApiKey(other.id);
		await db.insert(sessionTable).values({
			id: "sess_ban_1",
			token: "tok_ban_1",
			userId: u.id,
			expiresAt: new Date(Date.now() + 3_600_000),
		});

		const res = await caller.admin.users.ban({ userId: u.id, reason: "spam" });
		expect(res.banned).toBe(true);

		const row = await db.query.user.findFirst({ where: eq(userTable.id, u.id) });
		expect(row?.banned).toBe(true);
		expect(row?.bannedReason).toBe("spam");

		const sessions = await db
			.select()
			.from(sessionTable)
			.where(eq(sessionTable.userId, u.id));
		expect(sessions).toHaveLength(0);

		const targetKeys = await db.query.apiKey.findMany({
			where: eq(apiKeyTable.userId, u.id),
		});
		expect(
			targetKeys.find((key) => key.apiKeyId === liveKey.row.apiKeyId)
				?.revokedAt,
		).not.toBeNull();
		expect(
			targetKeys.find(
				(key) => key.apiKeyId === alreadyRevokedKey.row.apiKeyId,
			)?.revokedAt,
		).toBe(priorRevocation);

		const untouchedOtherKey = await db.query.apiKey.findFirst({
			where: eq(apiKeyTable.apiKeyId, otherKey.row.apiKeyId),
		});
		expect(untouchedOtherKey?.revokedAt).toBeNull();
	});

	it("bans a user without a reason", async () => {
		const u = await createTestUser({ email: "toban2@pulsy.test" });
		await caller.admin.users.ban({ userId: u.id });
		const row = await db.query.user.findFirst({ where: eq(userTable.id, u.id) });
		expect(row?.banned).toBe(true);
		expect(row?.bannedReason).toBeNull();
	});

	it("rejects banning yourself", async () => {
		await expect(
			caller.admin.users.ban({ userId: admin.id }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("throws NOT_FOUND banning an unknown user", async () => {
		await expect(
			caller.admin.users.ban({ userId: "nope" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("unbans a user", async () => {
		const u = await createTestUser({
			email: "unban@pulsy.test",
			banned: true,
			bannedReason: "x",
		});
		const res = await caller.admin.users.unban({ userId: u.id });
		expect(res.banned).toBe(false);
		const row = await db.query.user.findFirst({ where: eq(userTable.id, u.id) });
		expect(row?.banned).toBe(false);
		expect(row?.bannedReason).toBeNull();
	});

	it("does not reactivate an API key when its owner is unbanned", async () => {
		const u = await createTestUser({
			email: "unban-key@pulsy.test",
			banned: true,
		});
		const key = await createTestApiKey(u.id, {
			revokedAt: "2025-01-01T00:00:00.000Z",
		});

		await caller.admin.users.unban({ userId: u.id });

		const stored = await db.query.apiKey.findFirst({
			where: eq(apiKeyTable.apiKeyId, key.row.apiKeyId),
		});
		expect(stored?.revokedAt).toBe("2025-01-01T00:00:00.000Z");
	});

	it("throws NOT_FOUND unbanning an unknown user", async () => {
		await expect(
			caller.admin.users.unban({ userId: "nope" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("users.delete", () => {
	it("hard-deletes a user", async () => {
		const u = await createTestUser({ email: "del@pulsy.test" });
		const res = await caller.admin.users.delete({ userId: u.id });
		expect(res.deleted).toBe(true);
		const row = await db.query.user.findFirst({ where: eq(userTable.id, u.id) });
		expect(row).toBeUndefined();
	});

	it("rejects deleting yourself", async () => {
		await expect(
			caller.admin.users.delete({ userId: admin.id }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("throws NOT_FOUND for an unknown user", async () => {
		await expect(
			caller.admin.users.delete({ userId: "nope" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
