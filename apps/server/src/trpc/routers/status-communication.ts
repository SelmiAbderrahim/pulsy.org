import { configureSubscriptions, readSubscriptionReadiness } from "../../services/uptime/status-subscription";
import { apiAnnouncementDraft, apiPublicComponents, apiStatusSubscriptionConfig } from "@pulsy/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { deleteAnnouncementDraft, applyPublicHistory, previewPublicHistory, applyPublicComponents, previewPublicComponents, publishAnnouncement, previewAnnouncement, readPageCommunication, saveAnnouncementDraft } from "../../services/uptime/status-communication";
const id = z.string().min(1).max(64), revision = z.string().regex(/^[0-9a-f]{64}$/);
const procedure = protectedProcedure.use(async ({ ctx, next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t("errors.statusPageCommunicationInvalid"), cause: result.error.cause });
  return result;
});
export const statusCommunicationRouter = router({
  historyPreview: procedure.input(z.object({ statusPageId: id, enabled: z.boolean() }).strict()).query(({ ctx, input }) => previewPublicHistory(ctx.user.id, input.statusPageId, input.enabled, ctx.t)),
  historyApply: procedure.input(z.object({ statusPageId: id, enabled: z.boolean(), revision }).strict()).mutation(({ ctx, input }) => applyPublicHistory(ctx.user.id, input.statusPageId, input.enabled, input.revision, ctx.t)),
  subscriptions: procedure.input(z.object({ statusPageId: id }).strict()).query(({ ctx, input }) => readSubscriptionReadiness(ctx.user.id, input.statusPageId, ctx.t)),
  subscriptionsConfigure: procedure.input(apiStatusSubscriptionConfig).mutation(({ ctx, input }) => configureSubscriptions(ctx.user.id, input, ctx.t)),
  one: procedure.input(z.object({ statusPageId: id }).strict()).query(({ ctx, input }) => readPageCommunication(ctx.user.id, input.statusPageId, ctx.t)),
  componentsPreview: procedure.input(apiPublicComponents).query(({ ctx, input }) => previewPublicComponents(ctx.user.id, input.statusPageId, input.components, ctx.t)),
  // POST keeps large drafts out of URLs and proxy request-line limits. The
  // preview remains read-only; retain the query for older clients.
  componentsPreviewPost: procedure.input(apiPublicComponents).mutation(({ ctx, input }) => previewPublicComponents(ctx.user.id, input.statusPageId, input.components, ctx.t)),
  componentsApply: procedure.input(apiPublicComponents.extend({ revision })).mutation(({ ctx, input }) => applyPublicComponents(ctx.user.id, input.statusPageId, input.components, input.revision, ctx.t)),
  draft: procedure.input(apiAnnouncementDraft).mutation(({ ctx, input }) => saveAnnouncementDraft(ctx.user.id, input, ctx.t)),
  deleteDraft: procedure.input(z.object({ id }).strict()).mutation(({ ctx, input }) => deleteAnnouncementDraft(ctx.user.id, input.id, ctx.t)),
  preview: procedure.input(z.object({ id }).strict()).query(({ ctx, input }) => previewAnnouncement(ctx.user.id, input.id, ctx.t)),
  publish: procedure.input(z.object({ id, revision }).strict()).mutation(({ ctx, input }) => publishAnnouncement(ctx.user.id, input.id, input.revision, ctx.t)),
});
