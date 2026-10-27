import { useQueryClient } from "@tanstack/react-query";
import { isSessionClientActive } from "@/lib/session-query-client";
import { useAccountTimezone } from "@/components/account-timezone";
import { useId, useState } from "react";
import { RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { requestConfirmation } from "@/lib/confirmation";
import { useElapsedClock } from "@/hooks/useElapsedClock";
import { portableHttpUrl } from "@pulsy/db/monitor-manifest";
import { HeartbeatStatusBadge } from "@/components/uptime/heartbeat-status-badge";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  MoreHorizontal,
  Copy,
  BookmarkPlus,
  RefreshCw,
  Wifi,
  WifiOff,
  AlertTriangle,
  Clock,
  Play,
  Pause,
  Trash2,
  Loader2,
  Settings2,
  Share2,
  Info,
} from "lucide-react";
import { toast } from "@/lib/toast";

import { formatInterval, isAwaitingFirstCheck, isStaleObservation } from "@/lib/uptime/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button, DisabledReason } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useDeleteUptimeMonitor,
  useToggleUptimeMonitor,
  useCheckNow,
} from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { UptimeMonitor } from "@/types/uptime";
import { SuppressionBadge } from "@/components/uptime/maintenance-controls";
import { MonitorReuseActions } from "@/components/uptime/monitor-reuse-controls";
import { ShareMonitorsDialog } from "@/components/uptime/share/share-monitors-dialog";

interface MonitorDetailHeaderProps {
  monitor: UptimeMonitor;
}

function StatusBadge({ status, monitorType, checking = false }: { status: string; monitorType?: string; checking?: boolean }) {
  const { t } = useTranslation("uptimeMonitor");
  if (monitorType === "heartbeat") return <HeartbeatStatusBadge status={status} />;
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
      return checking ? (
        <Badge variant="outline" className="gap-1">
          <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
          {t("status.checking")}
        </Badge>
      ) : (
        <Badge variant="outline" className="gap-1">
          <Clock className="h-3 w-3" />
          {t("status.pending")}
        </Badge>
      );
  }
}

