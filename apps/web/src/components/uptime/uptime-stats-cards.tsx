import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Clock, Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { UptimeDashboardSummary } from "@/types/uptime";

type StatusFilter = "up" | "down" | "degraded";

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
  const { t } = useTranslation("uptimeMonitor");

  const cards: StatCard[] = [
    {
      label: t("dashboard.totalMonitors", "Total Monitors"),
      value: summary.totalMonitors,
      icon: Wifi,
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
      label: t("dashboard.avgUptime", "Avg Uptime"),
      value: `${(summary.avgUptime ?? 0).toFixed(2)}%`,
      icon: Clock,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => {
        const isClickable =
          onStatusChange != null && (card.filter != null || card.clearsFilter);
        const isActive = card.filter != null && selectedStatus === card.filter;

        const content = (
          <CardContent className="flex items-center gap-3 p-4">
            <card.icon
              className={`h-5 w-5 shrink-0 ${card.color ?? "text-muted-foreground"}`}
            />
            <div className="min-w-0">
              <p className="text-2xl font-semibold tabular-nums">{card.value}</p>
              <p className="truncate text-xs text-muted-foreground">
                {card.label}
              </p>
            </div>
          </CardContent>
        );

        if (!isClickable) {
          return <Card key={card.label}>{content}</Card>;
        }

        const handleClick = () => {
          if (card.clearsFilter) {
            onStatusChange?.(undefined);
          } else if (card.filter != null) {
            // Toggle: clicking the active filter clears it.
            onStatusChange?.(isActive ? undefined : card.filter);
          }
        };

        return (
          <Card key={card.label} className="p-0">
            <button
              type="button"
              onClick={handleClick}
              aria-pressed={isActive}
              className={cn(
                "w-full rounded-lg text-start transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                isActive ? "ring-1 ring-primary" : "hover:bg-muted/50",
              )}
            >
              {content}
            </button>
          </Card>
        );
      })}
    </div>
  );
}
