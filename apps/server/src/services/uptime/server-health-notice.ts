import { z } from "zod";
import { getTranslator } from "../../lib/i18n";
import { escapeHtml } from "../../lib/html";
import { PUBLIC_WEB_URL } from "../../lib/auth-config";
import { formattingLocale } from "@pulsy/db/percent-format";
const reasonSchema = z.object({ locale: z.enum(["en", "ar", "fr", "de", "es"]), status: z.enum(["up", "down", "degraded"]), conditions: z.array(z.object({ key: z.string().max(520), value: z.number().finite().min(0).max(100).nullable(), threshold: z.number().finite().min(0).max(100) })).max(66) });
export function serverHealthNotice(monitor: { name: string; uptimeMonitorId: string }, change: { reason: string | null; statusAfter: string }) {
  let parsed: z.infer<typeof reasonSchema> | undefined;
  try { if (change.reason?.startsWith("server_health:")) parsed = reasonSchema.parse(JSON.parse(change.reason.slice(14))); } catch { /* A corrupt historical reason never exposes raw values. */ }
  const locale = parsed?.locale ?? "en", t = getTranslator(locale);
  const status = change.statusAfter === "up" ? "up" : change.statusAfter === "down" ? "down" : "degraded";
  const subject = t(`serverAlert.${status}`, { name: monitor.name });
  const format = (value: number) => new Intl.NumberFormat(formattingLocale(locale), { maximumFractionDigits: 1 }).format(value);
  const reasons = status === "down" ? [t("serverAlert.missing")] : status === "up" ? [t("serverAlert.recovered")] : (parsed?.conditions ?? []).slice(0, 4).map(condition => t(`serverAlert.${condition.key === "cpu" ? "cpu" : condition.key === "memory" ? "memory" : "disk"}`, { value: condition.value === null ? t("serverAlert.unavailable") : format(condition.value), threshold: format(condition.threshold), path: condition.key.startsWith("disk:") ? condition.key.slice(5) : "" }));
  if (status === "degraded" && (parsed?.conditions.length ?? 0) > 4) reasons.push(t("serverAlert.more", { count: parsed!.conditions.length - 4 }));
  const reason = reasons.join("\n"), text = `${subject}\n${reason}`;
  const link = new URL(`/dashboard/uptime/${encodeURIComponent(monitor.uptimeMonitorId)}`, PUBLIC_WEB_URL).href;
  return { subject, reason, text: text.slice(0, 1800), html: `<!DOCTYPE html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><body><h1>${escapeHtml(subject)}</h1><p style="white-space:pre-wrap">${escapeHtml(reason)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(t("serverAlert.view"))}</a></p></body></html>` };
}
