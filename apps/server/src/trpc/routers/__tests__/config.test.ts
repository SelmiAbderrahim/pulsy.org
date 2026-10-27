import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { describe, expect, it } from "vitest";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";
import { REQUIRE_EMAIL_VERIFICATION } from "../../../lib/auth-config";

// ---------------------------------------------------------------------------
// config.get is a protectedProcedure returning the server's email-verification
// policy and the persisted account timezone.
// ---------------------------------------------------------------------------

useCleanDatabase();

describe("config.get", () => {
	it("returns the requireEmailVerification policy for an authed user", async () => {
		const caller = authedCaller(await createTestUser());
		const result = await caller.config.get();
		expect(result).toEqual({
			requireEmailVerification: REQUIRE_EMAIL_VERIFICATION,
      timezone: null,
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

  it("persists only the caller's validated IANA timezone and supports resetting it", async () => {
    const owner = await createTestUser(), other = await createTestUser();
    const caller = authedCaller(owner);
    await caller.config.setTimezone({ timezone: "Africa/Tunis" });
    expect((await caller.config.get()).timezone).toBe("Africa/Tunis");
    expect((await authedCaller(other).config.get()).timezone).toBeNull();
    await expect(caller.config.setTimezone({ timezone: "invalid/zone" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await caller.config.get()).timezone).toBe("Africa/Tunis");
    await caller.config.setTimezone({ timezone: null });
    expect((await caller.config.get()).timezone).toBeNull();
  });
  it("requires authentication for reads and writes", async () => {
    await expect(publicCaller().config.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(publicCaller().config.setTimezone({ timezone: "UTC" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
