import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { exportMonitorConfiguration, previewMonitorConfiguration, applyMonitorConfiguration } from "../../services/uptime/monitor-portability";
export const manifestTextInput = z.object({ text: z.string().min(1).max(262144) }).strict();
export const manifestExportInput = z.object({ monitorIds: z.array(z.string().min(1).max(64)).min(1).max(200) }).strict();
export const manifestApplyInput = manifestTextInput.extend({ revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const procedure = protectedProcedure.use(async ({ ctx, next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof z.ZodError)
    throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.manifestInvalid") });
  return result;
});
export const monitorPortabilityRouter = router({
  export: procedure.input(manifestExportInput).mutation(({ ctx, input }) => exportMonitorConfiguration(ctx.user.id, input.monitorIds, ctx.t)),
  preview: procedure.input(manifestTextInput).mutation(({ ctx, input }) => previewMonitorConfiguration(ctx.user.id, input.text, ctx.t)),
  reconcile: procedure.input(manifestApplyInput).mutation(({ ctx, input }) => applyMonitorConfiguration(ctx.user.id, input.text, input.revision, ctx.t)),
});
