// ---------------------------------------------------------------------------
// organization router + scope helper tests.
//
// Covers:
//   - regression: a user with NO org → existing monitor flows behave exactly
//     as today (no schema change leaks, list/create still work)
//   - create:        slug uniqueness
//   - invite:        duplicate rejection, owner/admin requirement,
//                    email-not-found path
//   - members:       requires membership; non-members get FORBIDDEN
//   - removeMember:  owner cannot be removed; non-admin cannot remove
//   - leave:         owner cannot leave; member can
//   - resolveScope:  defaults to user scope; rejects non-members
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";

import { db, organization, organizationMember } from "@pulsy/db";
import { eq } from "drizzle-orm";

import {
	createTestUser,
	createTestMonitor,
	useCleanDatabase,
} from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { resolveScope, isOrgMember, getOrgMemberRole } from "../../../lib/scope";
import { getTranslator } from "../../../lib/i18n";

// ---------------------------------------------------------------------------
// Scheduler mocks so monitor flows do not try to schedule real timers.
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

useCleanDatabase();

const originalEnv = { ...process.env };

beforeEach(() => {
	scheduleMonitorCheck.mockClear();
	rescheduleMonitorCheck.mockClear();
	cancelMonitorCheck.mockClear();
});

afterEach(() => {
	process.env = { ...originalEnv };
	vi.restoreAllMocks();
});

async function makeUser(): Promise<{ id: string; email: string }> {
	const u = await createTestUser();
	return { id: u.id, email: u.email };
}

// ---------------------------------------------------------------------------
// Regression: existing per-user monitor flow is unchanged by this prompt.
// ---------------------------------------------------------------------------

