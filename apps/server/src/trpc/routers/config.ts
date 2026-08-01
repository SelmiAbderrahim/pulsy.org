import { protectedProcedure, router } from "../trpc";
import { REQUIRE_EMAIL_VERIFICATION } from "../../lib/auth-config";

// ---------------------------------------------------------------------------
// Authenticated read-only view of the server's email-verification policy. The
// web app reads this to decide whether to show the verify-email banner.
// The server .env remains the single source of truth.
// ---------------------------------------------------------------------------

export const configRouter = router({
	get: protectedProcedure.query(() => ({
		requireEmailVerification: REQUIRE_EMAIL_VERIFICATION,
	})),
});
