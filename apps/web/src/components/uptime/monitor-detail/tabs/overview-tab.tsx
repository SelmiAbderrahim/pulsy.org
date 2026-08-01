import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UptimeBarChart } from "../../charts/uptime-bar-chart";
import { ResponseTimeChart } from "../../charts/response-time-chart";
import {
  useUptimeMonitorStats,
  useUptimeCheckLogs,
} from "@/hooks/uptime";
import type { UptimeMonitor, UptimeBarDataPoint } from "@/types/uptime";

interface OverviewTabProps {
  monitor: UptimeMonitor;
}

export function OverviewTab({ monitor }: OverviewTabProps) {
  const { t } = useTranslation("uptimeMonitor");
  const { data: stats } = useUptimeMonitorStats(monitor.uptimeMonitorId, 30);
  const { data: checkLogs } = useUptimeCheckLogs(monitor.uptimeMonitorId, {
    limit: 100,
  });
  const logs = checkLogs?.data ?? [];

  // Generate 90-day uptime bar data from check logs
  const uptimeBarData: UptimeBarDataPoint[] = generateUptimeBarData(logs);

  const statCards = [
    {
      label: t("overview.stats.totalChecks", "Total Checks"),
      value: stats?.totalChecks ?? 0,
    },
    {
      label: t("overview.stats.successRate", "Success Rate"),
      value: formatPercent(stats?.uptimePercentage, 1),
    },
    {
      label: t("overview.stats.avgResponse", "Avg Response"),
      value: stats?.avgResponseTime ? `${Math.round(stats.avgResponseTime)}ms` : "—",
    },
    {
      label: t("detail.uptime30d", "Uptime (30 days)"),
      value: monitor.uptimePercentage != null
        ? `${monitor.uptimePercentage.toFixed(2)}%`
        : "—",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <p className="text-2xl font-semibold tabular-nums">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 90-day uptime bar */}
      <UptimeBarChart data={uptimeBarData} />

      {/* Response time chart */}
      <ResponseTimeChart checkLogs={logs} />

      {/* Monitor info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            {t("detail.method", "Method")} & {t("detail.interval", "Interval")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("detail.method")}</dt>
              <dd className="font-medium">{monitor.method}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("detail.interval")}</dt>
              <dd className="font-medium">{t(`intervals.${monitor.interval}`, `${monitor.interval}s`)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("detail.timeout")}</dt>
              <dd className="font-medium">{monitor.timeout}ms</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("detail.failureThreshold")}</dt>
              <dd className="font-medium">{monitor.failureThreshold}</dd>
            </div>
            {monitor.tlsExpiresInDays != null && (
              <div>
                <dt className="text-muted-foreground">{t("detail.tls.title")}</dt>
                <dd className="font-medium">
                  {t("detail.tls.expiresInDays", { days: monitor.tlsExpiresInDays })}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function formatPercent(value: number | null | undefined, digits: number): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(digits)}%`
    : "—";
}

/**
 * Generate daily uptime bar data from raw check logs.
 * Returns array of { date, status, uptimePercent } for each of the last 90 days.
 */
function generateUptimeBarData(
  checkLogs: { createdAt: string; status: string }[],
): UptimeBarDataPoint[] {
  const days = 90;
  const now = new Date();
  const result: UptimeBarDataPoint[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0]!;

    const dayLogs = checkLogs.filter(
      (log) => log.createdAt.startsWith(dateStr),
    );

    if (dayLogs.length === 0) {
      result.push({ date: dateStr, status: "up", uptimePercent: 100 });
      continue;
    }

    const upCount = dayLogs.filter((l) => l.status === "up").length;
    const uptimePercent = (upCount / dayLogs.length) * 100;

    let status: UptimeBarDataPoint["status"] = "up";
    if (uptimePercent === 0) status = "down";
    else if (uptimePercent < 100) status = "partial";

    result.push({ date: dateStr, status, uptimePercent });
  }

  return result;
}