describe("regression — per-user monitor flow", () => {
	it("a user with NO org can still list and own their monitors", async () => {
		const u = await createTestUser();
		await createTestMonitor(u.id, { name: "A" });
		await createTestMonitor(u.id, { name: "B" });

		const caller = authedCaller({ id: u.id, email: u.email });
		const list = await caller.uptimeMonitor.monitor.list();
		expect(list).toHaveLength(2);
		expect(list.map((m) => m.userId)).toEqual([u.id, u.id]);
	});

	it("a user without any membership sees no organizations", async () => {
		const u = await createTestUser();
		const caller = authedCaller({ id: u.id, email: u.email });
		const orgs = await caller.organization.list();
		expect(orgs).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// organization.create
// ---------------------------------------------------------------------------

describe("organization.create", () => {
	it("creates org and seeds the owner row for any signed-in user", async () => {
		const u = await makeUser();
		const caller = authedCaller({ id: u.id, email: u.email });

		const created = await caller.organization.create({
			name: "Acme",
			slug: "acme",
		});
		expect(created.ownerUserId).toBe(u.id);
		expect(created.slug).toBe("acme");

		const members = await caller.organization.members({
			organizationId: created.organizationId,
		});
		expect(members).toHaveLength(1);
		expect(members[0]?.role).toBe("owner");
		expect(members[0]?.userId).toBe(u.id);
	});

	it("rejects a duplicate slug with a localized error", async () => {
		const a = await makeUser();
		const callerA = authedCaller({ id: a.id, email: a.email });
		await callerA.organization.create({ name: "First", slug: "shared" });

		const b = await makeUser();
		const callerB = authedCaller({ id: b.id, email: b.email });
		await expect(
			callerB.organization.create({ name: "Second", slug: "shared" }),
		).rejects.toThrowError(/slug is already taken/i);
	});
});

// ---------------------------------------------------------------------------
// organization.invite — seat enforcement
// ---------------------------------------------------------------------------

describe("organization.invite", () => {
	it("rejects when the target email has no Pulsy account", async () => {
		const owner = await makeUser();
		const caller = authedCaller({ id: owner.id, email: owner.email });
		const org = await caller.organization.create({
			name: "Acme",
			slug: "acme",
		});

		await expect(
			caller.organization.invite({
				organizationId: org.organizationId,
				email: "ghost@nowhere.example",
			}),
		).rejects.toThrowError(/No Pulsy account/i);
	});

	it("invites members without any seat cap", async () => {
		const owner = await makeUser();
		const callerOwner = authedCaller({ id: owner.id, email: owner.email });
		const org = await callerOwner.organization.create({
			name: "Acme",
			slug: "acme",
		});

		for (let i = 0; i < 12; i += 1) {
			const u = await createTestUser({ email: `m${i}@pulsy.test` });
			await callerOwner.organization.invite({
				organizationId: org.organizationId,
				email: u.email,
			});
		}

		const members = await callerOwner.organization.members({
			organizationId: org.organizationId,
		});
		expect(members).toHaveLength(13);
	});

	it("rejects duplicate memberships", async () => {
		const owner = await makeUser();
		const caller = authedCaller({ id: owner.id, email: owner.email });
		const org = await caller.organization.create({
			name: "Acme",
			slug: "acme-dup",
		});
		const u = await createTestUser({ email: "dup@pulsy.test" });

		await caller.organization.invite({
			organizationId: org.organizationId,
			email: u.email,
		});
		await expect(
			caller.organization.invite({
				organizationId: org.organizationId,
				email: u.email,
			}),
		).rejects.toThrowError(/already a member/i);
	});

	it("rejects when the caller is a plain member, not owner/admin", async () => {
		const owner = await makeUser();
		const callerOwner = authedCaller({ id: owner.id, email: owner.email });
		const org = await callerOwner.organization.create({
			name: "Acme",
			slug: "acme-perm",
		});
		const member = await createTestUser({ email: "member@pulsy.test" });
		await callerOwner.organization.invite({
			organizationId: org.organizationId,
			email: member.email,
			role: "member",
		});

		const callerMember = authedCaller({ id: member.id, email: member.email });
		const stranger = await createTestUser({ email: "stranger@pulsy.test" });
		await expect(
			callerMember.organization.invite({
				organizationId: org.organizationId,
				email: stranger.email,
			}),
		).rejects.toThrowError(/permission/i);
	});

	it("admins can invite members", async () => {
		const owner = await makeUser();
		const callerOwner = authedCaller({ id: owner.id, email: owner.email });
		const org = await callerOwner.organization.create({
			name: "Acme",
			slug: "acme-admin",
		});
		const admin = await createTestUser({ email: "admin@pulsy.test" });
		await callerOwner.organization.invite({
			organizationId: org.organizationId,
			email: admin.email,
			role: "admin",
		});

		const callerAdmin = authedCaller({ id: admin.id, email: admin.email });
		const newMember = await createTestUser({ email: "new@pulsy.test" });

		const inserted = await callerAdmin.organization.invite({
			organizationId: org.organizationId,
			email: newMember.email,
		});
		expect(inserted.userId).toBe(newMember.id);
	});
});

// ---------------------------------------------------------------------------
// organization.members
// ---------------------------------------------------------------------------

describe("organization.members", () => {
	it("non-members cannot read the member list", async () => {
		const owner = await makeUser();
		const callerOwner = authedCaller({ id: owner.id, email: owner.email });
		const org = await callerOwner.organization.create({
			name: "Acme",
			slug: "acme-mlist",
		});

		const outsider = await createTestUser();
		const callerOut = authedCaller({ id: outsider.id, email: outsider.email });
		await expect(
			callerOut.organization.members({ organizationId: org.organizationId }),
		).rejects.toThrowError(/member of this organization/i);
	});
});

// ---------------------------------------------------------------------------
// organization.removeMember
// ---------------------------------------------------------------------------

describe("organization.removeMember", () => {
	it("removes a non-owner member", async () => {
		const owner = await makeUser();
		const callerOwner = authedCaller({ id: owner.id, email: owner.email });
		const org = await callerOwner.organization.create({
			name: "Acme",
			slug: "acme-rm",
		});
		const m = await createTestUser({ email: "rm@pulsy.test" });
		const inserted = await callerOwner.organization.invite({
			organizationId: org.organizationId,
			email: m.email,
		});

		const result = await callerOwner.organization.removeMember({
			organizationId: org.organizationId,
			memberId: inserted.memberId,
		});
		expect(result.ok).toBe(true);

		const members = await callerOwner.organization.members({
			organizationId: org.organizationId,
		});
		expect(members.map((mb) => mb.userId)).not.toContain(m.id);
	});

	it("refuses to remove the owner", async () => {
		const owner = await makeUser();
		const callerOwner = authedCaller({ id: owner.id, email: owner.email });
		const org = await callerOwner.organization.create({
			name: "Acme",
			slug: "acme-rmown",
		});

		const ownerRow = await db.query.organizationMember.findFirst({
			where: eq(organizationMember.organizationId, org.organizationId),
			columns: { memberId: true },
		});

		await expect(
			callerOwner.organization.removeMember({
				organizationId: org.organizationId,
				memberId: ownerRow!.memberId,
			}),
		).rejects.toThrowError(/permission/i);
	});

	it("rejects when the caller is a plain member", async () => {
		const owner = await makeUser();
		const callerOwner = authedCaller({ id: owner.id, email: owner.email });
		const org = await callerOwner.organization.create({
			name: "Acme",
			slug: "acme-rmperm",
		});
		const a = await createTestUser({ email: "ma@pulsy.test" });
		const b = await createTestUser({ email: "mb@pulsy.test" });
		await callerOwner.organization.invite({
			organizationId: org.organizationId,
			email: a.email,
		});
		const bRow = await callerOwner.organization.invite({
			organizationId: org.organizationId,
			email: b.email,
		});

		const callerA = authedCaller({ id: a.id, email: a.email });
		await expect(
			callerA.organization.removeMember({
				organizationId: org.organizationId,
				memberId: bRow.memberId,
			}),
		).rejects.toThrowError(/permission/i);
	});

	it("returns NOT_FOUND for an unknown memberId", async () => {
		const owner = await makeUser();
		const callerOwner = authedCaller({ id: owner.id, email: owner.email });
		const org = await callerOwner.organization.create({
			name: "Acme",
			slug: "acme-rmnf",
		});

		await expect(
			callerOwner.organization.removeMember({
				organizationId: org.organizationId,
				memberId: "nonexistent",
			}),
		).rejects.toThrowError(/not found/i);
	});
});

// ---------------------------------------------------------------------------
// organization.leave
// ---------------------------------------------------------------------------

describe("organization.leave", () => {
	it("owner cannot leave", async () => {
		const owner = await makeUser();
		const callerOwner = authedCaller({ id: owner.id, email: owner.email });
		const org = await callerOwner.organization.create({
			name: "Acme",
			slug: "acme-leave",
		});

		await expect(
			callerOwner.organization.leave({ organizationId: org.organizationId }),
		).rejects.toThrowError(/owner cannot leave/i);
	});

	it("non-owner member can leave", async () => {
		const owner = await makeUser();
		const callerOwner = authedCaller({ id: owner.id, email: owner.email });
		const org = await callerOwner.organization.create({
			name: "Acme",
			slug: "acme-leave-ok",
		});
		const m = await createTestUser({ email: "leaver@pulsy.test" });
		await callerOwner.organization.invite({
			organizationId: org.organizationId,
			email: m.email,
		});

		const callerM = authedCaller({ id: m.id, email: m.email });
		const result = await callerM.organization.leave({
			organizationId: org.organizationId,
		});
		expect(result.ok).toBe(true);

		const after = await callerOwner.organization.members({
			organizationId: org.organizationId,
		});
		expect(after.map((mb) => mb.userId)).not.toContain(m.id);
	});

	it("non-member call to leave is rejected", async () => {
		const owner = await makeUser();
		const callerOwner = authedCaller({ id: owner.id, email: owner.email });
		const org = await callerOwner.organization.create({
			name: "Acme",
			slug: "acme-leave-nm",
		});

		const outsider = await createTestUser();
		const callerOut = authedCaller({ id: outsider.id, email: outsider.email });
		await expect(
			callerOut.organization.leave({ organizationId: org.organizationId }),
		).rejects.toThrowError(/member of this organization/i);
	});
});

// ---------------------------------------------------------------------------
// resolveScope helper
// ---------------------------------------------------------------------------

describe("resolveScope", () => {
	const t = getTranslator("en");

	it("returns user-only scope when no organizationId is passed", async () => {
		const u = await createTestUser();
		const scope = await resolveScope(db, u.id, t);
		expect(scope).toEqual({ userId: u.id });
		expect(scope.organizationId).toBeUndefined();
	});

	it("returns user-only scope when organizationId is null", async () => {
		const u = await createTestUser();
		const scope = await resolveScope(db, u.id, t, { organizationId: null });
		expect(scope).toEqual({ userId: u.id });
	});

	it("returns org scope when caller is a member", async () => {
		const owner = await createTestUser();
		const [org] = await db
			.insert(organization)
			.values({ ownerUserId: owner.id, name: "T", slug: `t-${nanoid(6)}` })
			.returning();
		await db.insert(organizationMember).values({
			organizationId: org!.organizationId,
			userId: owner.id,
			role: "owner",
		});

		const scope = await resolveScope(db, owner.id, t, {
			organizationId: org!.organizationId,
		});
		expect(scope.userId).toBe(owner.id);
		expect(scope.organizationId).toBe(org!.organizationId);
	});

	it("rejects with FORBIDDEN when caller is not a member", async () => {
		const owner = await createTestUser();
		const [org] = await db
			.insert(organization)
			.values({ ownerUserId: owner.id, name: "T", slug: `t-${nanoid(6)}` })
			.returning();
		await db.insert(organizationMember).values({
			organizationId: org!.organizationId,
			userId: owner.id,
			role: "owner",
		});

		const outsider = await createTestUser();
		await expect(
			resolveScope(db, outsider.id, t, {
				organizationId: org!.organizationId,
			}),
		).rejects.toThrowError(/member of this organization/i);
	});

	it("rejects with NOT_FOUND when the org does not exist", async () => {
		const u = await createTestUser();
		await expect(
			resolveScope(db, u.id, t, { organizationId: "missing-org" }),
		).rejects.toThrowError(/not found/i);
	});

	it("isOrgMember reports membership correctly", async () => {
		const owner = await createTestUser();
		const outsider = await createTestUser();
		const [org] = await db
			.insert(organization)
			.values({ ownerUserId: owner.id, name: "T", slug: `t-${nanoid(6)}` })
			.returning();
		await db.insert(organizationMember).values({
			organizationId: org!.organizationId,
			userId: owner.id,
			role: "owner",
		});

		await expect(
			isOrgMember(db, owner.id, org!.organizationId),
		).resolves.toBe(true);
		await expect(
			isOrgMember(db, outsider.id, org!.organizationId),
		).resolves.toBe(false);
	});

	it("getOrgMemberRole returns the role or null", async () => {
		const owner = await createTestUser();
		const [org] = await db
			.insert(organization)
			.values({ ownerUserId: owner.id, name: "T", slug: `t-${nanoid(6)}` })
			.returning();
		await db.insert(organizationMember).values({
			organizationId: org!.organizationId,
			userId: owner.id,
			role: "owner",
		});

		await expect(
			getOrgMemberRole(db, owner.id, org!.organizationId),
		).resolves.toBe("owner");

		const outsider = await createTestUser();
		await expect(
			getOrgMemberRole(db, outsider.id, org!.organizationId),
		).resolves.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Idempotency: re-listing the org router on a populated DB does not create
// duplicate procedures or duplicate owner rows.
// ---------------------------------------------------------------------------

describe("idempotency", () => {
	it("listing an empty result set is safe and does not duplicate owner rows", async () => {
		const owner = await makeUser();
		const caller = authedCaller({ id: owner.id, email: owner.email });
		const org = await caller.organization.create({
			name: "Acme",
			slug: "acme-idem",
		});

		// Hit `members` twice — the second call must return the same single
		// owner row, with no accidental insert.
		await caller.organization.members({ organizationId: org.organizationId });
		const members = await caller.organization.members({
			organizationId: org.organizationId,
		});
		expect(members).toHaveLength(1);
		expect(members[0]?.role).toBe("owner");
	});
});
