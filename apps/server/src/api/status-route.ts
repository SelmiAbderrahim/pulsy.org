import { readPublicReliability } from "../services/uptime/reliability-public";
import { createStatusSubscriptionRouter } from "./status-subscription-route";
import express from "express";
import { escapeHtml as escapeMarkup } from "../lib/html";
import { createIpRateLimiter } from "../lib/ip-rate-limit";
// Characters XML 1.0 forbids (control characters, lone surrogates) make a feed unparseable.
const INVALID_XML = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;
const escapeHtml = (value: string) => escapeMarkup(value.replace(INVALID_XML, ""));
import { getEffectiveLanguage, getTranslator, type SupportedLanguage, type Translator } from "../lib/i18n";
import { publicPageUrl } from "../services/uptime/status-public-url";
export { publicPageUrl } from "../services/uptime/status-public-url";
import { readPublishedStatusPageByKey } from "../trpc/routers/uptime";
type PublishedPage = NonNullable<Awaited<ReturnType<typeof readPublishedStatusPageByKey>>>;

function feed(value: PublishedPage, atom: boolean) {
  const { page, view } = value; const url = publicPageUrl(page), title = escapeHtml(view.title), description = escapeHtml(view.description ?? "");
  const entries = view.announcements.map(update => {
    const publishedAt = update.publishedAt!; if (!Number.isFinite(Date.parse(publishedAt))) throw new Error("Invalid publication date");
    const itemUrl = `${url}#announcement-${encodeURIComponent(update.id)}`;
    if (atom) return `<entry><id>${escapeHtml(itemUrl)}</id><title>${escapeHtml(update.title)}</title><updated>${escapeHtml(publishedAt)}</updated><link href="${escapeHtml(itemUrl)}"/><content type="text">${escapeHtml(update.text)}</content></entry>`;
    return `<item><guid isPermaLink="true">${escapeHtml(itemUrl)}</guid><title>${escapeHtml(update.title)}</title><link>${escapeHtml(itemUrl)}</link><pubDate>${new Date(publishedAt).toUTCString()}</pubDate><description>${escapeHtml(update.text)}</description></item>`;
  }).join("");
  if (atom) return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${escapeHtml(url)}</id><title>${title}</title><subtitle>${description}</subtitle><link href="${escapeHtml(url)}"/><updated>${escapeHtml(view.announcements[0]?.publishedAt ?? page.createdAt)}</updated>${entries}</feed>`;
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${title}</title><link>${escapeHtml(url)}</link><description>${description}</description>${entries}</channel></rss>`;
}
const badgeStyles = { unknown: { label: "Unknown", color: "#64748b" }, operational: { label: "Operational", color: "#15803d" }, degraded: { label: "Degraded", color: "#a16207" }, partial: { label: "Partial outage", color: "#c2410c" }, outage: { label: "Outage", color: "#b91c1c" } };
function badge(value: PublishedPage, t: Translator, language: SupportedLanguage) {
  const status = { ...badgeStyles[value.view.overallStatus], label: escapeHtml(t(`publicBadge.${value.view.overallStatus}`)) };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="24" lang="${language}" role="img" aria-label="Pulsy: ${status.label}"><title>Pulsy: ${status.label}</title><rect width="58" height="24" fill="#334155"/><rect x="58" width="122" height="24" fill="${status.color}"/><g fill="#fff" font-family="sans-serif" font-size="12" text-anchor="middle"><text x="29" y="16">Pulsy</text><text x="119" y="16">${status.label}</text></g></svg>`;
}
/** Published data only. No cookies/account keys, draft rows or private page-row serialization. */
export function createPublicStatusRouter(): express.Router {
  const router = express.Router(); let inFlight = 0;
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Vary", "Host, Accept-Language"); res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "GET" || req.method === "HEAD") res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });
  router.use(createIpRateLimiter({ limit: 240, maxBuckets: 1024, evictOldest: true, onLimited: res => { res.json({ outcome: "limited" }); } }));
  router.use(createStatusSubscriptionRouter());
  router.get("/pages/:key/:format", async (req, res) => {
    const key = String(req.params.key ?? ""), format = String(req.params.format ?? "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key!) || !["feed.rss", "feed.atom", "status.json", "badge.svg", "history.json"].includes(format!)) { res.status(404).json({ outcome: "unavailable" }); return; }
    if (Object.keys(req.query).length) { res.status(400).json({ outcome: "invalid" }); return; }
    // Technical bound: 16 concurrent public projections/process; review after measured public request traffic.
    if (inFlight >= 16) { res.setHeader("Retry-After", "1"); res.status(503).json({ outcome: "busy" }); return; } inFlight++;
    try {
      if (format === "history.json") { const history = await readPublicReliability(key!); if (!history) { res.status(404).json({ outcome: "unavailable" }); return; } res.setHeader("Access-Control-Allow-Origin", "*"); res.json(history); return; }
      const value = await readPublishedStatusPageByKey(key!); if (!value) { res.status(404).json({ outcome: "unavailable" }); return; }
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (format === "status.json") { res.json({ version: 1, ...value.view }); return; }
      if (format === "badge.svg") { const language = getEffectiveLanguage({ acceptLanguage: req.get("Accept-Language") }); res.setHeader("Content-Language", language); res.type("image/svg+xml").send(badge(value, getTranslator(language), language)); return; }
      res.type(format === "feed.atom" ? "application/atom+xml" : "application/rss+xml").send(feed(value, format === "feed.atom"));
    } catch { res.setHeader("Retry-After", "1"); res.status(503).json({ outcome: "unavailable" }); }
    finally { inFlight--; }
  });
  router.use((_req, res) => { res.status(404).json({ outcome: "unavailable" }); }); return router;
}
