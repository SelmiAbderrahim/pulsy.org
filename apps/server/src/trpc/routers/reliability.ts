import { readReliabilityIncidents } from "../../services/uptime/reliability-incidents";
import { apiReliabilityAnnotation, apiReliabilityConfiguration, apiReliabilityWindow } from "@pulsy/db";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { annotateReliability, configureReliability, listReliabilityAnnotations, listReliabilityPolicies, readReliability } from "../../services/uptime/reliability-service";
export const reliabilityIdentity = z.object({ monitorId: z.string().min(1).max(64) }).strict();
export const reliabilityAnnotationListInput = z.object({ window: apiReliabilityWindow, limit: z.number().int().min(1).max(100).default(25), cursor: z.object({ at: z.string().max(40).datetime({ offset: true }).transform(value => new Date(value).toISOString()), id: z.string().min(1).max(64) }).strict().optional() }).strict();
const procedure = protectedProcedure.use(async ({ ctx, next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.reliabilityInvalid") });
  return result;
});
export const reliabilityRouter = router({
  configure: procedure.input(reliabilityIdentity.extend({ configuration: apiReliabilityConfiguration })).mutation(({ ctx, input }) => configureReliability(ctx.user.id, input.monitorId, input.configuration, ctx.t)),
  read: procedure.input(reliabilityIdentity.extend({ window: apiReliabilityWindow })).query(({ ctx, input }) => readReliability(ctx.user.id, input.monitorId, input.window, ctx.t)),
  annotate: procedure.input(reliabilityIdentity.extend({ annotation: apiReliabilityAnnotation })).mutation(({ ctx, input }) => annotateReliability(ctx.user.id, input.monitorId, input.annotation, ctx.t)),
  annotations: procedure.input(reliabilityIdentity.merge(reliabilityAnnotationListInput)).query(({ ctx, input }) => listReliabilityAnnotations(ctx.user.id, input.monitorId, input, ctx.t)),
  incidents: procedure.input(reliabilityIdentity.extend({ window: apiReliabilityWindow, limit: z.number().int().min(1).max(100).default(25), cursor: z.object({ startedAt: z.string().max(40).datetime({ offset: true }).transform(value => new Date(value).toISOString()), id: z.string().min(1).max(64) }).strict().optional() })).query(({ ctx, input }) => readReliabilityIncidents(ctx.user.id, input.monitorId, input, ctx.t)),
  policies: procedure.input(reliabilityIdentity.extend({ limit: z.number().int().min(1).max(100).default(25), beforeVersion: z.number().int().min(1).optional() })).query(({ ctx, input }) => listReliabilityPolicies(ctx.user.id, input.monitorId, input, ctx.t)),
});
