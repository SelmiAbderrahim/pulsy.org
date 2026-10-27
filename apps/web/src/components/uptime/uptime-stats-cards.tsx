import { formattingLocale } from "@/lib/formatting-locale";
import { STATS_WINDOW_DAYS } from "@/lib/uptime/stats-window";
import { Unit } from "@/components/ui/unit";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { formatPercent } from "@/lib/uptime/number-format";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Wifi, WifiOff, Pause, Hourglass, CircleDot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { UptimeDashboardSummary } from "@/types/uptime";

import type { StatusFilter } from "@/lib/uptime/dashboard-search";

interface StatCard {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color?: string;
  /** Status this card filters by, if any. */
  filter?: StatusFilter;
  /** When true, clicking the card clears the active status filter. */
  clearsFilter?: boolean;
}

interface UptimeStatsCardsProps {
  summary: UptimeDashboardSummary;
  selectedStatus?: StatusFilter;
  onStatusChange?: (status: StatusFilter | undefined) => void;
}

export function UptimeStatsCards({
  summary,
  selectedStatus,
  onStatusChange,
}: UptimeStatsCardsProps) {
  const { t, i18n } = useTranslation("uptimeMonitor");

  const cards: StatCard[] = [
    {
      label: t("dashboard.totalShort", "Total"),
      value: summary.totalMonitors,
      icon: CircleDot,
      // Total acts as "clear filter" when a status filter is active.
      clearsFilter: true,
    },
    {
      label: t("dashboard.monitorsUp", "Up"),
      value: summary.monitorsUp,
      icon: Wifi,
      color: "text-success",
      filter: "up",
    },
    {
      label: t("dashboard.monitorsDown", "Down"),
      value: summary.monitorsDown,
      icon: WifiOff,
      color: "text-destructive",
      filter: "down",
    },
    {
      label: t("dashboard.monitorsDegraded", "Degraded"),
      value: summary.monitorsDegraded,
      icon: AlertTriangle,
      color: "text-warning",
      filter: "degraded",
    },
    {
      label: t("dashboard.monitorsPending", "Pending"),
      value: summary.monitorsPending,
      icon: Hourglass,
      filter: "pending",
      color: "text-muted-foreground",
    },
    {
      label: t("dashboard.monitorsPaused", "Paused"),
      value: summary.monitorsPaused,
      icon: Pause,
      color: "text-muted-foreground",
    },
  ];

  return (
    <section aria-label={t("dashboard.healthSummary")} className="min-w-0 rounded-lg border bg-card p-3 sm:p-4">
      <div className="grid min-w-0 grid-cols-2 items-center gap-2 sm:grid-cols-3 sm:gap-4">
        {cards.map(card => {
          const clickable = onStatusChange != null;
          const active = card.filter != null && selectedStatus === card.filter;
          const content = <><card.icon aria-hidden="true" className={cn("size-4 shrink-0", card.color)} /><span className="font-semibold tabular-nums">{new Intl.NumberFormat(formattingLocale(i18n.language)).format(Number(card.value))}</span><span>{card.label}</span></>;
          return clickable ? (
            <button key={card.label} type="button" aria-label={`${card.label}: ${new Intl.NumberFormat(formattingLocale(i18n.language)).format(Number(card.value))}`} aria-pressed={active} className={cn("flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 text-start text-sm transition-colors duration-150", active ? "bg-accent ring-1 ring-primary" : "hover:bg-muted")}
              onClick={() => onStatusChange(card.clearsFilter || active ? undefined : card.filter)}>{content}</button>
          ) : <div key={card.label} className="flex min-h-11 items-center gap-2 text-sm">{content}</div>;
        })}
        <Collapsible className="col-span-full min-w-0 border-t pt-2">
          <CollapsibleTrigger>
            <span className="ms-1 inline-flex max-w-full flex-wrap items-center gap-x-1" title={t("dashboard.averageTooltip", "Equal-weight average across monitors with recorded checks in the rolling window.")}><span className="whitespace-nowrap">{t("dashboard.avgUptime", "Average check success")}</span> <Unit className="font-semibold">{formatPercent(summary.avgUptimePercentage, i18n.language) ?? t("metrics.noData", "No data")}</Unit> <span className="whitespace-nowrap text-muted-foreground">{t("dashboard.rollingWindow", { count: STATS_WINDOW_DAYS })}</span></span>
          </CollapsibleTrigger><CollapsibleContent>
          <p className="max-w-prose py-2 text-sm text-muted-foreground">{t("metrics.averageBasis", { count: summary.uptimeMonitorsWithData ?? 0 })}</p>
        </CollapsibleContent></Collapsible>
      </div>
    </section>
  );
}
