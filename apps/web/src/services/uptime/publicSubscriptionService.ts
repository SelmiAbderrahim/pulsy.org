import { SERVER_URL } from "@/lib/api/trpc";
import type { SubscriptionCapability } from "@/lib/uptime/public-subscription-capability";
async function post(pageKey: string, action: "subscribe" | "subscription", body: unknown) {
  const response = await fetch(`${SERVER_URL}/api/status/pages/${encodeURIComponent(pageKey)}/${action}`, {
    method: "POST", credentials: "omit", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Subscription request unavailable");
}
export const PublicSubscriptionService = {
  request: (pageKey: string, input: { email: string; componentIds: string[]; language: "en" | "ar" | "fr" | "de" | "es" }) => post(pageKey, "subscribe", input),
  redeem: (pageKey: string, capability: SubscriptionCapability) => post(pageKey, "subscription", { action: capability.action, token: capability.token }),
};
