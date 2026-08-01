// ---------------------------------------------------------------------------
// admin.* router — the /superadmin operator surface.
//
// Every procedure is an `adminProcedure`: protectedProcedure + a DB-re-read
// superadmin gate (see ../trpc.ts). These are the ONLY procedures in the app
// that read across all users without a `ctx.user.id` scope — that is the whole
// point of an admin panel, and `adminProcedure` is the authorization that makes
// it safe.
// ---------------------------------------------------------------------------

import { and, count, desc, eq, gte, ilike, inArray, isNull, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
	apiKey as apiKeyTable,
	db,
	session as sessionTable,
	uptimeMonitor,
	user as userTable,
} from "@pulsy/db";

import { adminProcedure, router } from "../trpc";
import type { Translator } from "../../lib/i18n";

// ---------------------------------------------------------------------------
// Shared schemas + constants
// ---------------------------------------------------------------------------

const PLATFORM_ROLE = z.enum(["user", "superadmin"]);

const paginationShape = {
	limit: z.number().int().min(1).max(100).default(25),
	offset: z.number().int().min(0).default(0),
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** How many superadmins exist platform-wide (guards "don't lock yourself out"). */
function countSuperadmins(): Promise<number> {
	return db.$count(userTable, eq(userTable.role, "superadmin"));
}

/**
 * Reject acting on your own account (demote/ban/delete self). This is also the
 * lockout guard: a superadmin can only ever act on *other* accounts, so the
 * acting superadmin always survives — the platform can never reach zero
 * superadmins through these mutations.
 */
function assertNotSelf(callerId: string, targetId: string, t: Translator): void {
	if (callerId === targetId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: t("errors.cannotModifySelf"),
		});
	}
}

/** Load a user row or throw a plain NOT_FOUND (never reveal which field missed). */
async function getUserOr404(
	userId: string,
	t: Translator,
): Promise<typeof userTable.$inferSelect> {
	const row = await db.query.user.findFirst({
		where: eq(userTable.id, userId),
	});
	if (!row) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: t("errors.notFound", { resource: "user" }),
		});
	}
	return row;
}

// ---------------------------------------------------------------------------
// stats.*
// ---------------------------------------------------------------------------

const statsRouter = router({
	overview: adminProcedure.query(async () => {
		const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);

		const [
			totalUsers,
			newUsers30d,
			bannedUsers,
			superadmins,
			totalMonitors,
			activeMonitors,
		] = await Promise.all([
			db.$count(userTable),
			db.$count(userTable, gte(userTable.createdAt, thirtyDaysAgo)),
			db.$count(userTable, eq(userTable.banned, true)),
			countSuperadmins(),
			db.$count(uptimeMonitor),
			db.$count(uptimeMonitor, eq(uptimeMonitor.active, true)),
		]);

		const byStatus = await db
			.select({ status: uptimeMonitor.status, value: count() })
			.from(uptimeMonitor)
			.groupBy(uptimeMonitor.status);

		return {
			users: {
				total: totalUsers,
				new30d: newUsers30d,
				banned: bannedUsers,
				superadmins,
			},
			monitors: {
				total: totalMonitors,
				active: activeMonitors,
				byStatus: byStatus.map((r) => ({ status: r.status, count: r.value })),
			},
		};
	}),
});

// ---------------------------------------------------------------------------
// users.*
// ---------------------------------------------------------------------------

