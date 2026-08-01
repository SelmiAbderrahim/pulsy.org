import { db } from "@pulsy/db";
import type { Context } from "../src/trpc/trpc";
import { createCallerFactory } from "../src/trpc/trpc";
import { appRouter } from "../src/trpc/router";
import { getTranslator, type SupportedLanguage } from "../src/lib/i18n";

// ---------------------------------------------------------------------------
// Build a type-safe tRPC caller around a fabricated Context — no Express, no
// better-auth session round-trip. Lets router tests exercise every procedure,
// including auth/ownership/limit branches, directly against the real DB.
// ---------------------------------------------------------------------------

const createCaller = createCallerFactory(appRouter);

type CtxUser = NonNullable<Context["user"]>;
type CtxSession = NonNullable<Context["session"]>;
type TestCaller = ReturnType<typeof createCaller>;

export function buildContext(
	overrides: Partial<Context> & { language?: SupportedLanguage } = {},
): Context {
	const language = overrides.language ?? "en";
	return {
		db,
		user: overrides.user ?? null,
		session: overrides.session ?? null,
		t: overrides.t ?? getTranslator(language),
		language,
	};
}

/** Caller acting as an authenticated user (only `id`/`emailVerified` matter). */
export function authedCaller(opts: {
	id: string;
	emailVerified?: boolean;
	email?: string;
	language?: SupportedLanguage;
}): TestCaller {
	const user = {
		id: opts.id,
		email: opts.email ?? `${opts.id}@pulsy.test`,
		emailVerified: opts.emailVerified ?? true,
		name: "Test User",
		createdAt: new Date(),
		updatedAt: new Date(),
	} as unknown as CtxUser;

	const session = {
		id: `sess_${opts.id}`,
		userId: opts.id,
		token: `token_${opts.id}`,
		expiresAt: new Date(Date.now() + 3_600_000),
		createdAt: new Date(),
		updatedAt: new Date(),
	} as unknown as CtxSession;

	return createCaller(buildContext({ user, session, language: opts.language }));
}

/** Caller with no session — exercises the unauthenticated/public path. */
export function publicCaller(language?: SupportedLanguage): TestCaller {
	return createCaller(buildContext({ language }));
}
