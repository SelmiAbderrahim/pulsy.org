import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { UptimeBarDataPoint } from "@/types/uptime";

interface UptimeBarChartProps {
  data: UptimeBarDataPoint[];
}

function getBarColor(status: string, uptimePercent: number): string {
  if (status === "up" || uptimePercent === 100) return "bg-success";
  if (status === "down" || uptimePercent === 0) return "bg-destructive";
  if (status === "degraded" || uptimePercent < 100) return "bg-warning";
  return "bg-muted";
}

export function UptimeBarChart({ data }: UptimeBarChartProps) {
  const { t } = useTranslation("uptimeMonitor");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">
          {t("overview.uptimeBar.title", "Uptime (90 days)")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={0}>
          <div className="flex items-end gap-px">
            {data.map((point, i) => (
              <Tooltip key={point.date}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "flex-1 rounded-xs min-w-[2px] cursor-default transition-opacity hover:opacity-80",
                      getBarColor(point.status, point.uptimePercent),
                    )}
                    style={{ height: `${Math.max(4, (point.uptimePercent / 100) * 32)}px` }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-medium">{new Date(point.date).toLocaleDateString()}</p>
                  <p className="text-xs">
                    {t("overview.uptimeBar.percentUptime", { percent: point.uptimePercent.toFixed(1) })}
                  </p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>{t("overview.uptimeBar.daysAgo", { days: data.length, defaultValue: `${data.length} days ago` })}</span>
            <span>{t("overview.uptimeBar.today", "Today")}</span>
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