const usersRouter = router({
	list: adminProcedure
		.input(
			z.object({
				...paginationShape,
				search: z.string().trim().min(1).max(200).optional(),
				role: PLATFORM_ROLE.optional(),
				banned: z.boolean().optional(),
			}),
		)
		.query(async ({ input }) => {
			const conditions = [];
			if (input.search) {
				const pattern = `%${input.search}%`;
				conditions.push(
					or(
						ilike(userTable.email, pattern),
						ilike(userTable.name, pattern),
					),
				);
			}
			if (input.role) conditions.push(eq(userTable.role, input.role));
			if (input.banned !== undefined) {
				conditions.push(eq(userTable.banned, input.banned));
			}
			const where = conditions.length ? and(...conditions) : undefined;

			const rows = await db
				.select({
					id: userTable.id,
					name: userTable.name,
					email: userTable.email,
					emailVerified: userTable.emailVerified,
					role: userTable.role,
					banned: userTable.banned,
					bannedReason: userTable.bannedReason,
					createdAt: userTable.createdAt,
				})
				.from(userTable)
				.where(where)
				.orderBy(desc(userTable.createdAt))
				.limit(input.limit)
				.offset(input.offset);

			const total = await db.$count(userTable, where);

			const ids = rows.map((r) => r.id);
			const monitorsByUser = new Map<string, number>();
			if (ids.length > 0) {
				const monitorCounts = await db
					.select({ userId: uptimeMonitor.userId, value: count() })
					.from(uptimeMonitor)
					.where(inArray(uptimeMonitor.userId, ids))
					.groupBy(uptimeMonitor.userId);
				for (const m of monitorCounts) {
					monitorsByUser.set(m.userId, m.value);
				}
			}

			const items = rows.map((r) => ({
				...r,
				monitorCount: monitorsByUser.get(r.id) ?? 0,
			}));

			return { items, total, limit: input.limit, offset: input.offset };
		}),

	one: adminProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.query(async ({ input, ctx }) => {
			const target = await getUserOr404(input.userId, ctx.t);

			const monitorCount = await db.$count(
				uptimeMonitor,
				eq(uptimeMonitor.userId, input.userId),
			);

			return {
				user: {
					id: target.id,
					name: target.name,
					email: target.email,
					emailVerified: target.emailVerified,
					role: target.role,
					banned: target.banned,
					bannedReason: target.bannedReason,
					createdAt: target.createdAt,
				},
				monitorCount,
			};
		}),

	setRole: adminProcedure
		.input(z.object({ userId: z.string().min(1), role: PLATFORM_ROLE }))
		.mutation(async ({ input, ctx }) => {
			assertNotSelf(ctx.user.id, input.userId, ctx.t);
			await getUserOr404(input.userId, ctx.t);

			// The row exists (just fetched via getUserOr404) so .returning()[0]
			// is present — the `!` is an invariant assertion, not a runtime branch.
			const updated = (
				await db
					.update(userTable)
					.set({ role: input.role, updatedAt: new Date() })
					.where(eq(userTable.id, input.userId))
					.returning()
			)[0]!;
			return { id: updated.id, role: updated.role };
		}),

	ban: adminProcedure
		.input(
			z.object({
				userId: z.string().min(1),
				reason: z.string().trim().max(500).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			assertNotSelf(ctx.user.id, input.userId, ctx.t);
			await getUserOr404(input.userId, ctx.t);

			const now = new Date();
			await db.transaction(async (tx) => {
				await tx
					.update(userTable)
					.set({
						banned: true,
						bannedReason: input.reason ?? null,
						updatedAt: now,
					})
					.where(eq(userTable.id, input.userId));

				// Invalidate every persistent authentication mechanism atomically.
				// Unbanning never clears revokedAt, so old credentials cannot become
				// valid again; the user must explicitly create replacement keys.
				await tx
					.delete(sessionTable)
					.where(eq(sessionTable.userId, input.userId));
				await tx
					.update(apiKeyTable)
					.set({ revokedAt: now.toISOString() })
					.where(
						and(
							eq(apiKeyTable.userId, input.userId),
							isNull(apiKeyTable.revokedAt),
						),
					);
			});

			return { id: input.userId, banned: true };
		}),

	unban: adminProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.mutation(async ({ input, ctx }) => {
			await getUserOr404(input.userId, ctx.t);
			await db
				.update(userTable)
				.set({ banned: false, bannedReason: null, updatedAt: new Date() })
				.where(eq(userTable.id, input.userId));
			return { id: input.userId, banned: false };
		}),

	delete: adminProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.mutation(async ({ input, ctx }) => {
			assertNotSelf(ctx.user.id, input.userId, ctx.t);
			await getUserOr404(input.userId, ctx.t);

			await db.delete(userTable).where(eq(userTable.id, input.userId));
			return { id: input.userId, deleted: true };
		}),
});

// ---------------------------------------------------------------------------
// admin router
// ---------------------------------------------------------------------------

export const adminRouter = router({
	stats: statsRouter,
	users: usersRouter,
});
