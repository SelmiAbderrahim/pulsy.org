// ---------------------------------------------------------------------------
// Superadmin seeder (testable core).
//
// `ensureSuperadmin` is idempotent: it creates the operator account from the
// SUPERADMIN_* credentials (via better-auth so the password is hashed the same
// way as any sign-up), then promotes that user to `role = "superadmin"` and
// marks the email verified. Re-running is a no-op once the account is already a
// verified superadmin.
//
// When the credentials are absent it logs and returns `skipped` — a fresh
// self-host without SUPERADMIN_* env boots normally with no admin account.
//
// The thin runner that wires this to the real `db` + better-auth `auth` and
// `process.exit`s lives in ../seed-superadmin.ts (coverage-excluded).
// ---------------------------------------------------------------------------

import { eq } from "drizzle-orm";
import type { Database } from "@pulsy/db";
import { user as userTable } from "@pulsy/db";
import { safeErrorSummary } from "../lib/safe-error";

/** The single better-auth method the seeder needs — keeps this module testable
 *  without importing the full better-auth wiring. */
export interface SuperadminAuth {
	api: {
		signUpEmail: (args: {
			body: { email: string; password: string; name: string };
		}) => Promise<unknown>;
	};
}

export interface EnsureSuperadminOptions {
	db: Database;
	auth: SuperadminAuth;
	email: string | undefined;
	password: string | undefined;
	name?: string;
	/** Optional sink for progress messages (defaults to a no-op). */
	log?: (message: string) => void;
}

export type EnsureSuperadminStatus =
	| "skipped"
	| "created"
	| "promoted"
	| "exists";

export interface EnsureSuperadminResult {
	status: EnsureSuperadminStatus;
	userId?: string;
}

export async function ensureSuperadmin(
	opts: EnsureSuperadminOptions,
): Promise<EnsureSuperadminResult> {
	const log = opts.log ?? (() => {});
	const email = opts.email?.trim();
	const password = opts.password;

	if (!email || !password) {
		log("[superadmin] SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD not set; skipping.");
		return { status: "skipped" };
	}

	const name = opts.name?.trim() || "Superadmin";

	let created = false;
	try {
		await opts.auth.api.signUpEmail({ body: { email, password, name } });
		created = true;
		log(`[superadmin] Created account ${email}.`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		// better-auth throws when the account already exists — expected on re-run.
		if (/exist/i.test(message)) {
			log(`[superadmin] Account ${email} already exists.`);
		} else {
			log(`[superadmin] signUpEmail returned: ${safeErrorSummary(err)}`);
		}
	}

	const row = await opts.db.query.user.findFirst({
		where: eq(userTable.email, email),
	});
	if (!row) {
		throw new Error(`[superadmin] Could not find ${email} after sign-up.`);
	}

	// Already a verified superadmin → nothing to do. (A freshly created account
	// is never already a superadmin, so this path implies `created === false`.)
	if (row.role === "superadmin" && row.emailVerified) {
		return { status: "exists", userId: row.id };
	}

	await opts.db
		.update(userTable)
		.set({ role: "superadmin", emailVerified: true, updatedAt: new Date() })
		.where(eq(userTable.id, row.id));
	log(`[superadmin] Promoted ${email} to superadmin.`);
	return { status: created ? "created" : "promoted", userId: row.id };
}
