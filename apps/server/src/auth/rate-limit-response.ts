import { getEffectiveLanguage, getTranslator } from "../lib/i18n";

/** Shared by better-auth's custom rule and its HTTP response adapter. */
export function authRateLimitPolicy(request: Request) {
  let pathname = new URL(request.url).pathname;
  try { pathname = decodeURI(pathname); } catch { /* Malformed escapes keep the default limit. */ }
  const path = pathname.replace(/^\/api\/auth/, "").replace(/\/+$/, "");
  if (["/request-password-reset", "/send-verification-email", "/email-otp/send-verification-otp", "/email-otp/request-password-reset"].includes(path) || path.startsWith("/forget-password")) return { window: 60, max: 3 };
  if (["/sign-in", "/sign-up", "/change-password", "/change-email"].some(prefix => path.startsWith(prefix))) return { window: 10, max: 3 };
  return { window: 10, max: 100 };
}

/** Preserve successful auth responses (including uniform reset responses) verbatim. */
export function authRateLimitResponse(request: Request, response: Response): Response {
  if (response.status !== 429) return response;
  const policy = authRateLimitPolicy(request);
  const reported = Number(response.headers.get("Retry-After") ?? response.headers.get("X-Retry-After"));
  const retryAfter = Number.isFinite(reported) && reported > 0 ? Math.ceil(reported) : policy.window;
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Retry-After", String(retryAfter));
  headers.set("RateLimit-Limit", String(policy.max));
  headers.set("RateLimit-Remaining", "0");
  headers.set("RateLimit-Reset", String(retryAfter));
  headers.set("RateLimit-Policy", `${policy.max};w=${policy.window}`);
  const t = getTranslator(getEffectiveLanguage({ acceptLanguage: request.headers.get("Accept-Language") }));
  return new Response(JSON.stringify({ message: t("errors.rateLimited", { retryAfter }) }), { status: 429, headers });
}
