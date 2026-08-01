// ---------------------------------------------------------------------------
// Scope resolver.
//
// Pulsy keeps per-user scoping as the source of truth. Team plans layer an
// `organizationId` on top: when a procedure is invoked in an org context
// (the caller passes an `organizationId`), the helper verifies that the
// caller is a member of that org and returns it alongside `userId`.
//
// Defaults (no `organizationId` passed) reproduce today's behavior verbatim:
// `{ userId, organizationId: undefined }` — every existing query that filters
// by `ctx.user.id` keeps working unchanged.
//
// IMPORTANT: this helper is the ONLY way org context enters a procedure. It
// performs the membership check; callers MUST NOT trust an `organizationId`
// from the wire without going through `resolveScope`.
// ---------------------------------------------------------------------------

import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Database } from "@pulsy/db";
import { organization, organizationMember } from "@pulsy/db";
import type { Translator } from "./i18n";

export interface ResolvedScope {
	/** Caller's user id. Always set. */
	userId: string;
	/**
	 * Organization id when the caller acts on org-scoped resources. Undefined
	 * for the personal scope (= today's behavior).
	 */
	organizationId?: string;
}

export interface ResolveScopeOptions {
	/** Optional org id the caller wishes to act within. */
	organizationId?: string | null;
}

/**
 * Resolve the scope for the current call.
 *
 * When `organizationId` is null/undefined the caller stays in their personal
 * scope. When it is provided, the helper verifies the org exists and the
 * caller is a member; otherwise it throws `errors.notOrgMember`.
 */
export async function resolveScope(
	db: Database,
	userId: string,
	t: Translator,
	opts: ResolveScopeOptions = {},
): Promise<ResolvedScope> {
	const orgId = opts.organizationId;
	if (!orgId) {
		return { userId };
	}

	const orgRow = await db.query.organization.findFirst({
		where: eq(organization.organizationId, orgId),
		columns: { organizationId: true },
	});
	if (!orgRow) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: t("errors.notFound", { resource: "organization" }),
		});
	}

	const membership = await db.query.organizationMember.findFirst({
		where: and(
			eq(organizationMember.organizationId, orgId),
			eq(organizationMember.userId, userId),
		),
		columns: { memberId: true },
	});
	if (!membership) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: t("errors.notOrgMember"),
		});
	}

	return { userId, organizationId: orgId };
}

/**
 * True when the caller is a member of the org (any role). Pure read — does
 * not throw. Useful for procedures that need to silently filter results.
 */
export async function isOrgMember(
	db: Database,
	userId: string,
	organizationId: string,
): Promise<boolean> {
	const row = await db.query.organizationMember.findFirst({
		where: and(
			eq(organizationMember.organizationId, organizationId),
			eq(organizationMember.userId, userId),
		),
		columns: { memberId: true },
	});
	return Boolean(row);
}

/**
 * Resolve the caller's role within an org, or `null` if they are not a member.
 */
export async function getOrgMemberRole(
	db: Database,
	userId: string,
	organizationId: string,
): Promise<"owner" | "admin" | "member" | null> {
	const row = await db.query.organizationMember.findFirst({
		where: and(
			eq(organizationMember.organizationId, organizationId),
			eq(organizationMember.userId, userId),
		),
		columns: { role: true },
	});
	return row?.role ?? null;
}
