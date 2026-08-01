import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from "recharts";
import type { UptimeCheckLog } from "@/types/uptime";

interface ResponseTimeChartProps {
  checkLogs: UptimeCheckLog[];
}

/**
 * Tooltip formatter: "<n>ms" + the series label. Exported so tests can assert
 * the formatting directly — recharts 3 computes hover state from real layout
 * geometry, which jsdom cannot provide.
 */
export function formatResponseTimeTooltip(
  value: unknown,
  label: string,
): [string, string] {
  return [`${value}ms`, label];
}

export function ResponseTimeChart({ checkLogs }: ResponseTimeChartProps) {
  const { t } = useTranslation("uptimeMonitor");

  const chartData = checkLogs
    .slice()
    .reverse()
    .map((log) => ({
      time: new Date(log.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      responseTime: log.responseTime ?? 0,
      status: log.status,
    }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">
          {t("overview.responseTime.title", "Response Time")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
            {t("history.empty", "No check logs yet")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="time"
                className="text-xs"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              />
              <YAxis
                className="text-xs"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                tickFormatter={(v: number) => `${v}ms`}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: 12,
                }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
                formatter={(value) =>
                  formatResponseTimeTooltip(value, t("overview.responseTime.title"))
                }
              />
              <Line
                type="monotone"
                dataKey="responseTime"
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