export function MonitorDetailHeader({ monitor }: MonitorDetailHeaderProps) {
  const accountTimezone = useAccountTimezone();
  const client = useQueryClient();
  const { t, i18n } = useTranslation("uptimeMonitor");
  const navigate = useNavigate();
  const now = useElapsedClock(Boolean(monitor.lastCheckedAt));
  const deleteMutation = useDeleteUptimeMonitor();
  const [shareOpen, setShareOpen] = useState(false);
  const toggleMutation = useToggleUptimeMonitor();
  const checkNowMutation = useCheckNow();
  const checkReasonId = useId();
  // Heartbeat and server monitors receive pings/agent reports; there is nothing to check on demand.
  const pushBased = monitor.monitorType === "heartbeat" || monitor.monitorType === "server";
  const awaitingFirstReport = monitor.monitorType === "server" && monitor.active && monitor.status === "pending" && !monitor.lastCheckedAt;
  const checkDisabledReason = !monitor.active ? `${t("status.paused")} · ${t("actions.enable")}`
    : checkNowMutation.isPending ? t("common:states.loading") : undefined;

  const handleDelete = async () => {
    if (!await requestConfirmation(t("delete.description", { name: monitor.name }), { title: t("delete.title"), action: t("actions.delete") }) || !isSessionClientActive(client)) return;
    try {
      await deleteMutation.mutateAsync({ uptimeMonitorId: monitor.uptimeMonitorId });
 if (!isSessionClientActive(client)) return;
      toast.success(t("delete.success"));
      navigate({ to: "/dashboard" });
    } catch (error) {
 if (!isSessionClientActive(client)) return;
      toast.error(extractErrorMessage(error, t("delete.error")));
    }
  };

  const handleToggle = async () => {
    try {
      await toggleMutation.mutateAsync({ uptimeMonitorId: monitor.uptimeMonitorId });
 if (!isSessionClientActive(client)) return;
      toast.success(monitor.active ? t("toggle.disableSuccess") : t("toggle.enableSuccess"));
    } catch (error) {
 if (!isSessionClientActive(client)) return;
      toast.error(extractErrorMessage(error, t("toggle.error")));
    }
  };

  const handleCheckNow = async () => {
    if (pushBased || checkDisabledReason) return;
    try {
      await checkNowMutation.mutateAsync({ uptimeMonitorId: monitor.uptimeMonitorId });
 if (!isSessionClientActive(client)) return;
      toast.success(t("checkNow.success"));
    } catch (error) {
 if (!isSessionClientActive(client)) return;
      toast.error(extractErrorMessage(error, t("checkNow.error")));
    }
  };

  let safeHttpEndpoint = portableHttpUrl(monitor.url ?? "");
  if (!safeHttpEndpoint) { try { safeHttpEndpoint = new URL(monitor.url).origin + "/…"; } catch { safeHttpEndpoint = "—"; } }
  const endpoint = monitor.networkConfig ? `${monitor.networkConfig.hostname}${monitor.networkConfig.type === "tcp" ? `:${monitor.networkConfig.port}` : ` · ${monitor.networkConfig.recordType}`}` : safeHttpEndpoint;
  const copyEndpoint = async () => {
    try { await navigator.clipboard.writeText(endpoint); if (!isSessionClientActive(client)) return; toast.success(t("detailUX.copied")); }
    catch { if (!isSessionClientActive(client)) return; toast.error(t("detailUX.copyFailed")); }
  };
  const lastChecked = monitor.lastCheckedAt ? new Date(monitor.lastCheckedAt) : null;
  return <header data-monitor-detail-header className="grid min-w-0 gap-3">
    <nav aria-label={t("detailUX.breadcrumb")} className="flex min-h-11 items-center text-sm"><Link to="/dashboard" className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">{t("detailUX.monitors")}</Link><span aria-hidden className="mx-2">/</span><span className="min-w-0 break-words" aria-current="page"><bdi>{monitor.name}</bdi></span></nav>
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="grid min-w-0 flex-1 gap-2">
        <h1 className="app-title break-words"><bdi>{monitor.name}</bdi></h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{monitor.monitorType === "server" ? t("server.title") : monitor.monitorType === "heartbeat" ? t("heartbeat.title") : (monitor.monitorType ?? "HTTP").toUpperCase()}</Badge>
          {monitor.active ? <StatusBadge status={monitor.status} monitorType={monitor.monitorType} checking={isAwaitingFirstCheck(monitor)} /> : <Badge variant="secondary"><Pause className="me-1 h-3 w-3" />{t("status.paused", "Paused")}</Badge>}
          {awaitingFirstReport && <TooltipProvider delayDuration={0}><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={t("server.pending")} className="text-muted-foreground"><Info aria-hidden className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent className="max-w-[calc(100vw-2rem)] sm:max-w-80">{t("server.awaitingHint", { interval: formatInterval(monitor.interval, t, i18n.language) })}</TooltipContent></Tooltip></TooltipProvider>}
          <SuppressionBadge value={monitor.alertSuppression} />
          {isStaleObservation(monitor, now) && <Badge variant="outline" title={t("metrics.staleDescription")}>{t("metrics.stale")}</Badge>}
          {monitor.latencyPolicy && monitor.status !== "up" && <Badge variant="outline">{t("detailUX.severity", { severity: t(`latency.${monitor.latencyPolicy.importance}`) })}</Badge>}
        </div>
        <div data-monitor-detail-metadata className="flex min-h-11 min-w-0 items-center gap-2">{monitor.monitorType === "heartbeat" || monitor.monitorType === "server" ? <p className="text-sm text-muted-foreground">{t("detail.interval")}: <bdi>{formatInterval(monitor.interval, t, i18n.language)}</bdi></p> : <><p className="min-w-0 break-all text-sm text-muted-foreground"><bdi dir="ltr">{endpoint}</bdi></p><Button type="button" variant="ghost" size="icon" aria-label={t("detailUX.copyEndpoint")} onClick={() => void copyEndpoint()}><Copy className="h-4 w-4" /></Button></>}</div>
        <p data-monitor-detail-timestamp className="min-h-5 text-sm text-muted-foreground">{monitor.monitorType === "heartbeat" ? <span title={t("heartbeat.lastEvaluatedHint")}>{t("heartbeat.lastEvaluated")}</span> : t("list.columns.lastChecked")}: <RelativeTime value={lastChecked} locale={i18n.language} timezone={accountTimezone} now={now} /></p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {!pushBased && <><DisabledReason reason={checkDisabledReason}><Button variant="outline" onClick={handleCheckNow} disabled={Boolean(checkDisabledReason)} aria-describedby={checkDisabledReason ? checkReasonId : undefined}>{checkNowMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw aria-hidden className="h-4 w-4" />}{t("actions.checkNow")}</Button></DisabledReason>
        {checkDisabledReason && <span id={checkReasonId} className="sr-only">{checkDisabledReason}</span>}</>}
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label={t("detailUX.more", { name: monitor.name })}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
          {!pushBased && <><DropdownMenuItem disabled={Boolean(checkDisabledReason)} aria-describedby={checkDisabledReason ? `${checkReasonId}-menu` : undefined} onSelect={() => void handleCheckNow()}><RefreshCw className="h-4 w-4" />{t("actions.checkNow")}</DropdownMenuItem>
          {checkDisabledReason && <p id={`${checkReasonId}-menu`} className="max-w-64 whitespace-normal px-2 pb-2 text-xs text-muted-foreground">{checkDisabledReason}</p>}</>}
          <DropdownMenuItem asChild><Link to="/dashboard/uptime/$monitorId" params={{ monitorId: monitor.uptimeMonitorId }} search={{ tab: "settings" }}><Settings2 className="h-4 w-4" />{t("tabs.settings")}</Link></DropdownMenuItem>
          {monitor.monitorType !== "heartbeat" && monitor.monitorType !== "server" && <MonitorReuseActions monitorId={monitor.uptimeMonitorId}>{({ duplicate, saveTemplate, busy }) => <><DropdownMenuItem disabled={busy} onSelect={duplicate}><Copy className="h-4 w-4" />{t("templates.duplicate")}</DropdownMenuItem><DropdownMenuItem disabled={busy} onSelect={saveTemplate}><BookmarkPlus className="h-4 w-4" />{t("templates.fromMonitor")}</DropdownMenuItem></>}</MonitorReuseActions>}
          {(monitor.monitorType ?? "http") === "http" && <DropdownMenuItem onSelect={() => setShareOpen(true)}><Share2 className="h-4 w-4" />{t("share.button", "Share")}</DropdownMenuItem>}
          <DropdownMenuItem disabled={toggleMutation.isPending} onSelect={() => void handleToggle()}>{monitor.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{t(monitor.active ? "actions.disable" : "actions.enable")}</DropdownMenuItem>
          <DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" disabled={deleteMutation.isPending} onSelect={() => void handleDelete()}><Trash2 className="h-4 w-4" />{t("actions.deleteMonitor", "Delete monitor")}</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
        {(monitor.monitorType ?? "http") === "http" && <ShareMonitorsDialog open={shareOpen} onOpenChange={setShareOpen} monitors={[monitor]} />}
      </div>
    </div>
  </header>;
}

/** Matches the header's line boxes, badge row, endpoint, timestamp, and action controls. */
export function MonitorDetailHeaderSkeleton() {
  const { t } = useTranslation(["uptimeMonitor", "common"]);
  return <header data-monitor-detail-header data-monitor-detail-loading className="grid min-w-0 gap-3" aria-busy="true">
    <p role="status" className="sr-only">{t("common:states.loading")}</p>
    <nav aria-label={t("detailUX.breadcrumb")} className="flex min-h-11 items-center text-sm">
      <Link to="/dashboard" className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">{t("detailUX.monitors")}</Link>
      <span aria-hidden className="mx-2">/</span><Skeleton aria-hidden className="h-5 w-32" />
    </nav>
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="grid min-w-0 flex-1 gap-2">
        <h1 className="app-title"><span className="sr-only">{t("detailUX.monitors")}</span><span className="block h-8 w-52 max-w-full rounded-md bg-muted md:h-9" /></h1>
        <div className="flex min-h-6 items-center gap-2"><Skeleton className="h-6 w-16" /><Skeleton className="h-6 w-20" /><Skeleton className="h-6 w-24" /></div>
        <div data-monitor-detail-metadata className="flex min-h-11 min-w-0 items-center gap-2"><Skeleton className="h-5 w-60 max-w-full" /><Skeleton className="h-11 w-11 shrink-0" /></div>
        <Skeleton data-monitor-detail-timestamp className="h-5 w-44" />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2"><Skeleton className="h-11 w-32" /><Skeleton className="h-11 w-11" /></div>
    </div>
  </header>;
}
