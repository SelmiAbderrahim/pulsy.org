import { protectedProcedure, router } from "../trpc";
import { REQUIRE_EMAIL_VERIFICATION } from "../../lib/auth-config";
import { db } from "@pulsy/db";
import { user } from "@pulsy/db/schema";
import { timezoneSchema } from "@pulsy/db/timezone";
import { eq } from "drizzle-orm";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Authenticated account preferences and view of the server's email-verification policy. The
// web app reads this to decide whether to show the verify-email banner.
// The server .env remains the single source of truth.
// ---------------------------------------------------------------------------

export const configRouter = router({
	get: protectedProcedure.query(async ({ ctx }) => {
    const account = await db.query.user.findFirst({ where: eq(user.id, ctx.user.id), columns: { timezone: true } });
    return { requireEmailVerification: REQUIRE_EMAIL_VERIFICATION, timezone: account?.timezone ?? null };
  }),
  setTimezone: protectedProcedure.input(z.object({ timezone: timezoneSchema.nullable() }).strict()).mutation(async ({ ctx, input }) => {
    await db.update(user).set({ timezone: input.timezone, updatedAt: new Date() }).where(eq(user.id, ctx.user.id));
    return { timezone: input.timezone };
  }),
});
