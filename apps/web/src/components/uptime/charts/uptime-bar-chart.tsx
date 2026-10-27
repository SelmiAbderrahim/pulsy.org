import { formattingLocale } from "@/lib/formatting-locale";
import { FormField } from "@/components/ui/form-field";
import { formatCount } from "@/lib/count-format";
import { formatTimezone } from "@/lib/date-format";
import { Combobox } from "@/components/ui/combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { formatPercent } from "@/lib/uptime/number-format";
import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { UptimeBarDataPoint } from "@/types/uptime";

interface UptimeBarChartProps {
  data: UptimeBarDataPoint[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function getBarColor(point: UptimeBarDataPoint): string {
  const percent = point.uptimePercent;
  if (point.status === "unknown" || point.totalChecks === 0 || percent === null || !Number.isFinite(percent) || percent < 0 || percent > 100) return "bg-muted";
  if (percent === 100) return "bg-success";
  if (percent === 0) return "bg-destructive";
  return "bg-warning";
}

export function UptimeBarChart({ data: allData, isLoading, error, onRetry }: UptimeBarChartProps) {
  const dayId = useId();
  const [card, setCard] = useState<HTMLElement | null>(null);
  const mobile = useMediaQuery("(max-width: 767px)");
  const [chosenWindow, setWindow] = useState<number>();
  const days = chosenWindow ?? (mobile ? 30 : 90);
  const data = allData.slice(-days);
  const [selectedDate, setSelectedDate] = useState("");
  const selectedDay = data.find(point => point.date === selectedDate) ?? data.at(-1);
  const { t, i18n } = useTranslation("uptimeMonitor");
  const dateFormat = new Intl.DateTimeFormat(formattingLocale(i18n.language), { dateStyle: "medium", timeZone: "UTC" });
  const numberFormat = new Intl.NumberFormat(formattingLocale(i18n.language));
  const timezone = formatTimezone("UTC", i18n.language);
  const recordedChecks = (count: number) => formatCount((key, options) => t(key, { ...options, defaultValue: `${options.formattedCount} recorded ${count === 1 ? "check" : "checks"}` }), "overview.uptimeBar.recordedChecks", count, i18n.language);
  const unknown = t("overview.uptimeBar.unknown", "Unknown");
  const dateLabel = (date: string) => dateFormat.format(new Date(`${date}T00:00:00Z`));
  const percentLabel = (point: UptimeBarDataPoint) => getBarColor(point) === "bg-muted"
    ? unknown : formatPercent(point.uptimePercent, i18n.language) ?? unknown;
  const statusLabel = (point: UptimeBarDataPoint) => point.status === "unknown" ? unknown
    : point.status === "partial" ? t("overview.uptimeBar.partial", "Partial")
    : t(`status.${point.status}`);

  return (
    <SectionCard ref={setCard} title={<>{t("overview.uptimeBar.windowTitle", { days, count: days })}</>} description={<>
          {t("overview.uptimeBar.basis", "Successful recorded checks per UTC calendar day. Today is partial; days without checks (new, paused or missing history) are unknown. Counts show observed coverage, not continuous availability.")}
        </>}><div>
        <FormField className="mb-4 flex items-center gap-2"><Label htmlFor={`${dayId}-window`}>{t("overview.uptimeBar.window")}</Label><Select value={String(days)} onValueChange={value => setWindow(Number(value))}><SelectTrigger id={`${dayId}-window`} className="w-auto"><SelectValue /></SelectTrigger><SelectContent>{[30,90].map(value => <SelectItem key={value} value={String(value)}>{t("overview.uptimeBar.days", { days: value, count: value })}</SelectItem>)}</SelectContent></Select></FormField>
        {Boolean(error) && data.length > 0 && <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 text-sm"><p>{t("overview.uptimeBar.error", "Could not load daily history")}</p>{onRetry && <Button variant="outline" onClick={onRetry}>{t("overview.uptimeBar.retry", "Retry")}</Button>}</div>}
        {isLoading ? <div role="status" aria-label={t("overview.uptimeBar.loading", "Loading daily history…")}>
          <span className="sr-only">{t("overview.uptimeBar.loading", "Loading daily history…")}</span>
          <div aria-hidden="true" data-uptime-loading>
            <div className="h-8 rounded-xs bg-muted" />
            <div className="mt-2 flex justify-between"><span className="h-4 w-24 rounded-xs bg-muted" /><span className="h-4 w-12 rounded-xs bg-muted" /></div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">{[0,1,2,3].map(index => <span key={index} className="h-4 w-16 rounded-xs bg-muted" />)}</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 sm:items-end"><div className="grid gap-2"><span className="h-4 w-24 rounded-xs bg-muted" /><span className="h-11 rounded-xs bg-muted" /></div><span className="h-9 rounded-xs bg-muted" /></div>
            <div className="mt-3 h-[54px] rounded-md border bg-muted" />
          </div>
        </div>
          : error && data.length === 0 ? <div role="alert" className="flex flex-wrap items-center gap-3">
            <p>{t("overview.uptimeBar.error", "Could not load daily history")}</p>
            {onRetry && <Button variant="outline" className="min-h-11" onClick={onRetry}>{t("overview.uptimeBar.retry", "Retry")}</Button>}
          </div> : <>
          <TooltipProvider delayDuration={0}>
            <div className="flex h-8 items-end gap-px">
              {data.map(point => <Tooltip key={point.date}>
                <TooltipTrigger asChild>
                  <button data-uptime-day={point.date} type="button" aria-label={`${dateLabel(point.date)} · ${timezone} · ${percentLabel(point)} · ${recordedChecks(point.totalChecks)}`} aria-pressed={selectedDay?.date === point.date} onClick={() => setSelectedDate(point.date)} className={cn("flex-1 rounded-xs min-w-[2px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", getBarColor(point))}
                    style={{ height: `${point.uptimePercent === null ? 32 : Math.max(4, (point.uptimePercent / 100) * 32)}px` }} />
                </TooltipTrigger>
                <TooltipContent collisionBoundary={card} collisionPadding={8} className="max-w-[var(--radix-tooltip-content-available-width)] whitespace-normal break-words">
                  <p className="font-medium">{dateLabel(point.date)} · {timezone}</p>
                  <p>{percentLabel(point)} · {recordedChecks(point.totalChecks)}</p>
                </TooltipContent>
              </Tooltip>)}
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{data[0] ? dateLabel(data[0].date) : unknown}</span>
              <span>{t("overview.uptimeBar.today", "Today")}</span>
            </div>
          </TooltipProvider>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs" aria-label={t("overview.uptimeBar.legend", "Legend")}>
            {[["bg-success", t("status.up", "Up")], ["bg-destructive", t("status.down", "Down")],
              ["bg-warning", t("overview.uptimeBar.partial", "Partial")], ["bg-muted", unknown]].map(([color, label]) =>
                <li key={color} className="flex items-center gap-1.5"><span aria-hidden="true" className={cn("h-3 w-3 rounded-xs", color)} />{label}</li>)}
          </ul>
          {selectedDay && <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 sm:items-end"><FormField className="form-field"><Label htmlFor={dayId}>{t("detailUX.chooseDay")}</Label><Combobox id={dayId} value={selectedDay.date} onValueChange={setSelectedDate} options={data.map(point => ({ value: point.date, label: `${dateLabel(point.date)} · ${timezone}` }))} /></FormField><p className="py-2 text-sm" data-selected-day={selectedDay.date}>{statusLabel(selectedDay)} · <bdi>{percentLabel(selectedDay)}</bdi> · {recordedChecks(selectedDay.totalChecks)}</p></div>}
          <Collapsible className="mt-3">
            <CollapsibleTrigger>
              {t("overview.uptimeBar.viewData", "View daily data")}
            </CollapsibleTrigger><CollapsibleContent>
            <div tabIndex={0} role="region" aria-label={t("overview.uptimeBar.viewData", "View daily data")}
              className="max-h-64 overflow-auto rounded-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
              <Table data-daily-uptime>
                <TableHeader><TableRow>
                  <TableHead className="text-start">{t("overview.uptimeBar.date", "Date")} · {timezone}</TableHead>
                  <TableHead className="text-start">{t("overview.uptimeBar.success", "Check success")}</TableHead>
                  <TableHead className="text-start">{t("overview.uptimeBar.checks", "Recorded checks")}</TableHead>
                  <TableHead className="text-start">{t("monitors.status", "Status")}</TableHead>
                </TableRow></TableHeader>
                <TableBody>{data.map(point => <TableRow key={point.date} data-date={point.date} data-status={point.status}
                  data-percent={point.uptimePercent ?? ""} data-checks={point.totalChecks}>
                  <TableCell><time dateTime={point.date}>{dateLabel(point.date)}</time></TableCell>
                  <TableCell><bdi>{percentLabel(point)}</bdi></TableCell>
                  <TableCell><bdi>{numberFormat.format(point.totalChecks)}</bdi></TableCell>
                  <TableCell>{statusLabel(point)}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </div>
          </CollapsibleContent></Collapsible>
        </>}
      </div>
    </SectionCard>
  );
}
