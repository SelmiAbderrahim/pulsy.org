import { db, user, uptimeNotificationChannel } from "@pulsy/db";
import { count, eq } from "drizzle-orm";
import { assertBelowCap } from "../../lib/account-caps";
import type { Translator } from "../../lib/i18n";

/** Serialize the shared technical storage ceiling with all channel creation. */
export async function insertOwnedChannel(values: typeof uptimeNotificationChannel.$inferInsert, t: Translator) {
  return db.transaction(async tx => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, values.userId)).for("update");
    const [total] = await tx.select({ value: count() }).from(uptimeNotificationChannel).where(eq(uptimeNotificationChannel.userId, values.userId));
    assertBelowCap(total?.value ?? 0, "notificationChannels", t);
    const [channel] = await tx.insert(uptimeNotificationChannel).values(values).returning();
    return channel;
  });
}
