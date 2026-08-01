import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUptimeCheckLogs } from "@/hooks/uptime";

interface HistoryTabProps {
  monitorId: string;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "up"
      ? "bg-success"
      : status === "down"
        ? "bg-destructive"
        : "bg-warning";
  return <span className={`inline-block h-2 w-2 rounded-xs ${color}`} />;
}

export function HistoryTab({ monitorId }: HistoryTabProps) {
  const { t } = useTranslation("uptimeMonitor");
  const { data: checkLogs } = useUptimeCheckLogs(monitorId, { limit: 100 });
  const logs = checkLogs?.data ?? [];

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <Clock className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="font-medium">{t("history.empty")}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {t("history.emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-full overflow-x-auto rounded-lg border">
      <Table className="min-w-[640px]">
        <TableHeader>
          <TableRow>
            <TableHead className="text-start">{t("history.columns.time")}</TableHead>
            <TableHead className="text-start">{t("history.columns.status")}</TableHead>
            <TableHead className="text-start">{t("history.columns.httpStatus")}</TableHead>
            <TableHead className="text-start">{t("history.columns.responseTime")}</TableHead>
            <TableHead className="text-start">{t("history.columns.error")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow key={log.checkLogId}>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(log.createdAt).toLocaleString()}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <StatusDot status={log.status} />
                  <span className="text-sm capitalize">{log.status}</span>
                </div>
              </TableCell>
              <TableCell className="tabular-nums">
                {log.httpStatus ?? "—"}
              </TableCell>
              <TableCell className="tabular-nums">
                {log.responseTime != null ? `${log.responseTime}ms` : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-[250px] truncate">
                {log.errorMessage ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
