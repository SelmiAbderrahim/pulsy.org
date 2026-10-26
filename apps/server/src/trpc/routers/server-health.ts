import { apiServerConfiguration, apiServerHistory, apiServerId } from "@pulsy/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import {
	createServerForUser,
	readServerForUser,
	rotateServerCredential,
	serverHistoryForUser,
	updateServerForUser,
} from "../../services/uptime/server-health-service";
import { toOwnerMonitor } from "../../services/uptime/http-config";

const procedure = protectedProcedure.use(async ({ ctx, next }) => {
	const result = await next();
	if (!result.ok && result.error.cause instanceof z.ZodError) {
		throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.serverInvalid"), cause: result.error.cause });
	}
	return result;
});

export const serverHealthRouter = router({
	create: procedure.input(apiServerConfiguration).mutation(async ({ ctx, input }) => {
		const result = await createServerForUser(input, ctx.user.id, ctx.t, ctx.language);
		return { monitor: toOwnerMonitor(result.monitor), token: result.token };
	}),
	one: procedure.input(apiServerId).query(({ ctx, input }) =>
		readServerForUser(input.monitorId, ctx.user.id, ctx.t)),
	rotate: procedure.input(apiServerId).mutation(async ({ ctx, input }) => {
		const result = await rotateServerCredential(input.monitorId, ctx.user.id, ctx.t);
		return { token: result.token };
	}),
	history: procedure.input(apiServerHistory).query(({ ctx, input }) =>
		serverHistoryForUser(input, ctx.user.id, ctx.t)),
	update: procedure.input(apiServerConfiguration.extend({ monitorId: z.string().min(1).max(64) }))
		.mutation(async ({ ctx, input }) =>
			toOwnerMonitor(await updateServerForUser(input, ctx.user.id, ctx.t, ctx.language))),
});
