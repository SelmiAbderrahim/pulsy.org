import { channelDisplayTarget, decryptNotificationChannelSecrets } from "../../services/uptime/notification-channel-secrets";
import { apiMonitorTemplateConfiguration, apiSaveMonitorTemplate, db, uptimeMonitor, uptimeMonitorTemplate, uptimeMonitorChannelBinding, uptimeNotificationChannel, user } from "@pulsy/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { assertOwnedChannelReferences } from "../../services/uptime/channel-bindings";
import { redactIncidentText } from "../../services/uptime/incident-text";
import { assertMonitorHostAllowed } from "../../services/uptime/egress-input";
const procedure = protectedProcedure.use(async ({ ctx, next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.monitorTemplateInvalid"), cause: result.error.cause });
  return result;
});
const idInput = z.object({ id: z.string().min(1).max(64) }).strict();
export const monitorTemplatesRouter = router({
  list: protectedProcedure.query(({ ctx }) => db.select().from(uptimeMonitorTemplate).where(eq(uptimeMonitorTemplate.userId, ctx.user.id)).orderBy(asc(uptimeMonitorTemplate.name), asc(uptimeMonitorTemplate.id)).limit(200)),
  channels: protectedProcedure.query(async ({ ctx }) => {
    const channels = await db.select().from(uptimeNotificationChannel).where(eq(uptimeNotificationChannel.userId, ctx.user.id)).orderBy(asc(uptimeNotificationChannel.channelId));
    return channels.map(channel => ({
      id: channel.channelId, type: channel.channelType, monitorId: channel.uptimeMonitorId,
      destination: channelDisplayTarget(decryptNotificationChannelSecrets(channel)),
    }));
  }),
  fromMonitor: procedure.input(z.object({ monitorId: z.string().min(1).max(64) }).strict()).query(async ({ ctx, input }) => {
    const [monitor] = await db.select().from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, ctx.user.id), eq(uptimeMonitor.uptimeMonitorId, input.monitorId))).limit(1);
    if (!monitor) throw new TRPCError({ code: "NOT_FOUND", message: ctx.t("errors.notFound", { resource: "monitor" }) });
    if (monitor.monitorType !== "http") {
      if (!["dns", "tcp"].includes(monitor.monitorType) || monitor.networkConfig?.type !== monitor.monitorType) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.monitorTypeAction") });
      const configuration = apiMonitorTemplateConfiguration.parse({ monitorType: monitor.monitorType, networkConfig: monitor.networkConfig, timeout: monitor.timeout, interval: monitor.interval, failureThreshold: monitor.failureThreshold, tags: monitor.tags, latencyPolicy: monitor.latencyPolicy });
      return { name: monitor.name, configuration, needsRequestValues: false };
    }
    const assertions = monitor.httpAssertions.filter(rule => {
      const encoded = JSON.stringify(rule);
      return redactIncidentText(monitor, encoded, ctx.t) === encoded && !("name" in rule && /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(rule.name));
    });
    const configuration = apiMonitorTemplateConfiguration.parse({ method: monitor.method, expectedStatus: monitor.expectedStatus, expectedStatuses: monitor.expectedStatuses, tlsMonitoringEnabled: monitor.tlsMonitoringEnabled, timeout: monitor.timeout, interval: monitor.interval, failureThreshold: monitor.failureThreshold, tags: (monitor.tags ?? []).map(tag => redactIncidentText(monitor, tag, ctx.t)), httpAssertions: assertions, redirectPolicy: monitor.redirectPolicy, latencyPolicy: monitor.latencyPolicy });
    return { name: redactIncidentText(monitor, monitor.name, ctx.t), configuration, needsRequestValues: !!monitor.requestCipher || assertions.length !== monitor.httpAssertions.length };
  }),
  save: procedure.input(apiSaveMonitorTemplate).mutation(async ({ ctx, input }) => {
    const network = input.configuration.networkConfig;
    if (network) await assertMonitorHostAllowed(network.hostname, network.type, ctx.t);
    return db.transaction(async tx => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, ctx.user.id)).for("update");
    const owned = and(eq(uptimeMonitorTemplate.userId, ctx.user.id), ...(input.id ? [eq(uptimeMonitorTemplate.id, input.id)] : []));
    const [existing] = input.id ? await tx.select().from(uptimeMonitorTemplate).where(owned).limit(1) : [];
    if (input.id && !existing) throw new TRPCError({ code: "NOT_FOUND", message: ctx.t("errors.notFound", { resource: "template" }) });
    // Technical ceiling: 200 templates per account until paging is added.
    if (!existing && (await tx.select({ id: uptimeMonitorTemplate.id }).from(uptimeMonitorTemplate).where(eq(uptimeMonitorTemplate.userId, ctx.user.id)).limit(200)).length >= 200) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.monitorTemplateLimit") });
    await assertOwnedChannelReferences(tx, ctx.user.id, input.configuration.channelIds ?? [], ctx.t);
    const values = { name: input.name, configuration: input.configuration, needsRequestValues: input.needsRequestValues, updatedAt: new Date().toISOString() };
    const [saved] = existing ? await tx.update(uptimeMonitorTemplate).set(values).where(owned).returning() : await tx.insert(uptimeMonitorTemplate).values({ userId: ctx.user.id, ...values }).returning();
    return saved!;
    });
  }),
  detachChannel: procedure.input(z.object({ monitorId: z.string().min(1).max(64), channelId: z.string().min(1).max(64) }).strict()).mutation(({ ctx, input }) => db.transaction(async tx => {
    const [monitor] = await tx.select({ id: uptimeMonitor.uptimeMonitorId }).from(uptimeMonitor).where(and(eq(uptimeMonitor.userId, ctx.user.id), eq(uptimeMonitor.uptimeMonitorId, input.monitorId))).for("share");
    if (!monitor) throw new TRPCError({ code: "NOT_FOUND", message: ctx.t("errors.notFound", { resource: "monitor" }) });
    const [removed] = await tx.delete(uptimeMonitorChannelBinding).where(and(eq(uptimeMonitorChannelBinding.userId, ctx.user.id), eq(uptimeMonitorChannelBinding.monitorId, monitor.id), eq(uptimeMonitorChannelBinding.channelId, input.channelId))).returning({ id: uptimeMonitorChannelBinding.id });
    if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: ctx.t("errors.templateChannelMissing") });
    return { success: true };
  })),
  remove: procedure.input(idInput).mutation(async ({ ctx, input }) => {
    const [removed] = await db.delete(uptimeMonitorTemplate).where(and(eq(uptimeMonitorTemplate.userId, ctx.user.id), eq(uptimeMonitorTemplate.id, input.id))).returning({ id: uptimeMonitorTemplate.id });
    if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: ctx.t("errors.notFound", { resource: "template" }) });
    return removed;
  }),
});
