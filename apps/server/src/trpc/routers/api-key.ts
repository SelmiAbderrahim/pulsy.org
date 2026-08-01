// ---------------------------------------------------------------------------
// apiKey.* router.
//
// Dashboard-facing CRUD for the user's public-API keys. The dashboard manages
// keys over the SAME session auth as everything else (these are
// `protectedProcedure`s); the keys themselves authenticate the separate
// `/api/v1` REST surface. `create` returns the plaintext ONCE — it is never
// stored or returned again.
// ---------------------------------------------------------------------------

import { apiCreateApiKey, apiRevokeApiKey } from "@pulsy/db";
import { TRPCError } from "@trpc/server";
import {
	createApiKey,
	listApiKeys,
	revokeApiKey,
} from "../../services/api-keys/api-key-service";
import { protectedProcedure, router } from "../trpc";

export const apiKeyRouter = router({
	/** The caller's keys (masked: no secret hash, no plaintext). */
	list: protectedProcedure.query(async ({ ctx }) => {
		return listApiKeys(ctx.user.id);
	}),

	/** Create a key; returns the plaintext exactly once alongside the row. */
	create: protectedProcedure
		.input(apiCreateApiKey)
		.mutation(async ({ ctx, input }) => {
			const { row, plaintext } = await createApiKey(ctx.user.id, input.name);
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
