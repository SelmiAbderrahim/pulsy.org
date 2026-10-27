import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
export function HeartbeatStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("uptimeMonitor");
  const label = status === "pending" ? "new" : status === "degraded" ? "late" : status;
  return <Badge variant="outline" className={status === "down" ? "border-destructive/30 bg-destructive/10 text-destructive" : status === "up" ? "border-success/30 bg-success/10 text-success" : status === "degraded" ? "border-warning/30 bg-warning/10 text-warning" : "text-muted-foreground"}>{t(`heartbeat.${label}`)}</Badge>;
}
