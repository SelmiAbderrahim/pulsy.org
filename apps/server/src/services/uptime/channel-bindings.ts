import { type DbExecutor, uptimeNotificationChannel } from "@pulsy/db";
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Translator } from "../../lib/i18n";

/** Channel reuse requires ownership, independently of monitor type. */
export async function assertOwnedChannelReferences(tx: DbExecutor, userId: string, ids: string[], t: Translator) {
  if (!ids.length) return;
  const owned = await tx.select({ id: uptimeNotificationChannel.channelId }).from(uptimeNotificationChannel)
    .where(and(eq(uptimeNotificationChannel.userId, userId), inArray(uptimeNotificationChannel.channelId, ids))).for("share");
  if (owned.length !== new Set(ids).size) throw new TRPCError({ code: "NOT_FOUND", message: t("errors.templateChannelMissing") });
}
