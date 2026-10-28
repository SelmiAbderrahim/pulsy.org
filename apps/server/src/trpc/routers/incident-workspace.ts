import { maskNotificationChannel } from "../../services/uptime/notification-channel-secrets";
import { apiIncidentIdentity, apiIncidentWorkspaceList, apiIncidentNote, apiIncidentRunbook, apiIncidentGroup, apiIncidentEscalation, db, uptimeMonitor, uptimeNotificationChannel } from "@pulsy/db";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { unacknowledgeIncident, acknowledgeIncident, addIncidentNote, configureIncidentRunbook, createIncidentGroup, incidentWorkspaceDetail, listWorkspaceIncidents } from "../../services/uptime/incident-workspace";
import { configureIncidentEscalation, cancelIncidentEscalation } from "../../services/uptime/incident-escalation";
const procedure = protectedProcedure.use(async ({ ctx, next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.incidentResponseInvalid"), cause: result.error.cause });
  return result;
});
export const incidentWorkspaceRouter = router({
  list: procedure.input(apiIncidentWorkspaceList).query(({ ctx, input }) => listWorkspaceIncidents(ctx.user.id, input)),
  one: procedure.input(apiIncidentIdentity).query(({ ctx, input }) => incidentWorkspaceDetail(input.incidentId, ctx.user.id, ctx.t)),
  acknowledge: procedure.input(apiIncidentIdentity).mutation(({ ctx, input }) => acknowledgeIncident(input.incidentId, ctx.user.id, ctx.t)),
  unacknowledge: procedure.input(apiIncidentIdentity).mutation(({ ctx, input }) => unacknowledgeIncident(input.incidentId, ctx.user.id, ctx.t)),
  note: procedure.input(apiIncidentNote).mutation(({ ctx, input }) => addIncidentNote(input.incidentId, ctx.user.id, input.text, ctx.t)),
  runbook: procedure.input(apiIncidentRunbook).mutation(({ ctx, input }) => configureIncidentRunbook(input.incidentId, ctx.user.id, input, ctx.t)),
  group: procedure.input(apiIncidentGroup).mutation(({ ctx, input }) => createIncidentGroup(ctx.user.id, input.name, input.incidentIds, ctx.t)),
  escalation: procedure.input(apiIncidentEscalation).mutation(({ ctx, input }) => configureIncidentEscalation(input.incidentId, ctx.user.id, input.steps, ctx.t)),
  cancelEscalation: procedure.input(apiIncidentIdentity).mutation(({ ctx, input }) => cancelIncidentEscalation(input.incidentId, ctx.user.id, ctx.t)),
  channels: procedure.input(z.object({ cursor: z.string().min(1).max(64).optional() }).strict()).query(async ({ ctx, input }) => {
    const rows = await db.select({ channel: uptimeNotificationChannel, monitorName: uptimeMonitor.name }).from(uptimeNotificationChannel).leftJoin(uptimeMonitor, eq(uptimeMonitor.uptimeMonitorId, uptimeNotificationChannel.uptimeMonitorId)).where(and(eq(uptimeNotificationChannel.userId, ctx.user.id), or(isNull(uptimeNotificationChannel.uptimeMonitorId), eq(uptimeMonitor.userId, ctx.user.id)), input.cursor ? gt(uptimeNotificationChannel.channelId, input.cursor) : undefined)).orderBy(asc(uptimeNotificationChannel.channelId)).limit(51);
    const items = rows.slice(0, 50).map(({ channel, monitorName }) => {
      const host = ["webhook", "slack", "discord"].includes(channel.channelType) ? maskNotificationChannel(channel).webhookUrlMasked : null;
      return { id: channel.channelId, type: channel.channelType, monitorName, host, recipientCount: channel.channelType === "email" ? channel.recipientAddresses?.length ?? 0 : null, notifyOnDown: channel.notifyOnDown, notifyOnDegraded: channel.notifyOnDegraded };
    });
    return { items, nextCursor: rows.length > 50 ? items.at(-1)!.id : null };
  }),
});
