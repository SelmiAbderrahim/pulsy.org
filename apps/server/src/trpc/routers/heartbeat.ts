import { apiHeartbeatConfiguration, apiHeartbeatId, db, uptimeMonitor, uptimeHeartbeat } from "@pulsy/db";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import {
	createHeartbeatForUser,
	listHeartbeatRuns,
	readHeartbeatForUser,
	rotateHeartbeatToken,
	revealHeartbeatToken,
} from "../../services/uptime/heartbeat-service";
import { toOwnerMonitor } from "../../services/uptime/http-config";

const procedure = protectedProcedure.use(async ({ ctx, next }) => {
	const result = await next();
	if (!result.ok && result.error.cause instanceof z.ZodError) {
		throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.heartbeatInvalid"), cause: result.error.cause });
	}
	return result;
});

export const heartbeatRouter = router({
	create: procedure.input(apiHeartbeatConfiguration).mutation(async ({ ctx, input }) => {
		const result = await createHeartbeatForUser(input, ctx.user.id, ctx.t);
		return { monitor: toOwnerMonitor(result.monitor), token: result.token };
	}),
	one: procedure.input(apiHeartbeatId).query(({ ctx, input }) =>
		readHeartbeatForUser(input.monitorId, ctx.user.id, ctx.t)),
	rotate: procedure.input(apiHeartbeatId).mutation(({ ctx, input }) =>
		rotateHeartbeatToken(input.monitorId, ctx.user.id, ctx.t)),
	reveal: procedure.input(apiHeartbeatId).mutation(({ ctx, input }) =>
		revealHeartbeatToken(input.monitorId, ctx.user.id, ctx.t)),
	runs: procedure.input(apiHeartbeatId.extend({ limit: z.number().int().min(1).max(100).default(50) }))
		.query(({ ctx, input }) => listHeartbeatRuns(input.monitorId, ctx.user.id, ctx.t, input.limit)),
	update: procedure.input(apiHeartbeatConfiguration.extend({ monitorId: z.string().min(1).max(64) }))
		.mutation(async ({ ctx, input }) => db.transaction(async tx => {
			// Every heartbeat mutation locks the owned parent before its configuration.
			const scope = and(
				eq(uptimeMonitor.uptimeMonitorId, input.monitorId),
				eq(uptimeMonitor.userId, ctx.user.id),
				eq(uptimeMonitor.monitorType, "heartbeat"),
			);
			const [monitor] = await tx.select().from(uptimeMonitor).where(scope).for("update");
			if (!monitor) throw new TRPCError({ code: "NOT_FOUND", message: ctx.t("errors.notFound", { resource: "monitor" }) });
			const heartbeatScope = and(eq(uptimeHeartbeat.monitorId, input.monitorId), eq(uptimeHeartbeat.userId, ctx.user.id));
			const [configuration] = await tx.select().from(uptimeHeartbeat).where(heartbeatScope).for("update");
			if (!configuration) throw new TRPCError({ code: "NOT_FOUND", message: ctx.t("errors.notFound", { resource: "monitor" }) });

			const changed = input.interval !== monitor.interval || input.graceSeconds !== configuration.graceSeconds;
			const resumed = !monitor.active && input.active;
			// Resuming starts a fresh interval. Schedule edits use the authoritative
			// success/creation baseline, and never fabricate a receipt or restore health.
			const expectedAt = resumed
				? new Date(Date.now() + input.interval * 1000).toISOString()
				: changed
					? new Date(Date.parse(configuration.lastSuccessAt ?? monitor.createdAt) + input.interval * 1000).toISOString()
					: configuration.expectedAt;
			const explicitlyFailed = monitor.status === "down" && configuration.nextDeadline === null && !!configuration.lastFailAt
				&& (!configuration.lastSuccessAt || configuration.lastFailAt >= configuration.lastSuccessAt);
			const nextDeadline = explicitlyFailed ? null : changed || resumed ? expectedAt : configuration.nextDeadline;
			await tx.update(uptimeHeartbeat).set({ graceSeconds: input.graceSeconds, expectedAt, nextDeadline }).where(heartbeatScope);
			const [updated] = await tx.update(uptimeMonitor).set({
				name: input.name,
				interval: input.interval,
				active: input.active,
				tags: input.tags,
				nextCheckAt: nextDeadline,
			}).where(scope).returning();
			if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: ctx.t("errors.internal") });
			return toOwnerMonitor(updated);
		})),
});
