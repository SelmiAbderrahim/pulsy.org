import { describe, expect, it } from "vitest";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
import { REQUIRE_EMAIL_VERIFICATION } from "../../../lib/auth-config";

// ---------------------------------------------------------------------------
// config.get is a protectedProcedure returning the server's email-verification
// policy. No DB access — a fabricated authed context is enough.
// ---------------------------------------------------------------------------

describe("config.get", () => {
	it("returns the requireEmailVerification policy for an authed user", async () => {
		const caller = authedCaller({ id: "cfg-user" });
		const result = await caller.config.get();
		expect(result).toEqual({
			requireEmailVerification: REQUIRE_EMAIL_VERIFICATION,
		});
		// The value is a boolean derived from the env at module load.
		expect(typeof result.requireEmailVerification).toBe("boolean");
	});

	it("rejects an unauthenticated caller with UNAUTHORIZED", async () => {
		const caller = publicCaller();
		await expect(caller.config.get()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});
});
