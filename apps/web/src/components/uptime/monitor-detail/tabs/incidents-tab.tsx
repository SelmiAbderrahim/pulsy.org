import { IncidentCard, IncidentTimestamp } from "../../incident-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccountTimezone } from "@/components/account-timezone";
import { formatTimezone } from "@/lib/date-format";
import { formatCompactDuration, formatDurationExact } from "@/lib/uptime/number-format";
import { Link } from "@tanstack/react-router";
import { formatLatencyReason } from "@/lib/uptime/format";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUptimeIncidents } from "@/hooks/uptime";
import { useElapsedClock } from "@/hooks/useElapsedClock";
import { incidentDuration } from "@/lib/uptime/incident-duration";

interface IncidentsTabProps {
  monitorId: string;
  hasObservations?: boolean;
}

export function IncidentsTab({ monitorId, hasObservations }: IncidentsTabProps) {
  const { t, i18n } = useTranslation("uptimeMonitor");
  const accountTimezone = useAccountTimezone();
  const { data: incidents, isLoading, error, refetch } = useUptimeIncidents(monitorId, 50);
  const now = useElapsedClock(incidents?.some(incident => incident.status === "ongoing") ?? false);

  if (isLoading || (!incidents && !error)) {
    return <p role="status" className="py-8 text-sm text-muted-foreground">{t("workspace.loading")}</p>;
  }
  if (error && !incidents) {
    return <div className="space-y-3 py-8"><p role="alert">{t("incidents.loadError")}</p><Button variant="outline" onClick={() => void refetch()}>{t("workspace.retry")}</Button></div>;
  }

  if (!incidents || incidents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <AlertTriangle className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="font-medium">{t("incidents.empty", "No incidents recorded")}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {t(hasObservations === false ? "incidents.noObservations" : "incidents.emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-sm text-destructive">{t("incidents.loadError")}</p>}
      <p className="text-sm text-muted-foreground">{t("incidents.scope")} {t("incidents.statusHint")} {t("incidents.timezone", { timezone: formatTimezone(accountTimezone, i18n.language) })}</p>
      <div className="grid gap-3 md:hidden">{incidents.map(incident => <article key={incident.incidentId} className="min-w-0 rounded-md border bg-card p-3">
        <IncidentCard incident={incident} now={now} measuredState actions={<Link to="/dashboard/incidents" search={{ incidentId: incident.incidentId }} className="inline-flex min-h-11 items-center text-primary underline">{t("reliability.openIncident")}</Link>} />
      </article>)}</div>
      <div role="region" aria-label={t("tabs.incidents")} tabIndex={0} className="hidden max-h-[36rem] overflow-auto rounded-lg border md:block">
      <Table aria-label={t("tabs.incidents")} className="w-full table-fixed [&_th]:px-2 [&_td]:px-2">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[14%] whitespace-normal break-words text-start">{t("incidents.columns.status")}</TableHead>
            <TableHead className="w-[14%] whitespace-normal break-words text-start">{t("incidents.columns.duration")}</TableHead>
            <TableHead className="w-[22%] whitespace-normal break-words text-start">{t("incidents.columns.startedAt")}</TableHead>
            <TableHead className="w-[22%] whitespace-normal break-words text-start">{t("incidents.columns.resolvedAt")}</TableHead>
            <TableHead className="w-[28%] whitespace-normal break-words text-start">{t("incidents.columns.cause")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {incidents.map((incident) => {
            const duration = incidentDuration(incident, now);
            const exactDuration = formatDurationExact(duration, i18n.language, { start: incident.startedAt, end: incident.resolvedAt, timezone: accountTimezone });
            return (
            <TableRow key={incident.incidentId}>
              <TableCell>
                {incident.status === "ongoing" ? (
                  <Badge variant="outline" className="max-w-full whitespace-normal break-words [overflow-wrap:anywhere] border-destructive/30 bg-destructive/10 text-start text-destructive">
                    {t("incidents.status.ongoing")}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="max-w-full whitespace-normal break-words [overflow-wrap:anywhere] border-success/30 bg-success/10 text-start text-success">
                    {t("incidents.status.resolved")}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="whitespace-normal break-words [overflow-wrap:anywhere] tabular-nums">
                {exactDuration ? <TooltipProvider delayDuration={0}><Tooltip><TooltipTrigger asChild><span tabIndex={0} title={exactDuration} className="rounded-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{formatCompactDuration(duration, i18n.language)}</span></TooltipTrigger><TooltipContent>{exactDuration}</TooltipContent></Tooltip></TooltipProvider> : duration === null && incident.status === "ongoing" ? t("incidents.durationPending") : "—"}
              </TableCell>
              <TableCell className="whitespace-normal break-words [overflow-wrap:anywhere] text-xs text-muted-foreground">
                {Number.isFinite(Date.parse(incident.startedAt)) ? <IncidentTimestamp value={incident.startedAt} /> : t("incidents.durationPending")}
              </TableCell>
              <TableCell className="whitespace-normal break-words [overflow-wrap:anywhere] text-xs text-muted-foreground">
                {incident.resolvedAt
                  ? <IncidentTimestamp value={incident.resolvedAt} />
                  : "—"}
              </TableCell>
              <TableCell className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm text-muted-foreground">
                {formatLatencyReason(incident.cause, t)}
                <Link to="/dashboard/incidents" search={{ incidentId: incident.incidentId }} className="flex min-h-11 items-center text-primary underline">{t("reliability.openIncident")}</Link>
              </TableCell>
            </TableRow>
          );})}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
