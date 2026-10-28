import { useState } from "react";
import { formattingLocale } from "@/lib/formatting-locale";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useAccountTimezone } from "@/components/account-timezone";
import { dateTimeFormat, formatTimezone } from "@/lib/date-format";
import { formatMilliseconds, formatNumberTick } from "@/lib/uptime/number-format";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveContainer, LineChart, ReferenceLine, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from "recharts";
import type { UptimeCheckLog } from "@/types/uptime";
import { measuredLatency } from "@/lib/uptime/format";

interface ResponseTimeChartProps {
  checkLogs: UptimeCheckLog[];
  thresholdMs?: number | null;
  recoveryThresholdMs?: number | null;
  intervalSeconds?: number;
  timingLabel?: string;
  monitorType?: string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/** A missing observation is a gap, never a fabricated zero-duration check. */
export function responseSeries(logs: UptimeCheckLog[], intervalSeconds?: number, monitorType?: string) {
  const ordered = [...logs].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const points: { time: number; responseTime: number | null }[] = [];
  for (const log of ordered) {
    const time = Date.parse(log.createdAt), previous = points.at(-1);
    if (previous && intervalSeconds && time - previous.time > intervalSeconds * 2_000) points.push({ time: previous.time + intervalSeconds * 1_000, responseTime: null });
    points.push({ time, responseTime: measuredLatency(log, monitorType) });
  }
  return points;
}

/** Round, evenly spaced ticks; the domain still preserves the exact observations. */
export function responseTimeTicks(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  if (start === end) return [start];
  const intervals = [1, 5, 15, 30, 60, 300, 900, 1800, 3600, 10800, 21600, 43200, 86400, 604800].map(seconds => seconds * 1000);
  const desired = (end - start) / 5;
  const step = intervals.find(interval => interval >= desired) ?? Math.ceil(desired / 604800000) * 604800000;
  const ticks: number[] = [];
  for (let time = Math.ceil(start / step) * step; time <= end; time += step) ticks.push(time);
  return ticks;
}

export function formatResponseTimeTooltip(value: unknown, label: string, locale = "en"): [string, string] {
  return [formatMilliseconds(typeof value === "number" ? value : null, locale) ?? "", label];
}

export function ResponseTimeChart({ checkLogs, thresholdMs, recoveryThresholdMs, intervalSeconds, timingLabel, monitorType, isLoading, error, onRetry }: ResponseTimeChartProps) {
  const accountTimezone = useAccountTimezone();
  const [chartWidth, setChartWidth] = useState(0);
  const { t, i18n } = useTranslation("uptimeMonitor");
  const time = dateTimeFormat(i18n.language, accountTimezone, { hour: "2-digit", minute: "2-digit" });
  const absolute = dateTimeFormat(i18n.language, accountTimezone, { dateStyle: "medium", timeStyle: "medium" });
  const rtl = i18n.language.startsWith("ar");
  const recoveryLabel = t("detailUX.recoveryThresholdLabel", "Recovery threshold");
  const title = timingLabel ?? t("overview.responseTime.title", "Response time");
  const chartData = responseSeries(checkLogs, intervalSeconds, monitorType);
  const ticks = responseTimeTicks(chartData[0]?.time ?? NaN, chartData.at(-1)?.time ?? NaN);
  // Recharts positions against the plot, so constrain the content to that same
  // width (48px value axis + 24px margins), including at 320px and in RTL.
  const tooltipWidth = chartWidth ? Math.max(1, Math.min(240, chartWidth - 72)) : 240;
  return <SectionCard title={title} description={t("detailUX.chartBasis", { count: checkLogs.length, timezone: formatTimezone(accountTimezone, i18n.language) })}><div className="grid min-w-0 gap-3">
      {thresholdMs != null && <p className="text-sm text-warning">{t("latency.chartThreshold", { threshold: new Intl.NumberFormat(formattingLocale(i18n.language)).format(thresholdMs) })}</p>}
      {thresholdMs != null && recoveryThresholdMs != null && <p className="text-sm text-success">{t("detailUX.recoveryThreshold", { threshold: new Intl.NumberFormat(formattingLocale(i18n.language)).format(recoveryThresholdMs) })}</p>}
      {Boolean(error) && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm"><p>{t("metrics.error")}</p>{onRetry && <Button variant="outline" onClick={onRetry}>{t("metrics.retry")}</Button>}</div>}
      {isLoading ? <><div role="status" className="flex h-[210px] items-center justify-center text-sm text-muted-foreground sm:h-[260px]">{t("metrics.loading")}</div><div aria-hidden="true" className="flex h-4 gap-4"><span className="w-24 rounded-xs bg-muted" /><span className="w-24 rounded-xs bg-muted" /></div><div aria-hidden="true" className="h-[54px] rounded-md border bg-muted" /></> : chartData.length === 0 ? <div className="flex h-[210px] items-center justify-center text-sm text-muted-foreground sm:h-[260px]">{error ? t("metrics.noData") : t("history.empty", "No check logs yet")}</div> : <>
        <div className="h-[210px] min-w-0 sm:h-[260px]" dir={rtl ? "rtl" : "ltr"} role="figure" aria-label={title}>
          <ResponsiveContainer width="100%" height="100%" onResize={width => setChartWidth(width)}>
            <LineChart data={chartData} accessibilityLayer margin={{ top: 24, right: rtl ? 8 : 16, bottom: 8, left: rtl ? 16 : 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis reversed={rtl} dataKey="time" type="number" domain={["dataMin", "dataMax"]} scale="time" ticks={ticks} minTickGap={32} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12, style: { whiteSpace: "nowrap" } }} tickFormatter={value => time.format(value)} />
              <YAxis orientation={rtl ? "right" : "left"} width={48} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12, style: { whiteSpace: "nowrap" } }} tickFormatter={(value: number) => formatNumberTick(value, i18n.language) ?? ""} />
              <RechartsTooltip separator=": " contentStyle={{ maxWidth: tooltipWidth, whiteSpace: "normal", overflowWrap: "anywhere", backgroundColor: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 13 }} labelStyle={{ color: "hsl(var(--foreground))" }} labelFormatter={value => `${absolute.format(Number(value))} · ${formatTimezone(accountTimezone, i18n.language, Number(value))}`} formatter={value => formatResponseTimeTooltip(value, title, i18n.language)} />
              {thresholdMs != null && <ReferenceLine y={thresholdMs} ifOverflow="extendDomain" stroke="hsl(var(--warning))" strokeDasharray="6 4" />}
              {thresholdMs != null && recoveryThresholdMs != null && <ReferenceLine y={recoveryThresholdMs} ifOverflow="extendDomain" stroke="hsl(var(--success))" strokeWidth={1.5} strokeDasharray="2 4" />}
              <Line type="linear" isAnimationActive={false} connectNulls={false} dataKey="responseTime" stroke="hsl(var(--primary))" strokeWidth={2} dot={chartData.filter(point => point.responseTime !== null).length === 1 ? { r: 3 } : false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs" aria-label={t("overview.uptimeBar.legend", "Legend")}>
          <li className="flex items-center gap-2"><span aria-hidden className="w-6 border-t-2 border-primary" />{title}</li>
          {thresholdMs != null && <li className="flex items-center gap-2"><span aria-hidden className="w-6 border-t-2 border-dashed border-warning" />{t("detailUX.degradedThresholdLabel", "Degraded threshold")}</li>}
          {thresholdMs != null && recoveryThresholdMs != null && <li className="flex items-center gap-2"><span aria-hidden className="w-6 border-t-[1.5px] border-dotted border-success" />{recoveryLabel}</li>}
        </ul>
        <Collapsible><CollapsibleTrigger>{t("detailUX.chartData")}</CollapsibleTrigger><CollapsibleContent><div role="region" aria-label={t("detailUX.chartData")} tabIndex={0} className="max-h-72 overflow-auto">
          <Table><TableHeader><TableRow><TableHead>{t("history.columns.time")}</TableHead><TableHead>{title}</TableHead><TableHead>{t("monitors.columns.status")}</TableHead></TableRow></TableHeader><TableBody>{checkLogs.map((log, index) => <TableRow key={log.checkLogId ?? index}><TableCell><time dateTime={log.createdAt}>{absolute.format(new Date(log.createdAt))}</time></TableCell><TableCell className="tabular-nums"><bdi>{formatMilliseconds(measuredLatency(log, monitorType), i18n.language) ?? "—"}</bdi></TableCell><TableCell>{t(`status.${log.status}`)}</TableCell></TableRow>)}</TableBody></Table>
        </div></CollapsibleContent></Collapsible>
      </>}
    </div></SectionCard>;
}
