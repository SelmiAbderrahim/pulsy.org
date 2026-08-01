// ---------------------------------------------------------------------------
// Email-verification policy - read from the environment once at module load.
//
// REQUIRE_EMAIL_VERIFICATION (default: true)
//   When true, a verification email is sent on signup. Verification is an auth
//   hardening setting only; it does not limit monitor creation or hide features.
// ---------------------------------------------------------------------------

export const REQUIRE_EMAIL_VERIFICATION =
	(process.env.REQUIRE_EMAIL_VERIFICATION ?? "true").toLowerCase() !== "false";

export const PUBLIC_WEB_URL =
	process.env.PUBLIC_WEB_URL ?? "http://localhost:3000";
