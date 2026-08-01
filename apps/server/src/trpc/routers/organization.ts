// ---------------------------------------------------------------------------
// organization.* router.
//
// Optional multi-account grouping: any user can create an org, invite other
// Pulsy accounts, list members, and leave / remove members. This is additive —
// monitors stay `userId`-scoped and users who never create an org never touch
// the org tables. No seat caps: self-hosted Pulsy has no tiers.
//
// Authorization rules:
//   - `create`        Any signed-in user. Owner row created implicitly.
//   - `list`          Returns orgs the caller is a member of.
//   - `members`       Caller must be a member of the org.
//   - `invite`        Caller must be owner/admin.
//   - `removeMember`  Caller must be owner/admin. Owners can't be removed.
//   - `leave`         Caller must be a non-owner member.
// ---------------------------------------------------------------------------

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
	apiCreateOrganization,
	apiInviteOrganizationMember,
	apiRemoveOrganizationMember,
	db,
	organization,
	organizationMember,
	user as userTable,
} from "@pulsy/db";

import { protectedProcedure, router } from "../trpc";
import { getOrgMemberRole } from "../../lib/scope";
import type { Translator } from "../../lib/i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function forbidden(t: Translator, key = "errors.forbidden"): TRPCError {
	return new TRPCError({ code: "FORBIDDEN", message: t(key) });
}

function notFound(t: Translator, resource: string): TRPCError {
	return new TRPCError({
		code: "NOT_FOUND",
		message: t("errors.notFound", { resource }),
	});
}

function badRequest(
	t: Translator,
	key: string,
	vars?: Record<string, string | number>,
): TRPCError {
	return new TRPCError({ code: "BAD_REQUEST", message: t(key, vars) });
}

async function assertMember(
	userId: string,
	organizationId: string,
	t: Translator,
): Promise<"owner" | "admin" | "member"> {
	const role = await getOrgMemberRole(db, userId, organizationId);
	if (!role) {
		throw forbidden(t, "errors.notOrgMember");
	}
	return role;
}

