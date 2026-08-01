import type { Database } from "@pulsy/db";
import { db, user } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { initTRPC, TRPCError } from "@trpc/server";
import type { Request, Response } from "express";
import superjson from "superjson";
import { auth } from "../auth/auth";
import {
	getEffectiveLanguage,
	getTranslator,
	type SupportedLanguage,
	type Translator,
} from "../lib/i18n";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
type AuthUser = NonNullable<SessionResult>["user"];
type AuthSession = NonNullable<SessionResult>["session"];

export interface Context {
	db: Database;
	user: AuthUser | null;
	session: AuthSession | null;
	t: Translator;
	language: SupportedLanguage;
}

/** Build a WHATWG Headers object from Express request headers. */
export function toHeaders(req: Request): Headers {
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const v of value) headers.append(key, v);
		} else {
			headers.set(key, value);
		}
	}
	return headers;
}

export async function createContext({
	req,
}: {
	req: Request;
	res: Response;
}): Promise<Context> {
	const headers = toHeaders(req);

	let sessionResult: SessionResult = null;
	try {
		sessionResult = await auth.api.getSession({ headers });
	} catch {
		sessionResult = null;
	}

	const acceptLanguage = req.headers["accept-language"];
	const language = getEffectiveLanguage({
		acceptLanguage: Array.isArray(acceptLanguage)
			? acceptLanguage[0]
			: acceptLanguage,
	});
	const t = getTranslator(language);

	return {
		db,
		user: sessionResult?.user ?? null,
		session: sessionResult?.session ?? null,
		t,
		language,
	};
}

export type AppContext = Context;

// ---------------------------------------------------------------------------
// tRPC init
// ---------------------------------------------------------------------------

const t = initTRPC.context<Context>().create({
	transformer: superjson,
	/* v8 ignore next 3 -- tRPC error formatter; exercised at the HTTP transport layer, not via createCaller */
	errorFormatter({ shape }) {
		return shape;
	},
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;
// Exposed for tests: lets the test harness build a type-safe caller around the
// app router with a fabricated Context (no HTTP / better-auth round-trip).
export const createCallerFactory = t.createCallerFactory;

const enforceAuthed = t.middleware(({ ctx, next }) => {
	if (!ctx.user || !ctx.session) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: ctx.t("errors.unauthorized"),
		});
	}
	return next({
		ctx: {
			...ctx,
			// Narrow the types so downstream procedures see non-null user/session.
			user: ctx.user,
			session: ctx.session,
		},
	});
});

export const protectedProcedure = t.procedure.use(enforceAuthed);

// adminProcedure — protectedProcedure plus a platform-superadmin gate. The role
// is re-read from the DB on every call (not trusted from the session) so a
// demotion or ban takes effect immediately, even on an unexpired session. This
// is the single sanctioned place where queries are NOT user-scoped — the
// admin surface reads across all users by design, and `enforceAdmin` is the
// gate that authorizes it.
const enforceAdmin = protectedProcedure.use(async ({ ctx, next }) => {
	const row = await ctx.db.query.user.findFirst({
		where: eq(user.id, ctx.user.id),
	});
	if (!row || row.role !== "superadmin" || row.banned) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: ctx.t("errors.forbidden"),
		});
	}
	return next();
});

export const adminProcedure = enforceAdmin;
