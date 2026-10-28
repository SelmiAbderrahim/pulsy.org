import { formattingLocale } from "@/lib/formatting-locale";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useAccountTimezone } from "@/components/account-timezone";
import { dateTimeFormat } from "@/lib/date-format";
import { formatPercent } from "@/lib/uptime/number-format";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { SERVER_URL } from "@/lib/api/trpc";
const percent = z.number().min(0).max(100).nullable();
const totals = z.object({ availabilityPercent: percent, coveragePercent: percent });
const schema = z.object({ version: z.literal(1), from: z.string().max(40).datetime(), to: z.string().max(40).datetime(), asOf: z.string().max(40).datetime(), components: z.array(z.object({ componentId: z.string().min(1).max(64), timingKind: z.enum(["none", "response", "connection", "resolution"]), days: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), raw: totals, maintenanceAdjusted: totals.nullable(), averageTimingMs: z.number().nonnegative().nullable() })).max(7) })) });
type ComponentHistory = z.infer<typeof schema>["components"][number];
function ComponentPanel({ name, component }: { name: string; component: ComponentHistory }) {
  const { t, i18n } = useTranslation("uptimeMonitor"), [open, setOpen] = useState(false), id = useId();
  const percentage = (value: number | null) => formatPercent(value, i18n.language) ?? t("reliability.unknown");
  return <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border"><CollapsibleTrigger className="ps-4"><bdi>{name}</bdi></CollapsibleTrigger><CollapsibleContent>{open && <div className="grid min-w-0 gap-2"><p className="text-xs text-muted-foreground">{t(`reliability.timingKinds.${component.timingKind}`)}</p><div role="region" tabIndex={0} aria-labelledby={id} className="max-w-full overflow-x-auto"><table className="w-full text-sm"><caption id={id} className="sr-only">{name} · {t("reliability.publicTitle")}</caption><thead><tr>{["date", "availability", "coverage", "adjusted", "timing"].map(label => <th key={label} scope="col" className="p-2 text-start">{t(`reliability.${label}`)}</th>)}</tr></thead><tbody>{component.days.map(day => <tr key={day.date}><th scope="row" className="p-2 text-start font-normal"><bdi>{day.date}</bdi></th><td className="p-2">{percentage(day.raw.availabilityPercent)}</td><td className="p-2">{percentage(day.raw.coveragePercent)}</td><td className="p-2">{day.maintenanceAdjusted ? percentage(day.maintenanceAdjusted.availabilityPercent) : "—"}</td><td className="p-2">{day.averageTimingMs === null ? t("reliability.unknown") : t("reliability.milliseconds", { value: new Intl.NumberFormat(formattingLocale(i18n.language), { maximumFractionDigits: 1 }).format(day.averageTimingMs) })}</td></tr>)}</tbody></table></div></div>}</CollapsibleContent></Collapsible>;
}
/** One lazy request for the page; individual panels mount only on expansion. */
export function PublicHistory({ publicKey, components }: { publicKey: string; components: { componentId?: string | null; name: string }[] }) {
  const accountTimezone = useAccountTimezone();
  const { t, i18n } = useTranslation("uptimeMonitor"); const [expanded, setExpanded] = useState(false), [attempt, setAttempt] = useState(0), [data, setData] = useState<z.infer<typeof schema>>(), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!expanded || data) return;
    const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 10000); let cancelled = false;
    setBusy(true); setError(false);
    void fetch(`${SERVER_URL}/api/status/pages/${encodeURIComponent(publicKey)}/history.json`, { signal: controller.signal, credentials: "omit" }).then(async response => { if (!response.ok) throw new Error("Unavailable history"); return schema.parse(await response.json()); }).then(value => { if (!cancelled) setData(value); }).catch(() => { if (!cancelled) setError(true); }).finally(() => { window.clearTimeout(timeout); if (!cancelled) setBusy(false); });
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [expanded, publicKey, attempt, data]);
  return <Collapsible open={expanded} onOpenChange={setExpanded} className="rounded-lg border bg-card"><CollapsibleTrigger className="ps-4">{t("reliability.publicTitle")}</CollapsibleTrigger><CollapsibleContent>{expanded && <div className="grid min-w-0 gap-3"><p className="text-sm text-muted-foreground">{t("reliability.publicDescription")}</p>{busy && <p role="status">{t("reliability.loading")}</p>}{error && <div role="alert" className="grid gap-2 text-sm"><p>{t("reliability.error")}</p><Button variant="outline" className="min-h-11 w-fit" onClick={() => setAttempt(value => value + 1)}>{t("reliability.refresh")}</Button></div>}{data && <><p className="break-words text-xs text-muted-foreground"><bdi>{data.from.slice(0, 10)} → {data.to.slice(0, 10)}</bdi> · {t("reliability.asOf", { date: dateTimeFormat(i18n.language, accountTimezone, { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.asOf)), timezone: accountTimezone })}</p>{data.components.map(component => { const visible = components.find(item => item.componentId === component.componentId); return visible ? <ComponentPanel key={component.componentId} name={visible.name} component={component} /> : null; })}</>}</div>}</CollapsibleContent></Collapsible>;
}