async function assertOwnerOrAdmin(
	userId: string,
	organizationId: string,
	t: Translator,
): Promise<"owner" | "admin"> {
	const role = await assertMember(userId, organizationId, t);
	if (role === "member") {
		throw forbidden(t);
	}
	return role;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const organizationRouter = router({
	/**
	 * Create a new organization. The caller becomes the owner.
	 */
	create: protectedProcedure
		.input(apiCreateOrganization)
		.mutation(async ({ input, ctx }) => {
			// Slug uniqueness is also enforced by the UNIQUE index, but checking
			// first lets us return a localized error rather than a 500 from the
			// constraint violation.
			const existing = await db.query.organization.findFirst({
				where: eq(organization.slug, input.slug),
				columns: { organizationId: true },
			});
			if (existing) {
				throw badRequest(ctx.t, "errors.orgSlugTaken");
			}

			const [created] = await db
				.insert(organization)
				.values({
					ownerUserId: ctx.user.id,
					name: input.name,
					slug: input.slug,
				})
				.returning();

			/* v8 ignore next 6 -- unreachable: INSERT ... RETURNING yields the row or throws */
			if (!created) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: ctx.t("errors.internal"),
				});
			}

			// Owner row — implicit, never goes through the invite endpoint.
			await db.insert(organizationMember).values({
				organizationId: created.organizationId,
				userId: ctx.user.id,
				role: "owner",
			});

			return created;
		}),

	/** List organizations the caller is a member of. */
	list: protectedProcedure.query(async ({ ctx }) => {
		const memberships = await db
			.select({
				organizationId: organization.organizationId,
				ownerUserId: organization.ownerUserId,
				name: organization.name,
				slug: organization.slug,
				createdAt: organization.createdAt,
				role: organizationMember.role,
			})
			.from(organizationMember)
			.innerJoin(
				organization,
				eq(organizationMember.organizationId, organization.organizationId),
			)
			.where(eq(organizationMember.userId, ctx.user.id));
		return memberships;
	}),

	/**
	 * Members of an organization. Caller must be a member to read this list —
	 * external visibility is not part of Pulsy's model.
	 */
	members: protectedProcedure
		.input(z.object({ organizationId: z.string().min(1) }))
		.query(async ({ input, ctx }) => {
			await assertMember(ctx.user.id, input.organizationId, ctx.t);

			const rows = await db
				.select({
					memberId: organizationMember.memberId,
					userId: organizationMember.userId,
					role: organizationMember.role,
					joinedAt: organizationMember.joinedAt,
					invitedAt: organizationMember.invitedAt,
					email: userTable.email,
					name: userTable.name,
				})
				.from(organizationMember)
				.innerJoin(userTable, eq(organizationMember.userId, userTable.id))
				.where(eq(organizationMember.organizationId, input.organizationId));

			return rows;
		}),

	/**
	 * Invite (= directly add) a Pulsy user by email. Caller must be owner or
	 * admin.
	 *
	 * Note: Pulsy's MVP "invite" creates the membership row immediately for
	 * an existing Pulsy account, mirroring the current single-account auth
	 * model. Pending-invite-via-email is intentionally out of scope for the
	 * first cut.
	 */
	invite: protectedProcedure
		.input(apiInviteOrganizationMember)
		.mutation(async ({ input, ctx }) => {
			await assertOwnerOrAdmin(ctx.user.id, input.organizationId, ctx.t);

			// Resolve the email -> userId. Pulsy MVP only supports inviting
			// existing accounts.
			const invitee = await db.query.user.findFirst({
				where: eq(userTable.email, input.email),
				columns: { id: true },
			});
			if (!invitee) {
				throw badRequest(ctx.t, "errors.orgInviteUserNotFound", {
					email: input.email,
				});
			}

			// Reject duplicate memberships rather than no-op them.
			const existing = await db.query.organizationMember.findFirst({
				where: and(
					eq(organizationMember.organizationId, input.organizationId),
					eq(organizationMember.userId, invitee.id),
				),
				columns: { memberId: true },
			});
			if (existing) {
				throw badRequest(ctx.t, "errors.orgMemberAlreadyExists");
			}

			const [inserted] = await db
				.insert(organizationMember)
				.values({
					organizationId: input.organizationId,
					userId: invitee.id,
					role: input.role,
					invitedAt: new Date().toISOString(),
				})
				.returning();

			/* v8 ignore next 6 -- unreachable: INSERT ... RETURNING yields the row or throws */
			if (!inserted) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: ctx.t("errors.internal"),
				});
			}

			return inserted;
		}),

	/**
	 * Remove a member from the org. Caller must be owner or admin. The org
	 * owner row can never be removed through this endpoint.
	 */
	removeMember: protectedProcedure
		.input(apiRemoveOrganizationMember)
		.mutation(async ({ input, ctx }) => {
			await assertOwnerOrAdmin(ctx.user.id, input.organizationId, ctx.t);

			const target = await db.query.organizationMember.findFirst({
				where: and(
					eq(organizationMember.memberId, input.memberId),
					eq(organizationMember.organizationId, input.organizationId),
				),
				columns: { role: true, userId: true },
			});
			if (!target) {
				throw notFound(ctx.t, "member");
			}
			if (target.role === "owner") {
				throw forbidden(ctx.t);
			}

			await db
				.delete(organizationMember)
				.where(eq(organizationMember.memberId, input.memberId));

			return { ok: true as const };
		}),

	/**
	 * Caller leaves the organization. Owners must transfer ownership or
	 * delete the org instead — see `errors.orgOwnerCannotLeave`.
	 */
	leave: protectedProcedure
		.input(z.object({ organizationId: z.string().min(1) }))
		.mutation(async ({ input, ctx }) => {
			const role = await assertMember(
				ctx.user.id,
				input.organizationId,
				ctx.t,
			);
			if (role === "owner") {
				throw badRequest(ctx.t, "errors.orgOwnerCannotLeave");
			}

			await db
				.delete(organizationMember)
				.where(
					and(
						eq(organizationMember.organizationId, input.organizationId),
						eq(organizationMember.userId, ctx.user.id),
					),
				);

			return { ok: true as const };
		}),
});
