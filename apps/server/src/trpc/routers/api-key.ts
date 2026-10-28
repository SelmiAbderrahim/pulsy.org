import { z } from "zod";
// ---------------------------------------------------------------------------
// apiKey.* router.
//
// Dashboard-facing CRUD for the user's public-API keys. The dashboard manages
// keys over the SAME session auth as everything else (these are
// `protectedProcedure`s); the keys themselves authenticate the separate
// `/api/v1` REST surface. `create` returns the plaintext ONCE — it is never
// stored or returned again. Scope controls only which API operations the key may perform.
// ---------------------------------------------------------------------------

import { apiCreateApiKey, apiRevokeApiKey } from "@pulsy/db";
import { TRPCError } from "@trpc/server";
import {
	createApiKey,
  removeApiKey,
	listApiKeys,
	revokeApiKey,
} from "../../services/api-keys/api-key-service";
import { protectedProcedure, router } from "../trpc";

export const apiKeyRouter = router({
  remove: protectedProcedure.input(apiRevokeApiKey).mutation(async ({ ctx, input }) => {
    if (!await removeApiKey(ctx.user.id, input.apiKeyId)) {
      throw new TRPCError({ code: "NOT_FOUND", message: ctx.t("errors.apiKeyNotFound") });
    }
    return { success: true };
  }),

	/** The caller's keys (masked: no secret hash, no plaintext). */
	list: protectedProcedure.query(async ({ ctx }) => {
		return listApiKeys(ctx.user.id);
	}),

	/** Create a key; returns the plaintext exactly once alongside the row. */
	create: protectedProcedure.use(async ({ ctx, next }) => {
      const result = await next();
      if (!result.ok && result.error.cause instanceof z.ZodError && result.error.cause.issues.some(issue => issue.path[0] === "expiresAt")) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.apiKeyExpiry"), cause: result.error.cause });
      return result;
    })
		.input(apiCreateApiKey)
		.mutation(async ({ ctx, input }) => {
			const { row, plaintext } = await createApiKey(ctx.user.id, input.name, undefined, ctx.t, { scope: input.scope, expiresAt: input.expiresAt });
			return { ...row, plaintext };
		}),

	/** Revoke a key the caller owns. Unknown/foreign/already-revoked → NOT_FOUND. */
	revoke: protectedProcedure
		.input(apiRevokeApiKey)
		.mutation(async ({ ctx, input }) => {
			const ok = await revokeApiKey(ctx.user.id, input.apiKeyId);
			if (!ok) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: ctx.t("errors.apiKeyNotFound"),
				});
			}
			return { success: true };
		}),
});
