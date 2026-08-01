import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Wifi,
  WifiOff,
  AlertTriangle,
  Clock,
  Play,
  Pause,
  Trash2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useDeleteUptimeMonitor,
  useToggleUptimeMonitor,
  useCheckNow,
} from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { UptimeMonitor } from "@/types/uptime";

interface MonitorDetailHeaderProps {
  monitor: UptimeMonitor;
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("uptimeMonitor");
  switch (status) {
    case "up":
      return (
        <Badge variant="outline" className="gap-1 border-success/25 bg-success/10 text-success">
          <Wifi className="h-3 w-3" />
          {t("status.up")}
        </Badge>
      );
    case "down":
      return (
        <Badge variant="destructive" className="gap-1">
          <WifiOff className="h-3 w-3" />
          {t("status.down")}
        </Badge>
      );
    case "degraded":
      return (
        <Badge variant="outline" className="gap-1 border-warning/35 bg-warning/10 text-warning">
          <AlertTriangle className="h-3 w-3" />
          {t("status.degraded")}
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1">
          <Clock className="h-3 w-3" />
          {t("status.pending")}
        </Badge>
      );
  }
}

export function MonitorDetailHeader({ monitor }: MonitorDetailHeaderProps) {
  const { t } = useTranslation("uptimeMonitor");
  const navigate = useNavigate();
  const deleteMutation = useDeleteUptimeMonitor();
  const toggleMutation = useToggleUptimeMonitor();
  const checkNowMutation = useCheckNow();

  const handleDelete = async () => {
    if (!confirm(t("delete.description", { name: monitor.name }))) return;
    try {
      await deleteMutation.mutateAsync({ uptimeMonitorId: monitor.uptimeMonitorId });
      toast.success(t("delete.success"));
      navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(extractErrorMessage(error, t("delete.error")));
    }
  };

  const handleToggle = async () => {
    try {
      await toggleMutation.mutateAsync({ uptimeMonitorId: monitor.uptimeMonitorId });
      toast.success(monitor.active ? t("toggle.disableSuccess") : t("toggle.enableSuccess"));
    } catch (error) {
      toast.error(extractErrorMessage(error, t("toggle.error")));
    }
  };

  const handleCheckNow = async () => {
    try {
      await checkNowMutation.mutateAsync({ uptimeMonitorId: monitor.uptimeMonitorId });
      toast.success(t("checkNow.success"));
    } catch (error) {
      toast.error(extractErrorMessage(error, t("checkNow.error")));
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Link to="/dashboard">
          <Button
            variant="ghost"
            size="icon"
            className="h-[44px] w-[44px]"
            aria-label={t("actions.back")}
            title={t("actions.back")}
          >
            <ArrowLeft className="h-4 w-4 rtl:scale-x-[-1]" />
          </Button>
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold">{monitor.name}</h1>
            <StatusBadge status={monitor.status} />
          </div>
          <p className="truncate text-sm text-muted-foreground">{monitor.url}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleCheckNow}
          disabled={checkNowMutation.isPending || !monitor.active}
          className="h-[44px]"
        >
          {checkNowMutation.isPending ? (
            <Loader2 className="h-4 w-4 me-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 me-2" />
          )}
          {t("actions.checkNow")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleToggle}
          disabled={toggleMutation.isPending}
          className="h-[44px]"
        >
          {monitor.active ? (
            <>
              <Pause className="h-4 w-4 me-2" />
              {t("actions.disable")}
            </>
          ) : (
            <>
              <Play className="h-4 w-4 me-2" />
              {t("actions.enable")}
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          className="h-[44px] text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4 me-2" />
          {t("actions.deleteMonitor")}
        </Button>
      </div>
    </div>
  );
}
