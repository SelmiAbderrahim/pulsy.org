import { formattingLocale } from "@/lib/formatting-locale";
import { STATS_WINDOW_DAYS } from "@/lib/uptime/stats-window";
import { Unit } from "@/components/ui/unit";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReactNode } from "react";
import { formatInterval } from "@/lib/uptime/format";
import { formatMilliseconds, formatPercent } from "@/lib/uptime/number-format";
import { Link } from "@tanstack/react-router";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/ui/section-card";
import { UptimeBarChart } from "../../charts/uptime-bar-chart";
import { ResponseTimeChart } from "../../charts/response-time-chart";
import {
  useUptimeMonitorStats,
  useUptimeCheckLogs,
  useUptimeDailyUptime,
} from "@/hooks/uptime";
import type { UptimeMonitor } from "@/types/uptime";

interface OverviewTabProps {
  monitor: UptimeMonitor;
}

export function OverviewTab({ monitor }: OverviewTabProps) {
  const { t, i18n } = useTranslation("uptimeMonitor");
  const statsQuery = useUptimeMonitorStats(monitor.uptimeMonitorId, 30);
  const { data: stats } = statsQuery;
  const logsQuery = useUptimeCheckLogs(monitor.uptimeMonitorId, {
    limit: 100,
  });
  const logs = logsQuery.data?.data ?? [];
  const number = new Intl.NumberFormat(formattingLocale(i18n.language));
  const percent = (value: number | null | undefined) => formatPercent(value, i18n.language) ?? "—";

  const daily = useUptimeDailyUptime(monitor.uptimeMonitorId, 90);

  const timingLabel = monitor.monitorType === "dns" ? t("network.dnsTiming") : monitor.monitorType === "tcp" ? t("network.tcpTiming") : undefined;
  const statCards = [
    {
      label: t("overview.stats.totalChecks", "Total checks"),
      value: stats?.totalChecks == null ? "—" : number.format(stats.totalChecks),
    },
    {
      label: t("overview.stats.successRate", "Check success ({{days}}d)", { days: STATS_WINDOW_DAYS }),
      value: percent(stats?.uptimePercentage),
    },
    {
      label: timingLabel ? t("network.averageTiming") : t("overview.stats.avgResponse", "Average response ({{count}} days)", { count: STATS_WINDOW_DAYS }),
      value: formatMilliseconds(stats?.avgResponseTime == null ? null : Math.round(stats.avgResponseTime), i18n.language) ?? "—",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {timingLabel && <div className="grid min-w-0 gap-2 text-sm text-muted-foreground"><p>{t(monitor.monitorType === "tcp" ? "network.tcpMeaning" : "network.dnsMeaning")} <DocsHelpLink docPath="dns-tcp" /></p><p>{t("network.timingMeaning")}</p></div>}
      {statsQuery.isPending && <p role="status" className="sr-only">{t("metrics.loading", "Loading statistics…")}</p>}
      {statsQuery.error && <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
        <p>{t("metrics.error", "Statistics unavailable. Try again.")}</p>
        <Button variant="outline" className="min-h-[44px]" onClick={() => statsQuery.refetch()}>{t("metrics.retry", "Retry statistics")}</Button>
      </div>}
      {!statsQuery.isPending && !statsQuery.error && stats?.totalChecks === 0 && <p role="status" className="text-sm text-muted-foreground">{monitor.active && !monitor.lastCheckedAt ? t("metrics.collecting", "Waiting for the first check. Check success appears after a recorded result.") : t("metrics.noChecks", "No recorded checks in the last {{count}} days.", { count: STATS_WINDOW_DAYS })}</p>}
      <p className="text-sm text-muted-foreground">{t("overview.period", { count: STATS_WINDOW_DAYS })}</p>
      <OverviewStatCards cards={statCards} />
      <OverviewMeasurementNotes breakdown={stats && stats.totalChecks > 0 ? t("overview.stats.breakdown", "{{up}} up · {{degraded}} degraded · {{down}} down", { up: number.format(stats.upChecks), degraded: number.format(stats.degradedChecks), down: number.format(stats.downChecks) }) : undefined} />

      {/* 90-day uptime bar */}
      <UptimeBarChart data={daily.data ?? []} isLoading={daily.isPending} error={daily.error} onRetry={() => daily.refetch()} />

      {/* Response time chart */}
      <ResponseTimeChart monitorType={monitor.monitorType} timingLabel={timingLabel} checkLogs={logs} thresholdMs={monitor.latencyPolicy?.thresholdMs} recoveryThresholdMs={monitor.latencyPolicy?.recoveryThresholdMs} intervalSeconds={monitor.interval} isLoading={logsQuery.isPending} error={logsQuery.error} onRetry={() => void logsQuery.refetch()} />

      {/* Monitor info */}
      <SectionCard title={t("detailUX.configuration")} headerEnd={<Button asChild variant="link" className="w-fit px-0"><Link to="/dashboard/uptime/$monitorId" params={{ monitorId: monitor.uptimeMonitorId }} search={{ tab: "settings" }}>{t("tabs.settings")}</Link></Button>}>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
            <div>
              <dt className="text-muted-foreground">{timingLabel ? t("network.type") : t("detail.method")}</dt>
              <dd className="font-medium">{timingLabel ? monitor.monitorType?.toUpperCase() : monitor.method}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("detail.interval")}</dt>
              <dd className="font-medium">{formatInterval(monitor.interval, t, i18n.language)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("detail.timeout")}</dt>
              <dd className="font-medium"><Unit>{formatMilliseconds(monitor.timeout, i18n.language) ?? "—"}</Unit></dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("detail.failureThreshold")}</dt>
              <dd className="font-medium">{monitor.failureThreshold}</dd>
            </div>
            {monitor.tlsExpiresInDays != null && (
              <div>
                <dt className="text-muted-foreground">{t("detail.tls.title")}</dt>
                <dd className="font-medium">
                  {t("detail.tls.expiresInDays", { days: monitor.tlsExpiresInDays, count: monitor.tlsExpiresInDays })}
                </dd>
              </div>
            )}
          </dl>
      </SectionCard>
    </div>
  );
}

