import { Unit } from "@/components/ui/unit";
import { formatMilliseconds } from "@/lib/uptime/number-format";
import { SectionCard } from "@/components/ui/section-card";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { useAccountTimezone } from "@/components/account-timezone";
import { dateTimeFormat, formatTimezone } from "@/lib/date-format";
import { useElapsedClock } from "@/hooks/useElapsedClock";
import { formatRelativeTime } from "@/lib/uptime/format";
import { useState } from "react";
import { formatLatencyReason, measuredLatency } from "@/lib/uptime/format";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useUptimeCheckLogs } from "@/hooks/uptime";

export function HistoryTab({ monitorId, monitorType, timeoutMs }: { monitorId: string; monitorType?: string; timeoutMs?: number }) {
  const accountTimezone = useAccountTimezone();
  const { t, i18n } = useTranslation("uptimeMonitor");
  const [offset, setOffset] = useState(0);
  const query = useUptimeCheckLogs(monitorId, { limit: 25, offset });
  const logs = query.data?.data ?? [];
  const now = useElapsedClock(true);
  const date = dateTimeFormat(i18n.language, accountTimezone, { dateStyle: "medium", timeStyle: "medium" });
  const http = !monitorType || monitorType === "http", heartbeat = monitorType === "heartbeat";
  const timing = t(monitorType === "dns" ? "network.dnsTiming" : monitorType === "tcp" ? "network.tcpTiming" : "history.columns.responseTime");
  return <SectionCard headingId="check-log-title" title={t("historyUX.title")} headerEnd={<DocsHelpLink docPath="reliability" />}><div className="grid min-w-0 gap-3"><Button variant="outline" className="w-full sm:w-auto sm:justify-self-start" disabled={query.isFetching} onClick={() => void query.refetch()}>{t("reliability.refresh")}</Button>
    <p className="text-sm text-muted-foreground">{t("historyUX.scope", { timezone: formatTimezone(accountTimezone, i18n.language) })}</p>
    {query.dataUpdatedAt > 0 && <p className="text-sm text-muted-foreground" title={date.format(query.dataUpdatedAt)}>{t("reliability.asOf", { date: formatRelativeTime(new Date(query.dataUpdatedAt).toISOString(), i18n.language, now), timezone: formatTimezone(accountTimezone, i18n.language) })}</p>}
    {query.error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive"><p>{t("historyUX.loadError")}</p><Button variant="outline" className="min-h-11" onClick={() => void query.refetch()}>{t("workspace.retry")}</Button></div>}
    {!query.data && !query.error ? <div role="status" className="min-h-48 rounded-md border p-4 text-sm text-muted-foreground">{t("metrics.loading")}</div> : logs.length === 0 && !query.error ? <div className="grid gap-2 rounded-md border p-6"><p className="font-medium">{t("history.empty")}</p><p className="text-sm text-muted-foreground">{t("history.emptyDescription")}</p></div> : logs.length > 0 && <div role="region" aria-label={t("historyUX.title")} tabIndex={0} className="min-w-0 rounded-lg border" aria-busy={query.isFetching}>
      <Table pageScroll aria-label={t("historyUX.title")} className="min-w-[760px] table-fixed"><colgroup><col className="w-[240px]" /><col className="w-[120px]" />{http && <col className="w-[100px]" />}{!heartbeat && <col className="w-[120px]" />}<col /></colgroup><TableHeader><TableRow>
        <TableHead>{t("history.columns.time")}</TableHead><TableHead>{t("history.columns.status")}</TableHead>{http && <TableHead>{t("history.columns.httpStatus")}</TableHead>}{!heartbeat && <TableHead>{timing}</TableHead>}<TableHead>{t("history.columns.error")}</TableHead>
      </TableRow></TableHeader><TableBody>{logs.map(log => <TableRow key={log.checkLogId}>
        <TableCell className="whitespace-nowrap text-sm text-muted-foreground"><time dateTime={log.createdAt}>{date.format(new Date(log.createdAt))}</time></TableCell>
        <TableCell><div className="flex items-center gap-2"><span aria-hidden className={`h-2 w-2 shrink-0 rounded-xs ${log.status === "up" ? "bg-success" : log.status === "down" ? "bg-destructive" : log.status === "degraded" ? "bg-warning" : "bg-muted-foreground"}`} /><span>{t(`status.${log.status}`)}</span></div></TableCell>
        {http && <TableCell className="whitespace-nowrap tabular-nums">{log.httpStatus ?? "—"}</TableCell>}{!heartbeat && <TableCell className="whitespace-nowrap tabular-nums"><Unit>{formatMilliseconds(measuredLatency(log, monitorType), i18n.language) ?? "—"}</Unit></TableCell>}
        <TableCell className="min-w-48 max-w-sm text-sm text-muted-foreground">{log.errorMessage ? <Collapsible><CollapsibleTrigger>{t("historyUX.errorDetail")}</CollapsibleTrigger><CollapsibleContent><p className="whitespace-pre-wrap break-words" dir="auto">{formatLatencyReason(log.errorMessage, t, { httpStatus: log.httpStatus, timeoutMs })}</p></CollapsibleContent></Collapsible> : "—"}</TableCell>
      </TableRow>)}</TableBody></Table>
    </div>}
    {(offset > 0 || (query.data?.total ?? 0) > 25) && <nav aria-label={t("historyUX.pages")} className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={offset === 0 || query.isFetching} onClick={() => setOffset(value => Math.max(0, value - 25))}>{t("historyUX.newer")}</Button><p className="text-sm tabular-nums">{t("historyUX.range", { from: offset + 1, to: offset + logs.length, total: query.data?.total ?? "—" })}</p><Button variant="outline" disabled={offset + logs.length >= (query.data?.total ?? 0) || query.isFetching} onClick={() => setOffset(value => value + 25)}>{t("historyUX.older")}</Button></nav>}
  </div></SectionCard>;
}
