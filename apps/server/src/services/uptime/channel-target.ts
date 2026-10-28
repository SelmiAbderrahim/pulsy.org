import { TRPCError } from "@trpc/server";
import type { Translator } from "../../lib/i18n";
import { assertOutboundUrlAllowed, SsrfBlockedError } from "../../lib/ssrf";
import { FieldValidationError } from "../../trpc/validation-errors";

type Target = { channelType: string; webhookUrl?: string | null };

/** Vendor credentials must never be sent to an arbitrary host, even in private-network mode. */
export function channelTargetError(channel: Target): string | null {
  if (channel.channelType !== "slack" && channel.channelType !== "discord") return null;
  const key = channel.channelType === "slack" ? "errors.slackDestination" : "errors.discordDestination";
  try {
    const url = new URL(channel.webhookUrl ?? "");
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash) return key;
    if (channel.channelType === "slack") {
      return url.hostname === "hooks.slack.com" && /^\/services\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname) ? null : key;
    }
    return ["discord.com", "discordapp.com"].includes(url.hostname) && /^\/api\/webhooks\/\d+\/[^/]+$/.test(url.pathname) ? null : key;
  } catch { return key; }
}

export async function assertNotificationChannelTarget(channel: Target, t: Translator): Promise<void> {
  let key = channelTargetError(channel);
  const target = channel.webhookUrl;
  if (!key && target && (["webhook", "slack", "discord"].includes(channel.channelType) || (channel.channelType === "telegram" && target.startsWith("http")))) {
    try { await assertOutboundUrlAllowed(target); }
    catch (error) {
      if (!(error instanceof SsrfBlockedError)) throw error;
      key = "errors.targetBlocked";
    }
  }
  if (key) throw new TRPCError({ code: "BAD_REQUEST", message: t(key), cause: new FieldValidationError("webhookUrl", key) });
}