function OverviewStatCards({ cards }: { cards: Array<{ label: string; value: ReactNode }> }) {
  return <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{cards.map((stat, index) => <Card key={stat.label} className={index === 2 ? "col-span-2 sm:col-span-1" : undefined}>
    <CardContent className="p-4"><p className="text-2xl font-semibold tabular-nums">{typeof stat.value === "string" ? <Unit>{stat.value}</Unit> : stat.value}</p><p className="text-xs text-muted-foreground">{stat.label}</p></CardContent>
  </Card>)}</div>;
}

function OverviewMeasurementNotes({ breakdown }: { breakdown?: string }) {
  const { t } = useTranslation("uptimeMonitor");
  return <>
    <p data-overview-breakdown className="min-h-4 text-xs text-muted-foreground tabular-nums">{breakdown}</p>
    <p className="text-xs text-muted-foreground">{t("metrics.windowBasis", "Rolling 30 days: successful recorded checks / total recorded checks. Missing history is unknown; this is not continuous duration-based availability.")}</p>
    <p className="text-xs text-muted-foreground">{t("metrics.responseBasis")}</p>
  </>;
}

/** Uses the real cards and chart loading layouts so translated text wraps identically. */
export function OverviewTabSkeleton() {
  const { t } = useTranslation("uptimeMonitor");
  return <div className="flex flex-col gap-4">
    <OverviewStatCards cards={[
      { label: t("overview.stats.totalChecks", "Total checks"), value: <span aria-hidden className="block h-8 w-24 rounded-md bg-muted" /> },
      { label: t("overview.stats.successRate", "Check success ({{days}}d)", { days: STATS_WINDOW_DAYS }), value: <span aria-hidden className="block h-8 w-24 rounded-md bg-muted" /> },
      { label: t("overview.stats.avgResponse", "Average response ({{count}} days)", { count: STATS_WINDOW_DAYS }), value: <span aria-hidden className="block h-8 w-24 rounded-md bg-muted" /> },
    ]} />
    <OverviewMeasurementNotes />
    <UptimeBarChart data={[]} isLoading />
    <ResponseTimeChart checkLogs={[]} isLoading />
    <SectionCard aria-hidden title={<Skeleton className="h-6 w-40" />}><div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[0,1,2,3].map(index => <div key={index} className="grid gap-2"><Skeleton className="h-5 w-24" /><Skeleton className="h-5 w-16" /></div>)}</div></SectionCard>
  </div>;
}
