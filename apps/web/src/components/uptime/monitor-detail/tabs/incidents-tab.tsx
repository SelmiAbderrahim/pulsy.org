import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUptimeIncidents } from "@/hooks/uptime";

interface IncidentsTabProps {
  monitorId: string;
}

function formatDuration(seconds: number | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (seconds == null) return "—";
  if (seconds < 60) return t("incidents.duration.seconds", { count: seconds });
  if (seconds < 3600) return t("incidents.duration.minutes", { count: Math.round(seconds / 60) });
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return t("incidents.duration.hours", { count: hours, minutes });
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.round((seconds % 86400) / 3600);
  return t("incidents.duration.days", { count: days, hours });
}

export function IncidentsTab({ monitorId }: IncidentsTabProps) {
  const { t } = useTranslation("uptimeMonitor");
  const { data: incidents } = useUptimeIncidents(monitorId, 50);

  if (!incidents || incidents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <AlertTriangle className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="font-medium">{t("incidents.empty", "No incidents recorded")}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {t("incidents.emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-start">{t("incidents.columns.status")}</TableHead>
            <TableHead className="text-start">{t("incidents.columns.startedAt")}</TableHead>
            <TableHead className="text-start">{t("incidents.columns.resolvedAt")}</TableHead>
            <TableHead className="text-start">{t("incidents.columns.duration")}</TableHead>
            <TableHead className="text-start">{t("incidents.columns.cause")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {incidents.map((incident) => (
            <TableRow key={incident.incidentId}>
              <TableCell>
                {incident.status === "ongoing" ? (
                  <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                    {t("incidents.status.ongoing")}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                    {t("incidents.status.resolved")}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(incident.startedAt).toLocaleString()}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {incident.resolvedAt
                  ? new Date(incident.resolvedAt).toLocaleString()
                  : "—"}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatDuration(incident.durationSeconds, t)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                {incident.cause ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
