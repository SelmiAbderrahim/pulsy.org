import { db, account, session, user, verification } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sendAuthEmail } from "./email";
import { PUBLIC_WEB_URL, REQUIRE_EMAIL_VERIFICATION } from "../lib/auth-config";

// ---------------------------------------------------------------------------
// better-auth — email/password + sessions only.
//
// Organizations:
//   Pulsy's optional account grouping uses our own `organization` /
//   `organization_member` tables (declared in
//   `packages/db/src/schema/organization.ts`) exposed through the
//   `organization.*` tRPC router. We intentionally do NOT enable better-auth's
//   organization plugin: it ships its own divergent schema (different
//   table/column names, its own invite flow, its own routes) and reconciling it
//   would require destructive migrations to our already-populated tables. The
//   plugin's routes would also bypass the ownership guards that live in our
//   tRPC procedures.
// ---------------------------------------------------------------------------

const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? PUBLIC_WEB_URL;

// Fail fast at startup instead of letting better-auth fall back to an insecure
// missing-secret mode — no fallback defaults.
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
if (!BETTER_AUTH_SECRET || /^replace[-_]?with/i.test(BETTER_AUTH_SECRET)) {
	throw new Error(
		"BETTER_AUTH_SECRET is required (and must not be the .env.example placeholder). " +
			"Generate one with `openssl rand -base64 32` and set it in the root .env.",
	);
}

function splitOrigins(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}

function localLoopbackAliases(origin: string): string[] {
	try {
		const url = new URL(origin);
		if (url.hostname === "localhost") {
			url.hostname = "127.0.0.1";
			return [url.toString().replace(/\/$/, "")];
		}
		if (url.hostname === "127.0.0.1") {
			url.hostname = "localhost";
			return [url.toString().replace(/\/$/, "")];
		}
	} catch {
		return [];
	}
	return [];
}

const trustedOrigins = Array.from(
	new Set(
		[PUBLIC_WEB_URL, BETTER_AUTH_URL, ...splitOrigins(process.env.TRUSTED_ORIGINS)]
			.flatMap((origin) => [origin, ...localLoopbackAliases(origin)])
			.map((origin) => origin.replace(/\/$/, "")),
	),
);

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: { user, session, account, verification },
	}),
	secret: BETTER_AUTH_SECRET,
	baseURL: BETTER_AUTH_URL,
	trustedOrigins,
	// Explicit auth throttling. better-auth's limiter is enabled-by-NODE_ENV
	// otherwise; pin it on so a dev/misconfigured deployment is still covered.
	// better-auth applies stricter built-in rules to sensitive paths (sign-in,
	// sign-up, forget-password) within this window.
	rateLimit: {
		enabled: true,
		window: 60,
		max: 60,
	},
	// Platform role + ban ride on the session's `user` object so the client can
	// gate the /superadmin nav. Both are `input: false` — a signing-up account
	// can never set its own role or unban itself. The authoritative authz check
	// is the `adminProcedure` DB re-read in trpc.ts, not these session fields.
	user: {
		additionalFields: {
			role: { type: "string", input: false, defaultValue: "user" },
			banned: { type: "boolean", input: false, defaultValue: false },
		},
	},
	// Refuse a fresh session for a banned account. Existing sessions are deleted
	// at ban time by the admin `users.ban` mutation, so this closes the re-login
	// path. (auth.ts is coverage-excluded; the testable enforcement lives in the
	// admin router + adminProcedure.)
	databaseHooks: {
		session: {
			create: {
				before: async (newSession) => {
					const owner = await db.query.user.findFirst({
						where: eq(user.id, newSession.userId),
					});
					if (owner?.banned) {
						throw new APIError("FORBIDDEN", {
							message: "This account has been suspended.",
						});
					}
					return { data: newSession };
				},
			},
		},
	},
	emailAndPassword: {
		enabled: true,
		// Operator switch for shared/demo instances: refuse new registrations
		// server-side (the login page stays usable with existing accounts).
		disableSignUp: process.env.DISABLE_SIGNUP === "true",
		requireEmailVerification: false,
		sendResetPassword: async ({ user: u, url }) => {
			await sendAuthEmail({
				to: u.email,
				subject: "Reset your Pulsy password",
				html: `
					<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
						<h2 style="margin: 0 0 16px 0;">Reset your password</h2>
						<p>We received a request to reset your Pulsy password. Click the button below to choose a new one.</p>
						<p style="margin: 24px 0;">
							<a href="${url}" style="background: #0f172a; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">Reset password</a>
						</p>
						<p style="color: #64748b; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
					</div>
				`,
			});
		},
	},
	emailVerification: {
		// Controlled by REQUIRE_EMAIL_VERIFICATION. We deliberately keep
		// requireEmailVerification false above so self-hosted users can sign in
		// and use Pulsy while the verification email is in flight.
		sendOnSignUp: REQUIRE_EMAIL_VERIFICATION,
		autoSignInAfterVerification: true,
		sendVerificationEmail: async ({ user: u, url }) => {
			await sendAuthEmail({
				to: u.email,
				subject: "Verify your Pulsy email",
				html: `
					<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
						<h2 style="margin: 0 0 16px 0;">Verify your email</h2>
						<p>Confirm your email address to finish setting up your Pulsy account.</p>
						<p style="margin: 24px 0;">
							<a href="${url}" style="background: #0f172a; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">Verify email</a>
						</p>
						<p style="color: #64748b; font-size: 12px;">If you didn't create a Pulsy account, you can ignore this email.</p>
					</div>
				`,
			});
		},
	},
	session: {
		// 72 hours
		expiresIn: 60 * 60 * 24 * 3,
	},
});

export type Auth = typeof auth;
