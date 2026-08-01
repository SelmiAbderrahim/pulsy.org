/**
 * Custom-domain detection for public status pages.
 *
 * A status page can be served at the root of a customer's own domain (e.g.
 * `https://status.acme.com/`). The SPA is the same bundle on every host, so the
 * root route decides what to render by comparing the browser's `Host` against
 * the app's own host (derived from `VITE_APP_URL`). Any other host is treated as
 * a custom status-page domain.
 *
 * @module lib/status-domain
 */

/**
 * Returns the bare hostname to resolve a custom-domain status page for, or
 * `null` when the current host is the app's own host (or we can't tell, in which
 * case we leave routing to the normal application entry point).
 */
export function getCustomStatusDomain(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const { host, hostname } = window.location;

  // Never treat local development hosts as custom domains.
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return null;
  }

  const appUrl = import.meta.env.VITE_APP_URL as string | undefined;
  if (!appUrl) {
    // Without a configured app URL we cannot distinguish hosts — stay on the app.
    return null;
  }

  let appHost: string;
  try {
    appHost = new URL(appUrl).host;
  } catch {
    return null;
  }

  return host === appHost ? null : hostname;
}

/**
 * The public URL for a status page. Prefers the page's verified custom domain
 * (served at its root); otherwise builds `{VITE_APP_URL}/status/{userId}/{slug}`,
 * falling back to the current origin when no app URL is configured.
 */
export function statusPageUrl(page: {
  userId: string;
  slug: string;
  customDomain: string | null;
  domainVerified: boolean;
}): string {
  if (page.customDomain && page.domainVerified) {
    return `https://${page.customDomain}/`;
  }
  const appUrl =
    (import.meta.env.VITE_APP_URL as string | undefined) ??
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${appUrl.replace(/\/$/, "")}/status/${page.userId}/${page.slug}`;
}
