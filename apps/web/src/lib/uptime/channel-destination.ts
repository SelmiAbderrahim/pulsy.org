import type { UptimeNotificationChannel } from "@/types/uptime";

/** Saved channels expose only recipients or the server's masked destination label. */
export function channelDestination(channel: Pick<UptimeNotificationChannel, "channelType" | "recipientAddresses" | "webhookUrlMasked">): string {
  return channel.channelType === "email" ? (channel.recipientAddresses?.join(", ") ?? "") : (channel.webhookUrlMasked ?? "");
}
