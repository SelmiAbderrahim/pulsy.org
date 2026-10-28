import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAccountTimezone } from "@/components/account-timezone";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatIncidentTimestamp } from "@/lib/uptime/incident-time";
import { formatCompactDuration, formatDurationExact } from "@/lib/uptime/number-format";
import { formatLatencyReason } from "@/lib/uptime/format";
import { incidentDuration } from "@/lib/uptime/incident-duration";

export const TIME_SLOT = "\uFFFC";
export function IncidentTimestamp({ value, message }: { value: string; message?: string }) {
  const { i18n } = useTranslation("uptimeMonitor");
  const timezone = useAccountTimezone();
  const formatted = formatIncidentTimestamp(value, i18n.language, timezone);
  const time = <time dateTime={value} title={formatted}>{formatted}</time>;
  if (!message) return time;
  const parts = message.split(TIME_SLOT);
  return parts.length === 1 ? <>{message} {time}</> : <>{parts.map((part, index) => <Fragment key={index}>{index > 0 && time}{part}</Fragment>)}</>;
}

type CardIncident = {
  status: string; startedAt: string; resolvedAt?: string | null; durationSeconds: number | null;
  cause?: string | null; severity?: string | null; acknowledgedAt?: string | null; acknowledgedBy?: string | null; lastUpdatedAt?: string;
};

/** Shared facts and spacing for workspace rows and monitor-detail mobile cards. */
export function IncidentCard({ incident, now, title, health, actions, measuredState = false, acknowledgedBy }: {
  incident: CardIncident; now: number; title?: ReactNode; health?: ReactNode; actions?: ReactNode; measuredState?: boolean; acknowledgedBy?: string;
}) {
  const { t, i18n } = useTranslation("uptimeMonitor");
  const timezone = useAccountTimezone();
  const elapsed = incidentDuration(incident, now);
  const exactDuration = formatDurationExact(elapsed, i18n.language, { start: incident.startedAt, end: incident.status === "ongoing" ? now : incident.resolvedAt, timezone });
  const state = incident.status === "resolved" ? "resolved" : incident.acknowledgedAt ? "acknowledged" : "open";
  return <div className="grid min-w-0 gap-2" data-incident-card>
    {title}
    {health}
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {!measuredState && <span className="text-muted-foreground">{t("workspace.workflow")}:</span>}
      {/* Chips carry their category for assistive technology; the visible label stays short. */}
      <Badge variant={state === "resolved" ? "secondary" : state === "acknowledged" ? "outline" : "destructive"}>{measuredState && <span className="sr-only">{t("incidentUX.stateChip")}: </span>}{t(measuredState ? `incidents.status.${incident.status}` : `workspace.stateBadge.${state}`)}</Badge>
      <Badge variant="outline"><span className="sr-only">{t("workspace.severity")}: </span>{t(`workspace.severities.${incident.severity ?? "unknown"}`)}</Badge>
    </div>
    {incident.cause && <p className="break-words text-sm [overflow-wrap:anywhere]" dir="auto"><span className="text-muted-foreground">{t("workspace.openedBecause")}: </span>{formatLatencyReason(incident.cause, t)}</p>}
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"><IncidentTimestamp value={incident.startedAt} />{exactDuration ? <TooltipProvider delayDuration={0}><Tooltip><TooltipTrigger asChild><span tabIndex={0} title={exactDuration} className="whitespace-nowrap rounded-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{formatCompactDuration(elapsed, i18n.language)}</span></TooltipTrigger><TooltipContent className="max-w-[calc(100vw-2rem)] break-words">{exactDuration}</TooltipContent></Tooltip></TooltipProvider> : elapsed === null && incident.status === "ongoing" ? t("incidents.durationPending") : "—"}</p>
    {incident.lastUpdatedAt && <p className="text-xs text-muted-foreground"><IncidentTimestamp value={incident.lastUpdatedAt} message={t("workspace.updated", { time: TIME_SLOT })} /></p>}
    {incident.acknowledgedAt && <p className="text-xs text-muted-foreground">{acknowledgedBy && <span>{t("workspace.acknowledgedBy", { name: acknowledgedBy })} </span>}<IncidentTimestamp value={incident.acknowledgedAt} message={t("workspace.acknowledgedAt", { time: TIME_SLOT })} /></p>}
    {actions}
  </div>;
}
