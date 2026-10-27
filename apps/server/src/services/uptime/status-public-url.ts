import { PUBLIC_WEB_URL } from "../../lib/auth-config";
/** Only stored, validated page identity; never derive a mail link from request headers. */
export function publicPageUrl(page: { userId: string; slug: string; customDomain: string | null; domainVerified: boolean }): string {
  if (page.customDomain && page.domainVerified) return `https://${page.customDomain}`;
  return new URL(`/status/${encodeURIComponent(page.userId)}/${encodeURIComponent(page.slug)}`, PUBLIC_WEB_URL).href;
}

/** Mail capabilities always return through the configured application origin. */
export function subscriptionPageUrl(page: { userId: string; slug: string }) {
  return new URL(`/status/${encodeURIComponent(page.userId)}/${encodeURIComponent(page.slug)}`, PUBLIC_WEB_URL).toString();
}
