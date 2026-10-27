import { useAccountTimezone } from "@/components/account-timezone";
import { formatDate } from "@/lib/date-format";
import { ServerPanel } from "@/components/uptime/server-health-controls";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ReliabilityPanel } from "@/components/uptime/reliability-panel";
import { NetworkPanel } from "@/components/uptime/network-controls";
/**
 * Monitor detail route with six canonical, URL-persisted tabs.
 *
 * @module routes/_app/dashboard.uptime.$monitorId
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isMissingResource } from "@/lib/api/is-missing-resource";
import { PageNotFound } from "@/components/page-not-found";
import { useCallback, useEffect } from "react";
import { canonicalMonitorTab, monitorTabSearch } from "@/lib/uptime/monitor-tabs";
import { useTranslation } from "react-i18next";
import { ChevronDown, SearchX } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";

import { MonitorDetailHeader, MonitorDetailHeaderSkeleton } from "@/components/uptime/monitor-detail/monitor-detail-header";
import { HistoryTab } from "@/components/uptime/monitor-detail/tabs/history-tab";
import { IncidentsTab } from "@/components/uptime/monitor-detail/tabs/incidents-tab";
import { NotificationsTab } from "@/components/uptime/monitor-detail/tabs/notifications-tab";
import { OverviewTab, OverviewTabSkeleton } from "@/components/uptime/monitor-detail/tabs/overview-tab";
import { SettingsTab } from "@/components/uptime/monitor-detail/tabs/settings-tab";
import { SlaReportTab } from "@/components/uptime/monitor-detail/tabs/sla-report-tab";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
import { useUptimeMonitor } from "@/hooks/uptime";

export const Route = createFileRoute("/_app/dashboard_/uptime/$monitorId")({
	component: MonitorDetailPage,
	validateSearch: monitorTabSearch,
});

function MonitorDetailPage() {
	const { monitorId: routeMonitorId } = Route.useParams();
	const monitorId =
		routeMonitorId ||
		(typeof window !== "undefined"
			? decodeURIComponent(window.location.pathname.split("/").filter(Boolean).at(-1) ?? "")
			: "");
	const { tab: requestedTab, returnPanel } = Route.useSearch();
	const tab = canonicalMonitorTab(requestedTab);
	const navigate = useNavigate();
	const { t, i18n } = useTranslation(["uptimeMonitor", "common"]);
  const accountTimezone = useAccountTimezone();

	const { data: monitor, isLoading, error, refetch, dataUpdatedAt } = useUptimeMonitor(monitorId);
  useDocumentTitle(`${monitor?.name ?? t("common:nav.monitors")} — ${t(`tabs.${tab}`)}`);

  useEffect(() => {
    if (requestedTab !== undefined && requestedTab !== tab) {
      void navigate({ to: "/dashboard/uptime/$monitorId", params: { monitorId }, search: previous => ({ ...previous, tab }), replace: true });
    }
  }, [requestedTab, tab, monitorId, navigate]);

	const handleTabChange = useCallback(
		(newTab: string) => {
			const tabValue = canonicalMonitorTab(newTab);
			navigate({
				to: "/dashboard/uptime/$monitorId",
				params: { monitorId },
				search: previous => ({ ...previous, tab: tabValue }),
        replace: true,
			});
		},
		[navigate, monitorId],
	);

  if (!monitor && !isLoading) {
    if (isMissingResource(error) || !error) return <PageNotFound dashboard />;
    return <div className="grid min-h-64 place-items-center rounded-lg border bg-card p-6 text-center"><div className="grid justify-items-center gap-3"><SearchX aria-hidden className="size-10 text-muted-foreground" /><h1 className="app-title">{t("common:states.error")}</h1><p role="alert">{t("common:resource.loadError")}</p><div className="flex flex-wrap justify-center gap-3"><Button variant="outline" onClick={() => void refetch()}>{t("common:actions.retry")}</Button><Button variant="ghost" asChild><Link to="/dashboard">{t("common:nav.monitors")}</Link></Button></div></div></div>;
  }

	return (
		<div className="app-page-wide flex flex-col gap-6">
			{returnPanel === "notifications" && <Button variant="link" className="w-fit px-0" asChild><Link to="/dashboard" search={{ panel: "notifications" }}>{t("notificationSettings.back")}</Link></Button>}
      {monitor ? <MonitorDetailHeader monitor={monitor} /> : <MonitorDetailHeaderSkeleton />}
      {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"><p>{t("common:resource.staleAt", { time: dataUpdatedAt ? formatDate(dataUpdatedAt, i18n.language, accountTimezone) : "—" })}</p><Button variant="outline" onClick={() => void refetch()}>{t("common:actions.retry")}</Button></div>}

			<Tabs value={tab} onValueChange={handleTabChange}>
				<div className="flex min-w-0 items-center gap-2" role="region" aria-label={t("detailUX.sections")}>
					<TabsList aria-label={t("detailUX.sections")} className="flex min-w-0 flex-1 justify-start gap-1">
						<TabsTrigger
							value="overview"
							className="shrink-0 whitespace-nowrap px-3 text-sm"
						>
							{t("tabs.overview", "Overview")}
						</TabsTrigger>
						<TabsTrigger
							value="incidents"
							className="shrink-0 whitespace-nowrap px-3 text-sm"
						>
							{t("tabs.incidents", "Incidents")}
						</TabsTrigger>
						<TabsTrigger
							value="history"
							className="shrink-0 whitespace-nowrap px-3 text-sm"
						>
							{t("tabs.history", "History")}
						</TabsTrigger>
						<TabsTrigger
							value="alerts"
							className="shrink-0 whitespace-nowrap px-3 text-sm"
						>
							{t("tabs.alerts", "Alerts")}
						</TabsTrigger>
						<TabsTrigger
							value="reports"
							className="shrink-0 whitespace-nowrap px-3 text-sm"
						>
							{t("tabs.reports", "Reports")}
						</TabsTrigger>
						<TabsTrigger
							value="settings"
							className="shrink-0 whitespace-nowrap px-3 text-sm"
						>
							{t("tabs.settings", "Settings")}
						</TabsTrigger>
					</TabsList>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" className="shrink-0 sm:hidden">{t("actions.moreActions")}<ChevronDown aria-hidden="true" className="size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={tab} onValueChange={handleTabChange}>
                {(["overview", "incidents", "history", "alerts", "reports", "settings"] as const).map(value => <DropdownMenuRadioItem key={value} value={value}>{t(`tabs.${value}`)}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
				</div>

				<TabsContent value="overview">
					{monitor ? monitor.monitorType === "server" ? <ServerPanel key={monitorId} monitor={monitor} editing={tab === "settings"} /> : monitor.monitorType === "heartbeat" ? <HeartbeatPanel key={monitorId} monitor={monitor} /> : <OverviewTab monitor={monitor} /> : <OverviewTabSkeleton />}
				</TabsContent>
				<TabsContent value="incidents">
					{monitor ? <IncidentsTab monitorId={monitorId} hasObservations={Boolean(monitor.lastCheckedAt)} /> : <DetailContentSkeleton />}
				</TabsContent>
				<TabsContent value="history">
					{monitor ? <div className="grid min-w-0 gap-6"><ReliabilityPanel key={monitorId} monitorId={monitorId} monitorType={monitor.monitorType} />{monitor.monitorType === "server" ? <ServerPanel key={monitorId} monitor={monitor} /> : <HistoryTab key={monitorId} monitorId={monitorId} monitorType={monitor.monitorType} timeoutMs={monitor.timeout} />}</div> : <DetailContentSkeleton />}
				</TabsContent>
				<TabsContent value="alerts">
					{monitor ? <NotificationsTab supportsTls={monitor.monitorType === "http" && monitor.url.startsWith("https://")} key={monitorId} monitorId={monitorId} referencedChannels={monitor.referencedChannels} /> : <DetailContentSkeleton />}
				</TabsContent>
				<TabsContent value="reports">
					{monitor ? <SlaReportTab monitorId={monitorId} /> : <DetailContentSkeleton />}
				</TabsContent>
				<TabsContent value="settings">
					{monitor ? monitor.monitorType === "server" ? <ServerPanel key={monitorId} monitor={monitor} editing={tab === "settings"} /> : monitor.monitorType === "heartbeat" ? <HeartbeatPanel key={monitorId} monitor={monitor} editing /> : monitor.monitorType === "dns" || monitor.monitorType === "tcp" ? <NetworkPanel key={monitorId} monitor={monitor} /> : <SettingsTab monitor={monitor} /> : <DetailContentSkeleton />}
				</TabsContent>
			</Tabs>
		</div>
	);
}
import { HeartbeatPanel } from "@/components/uptime/heartbeat-controls";

function DetailContentSkeleton() {
  return <div aria-hidden="true" className="grid min-w-0 gap-4">
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{[0, 1, 2].map(index => <div key={index} className={`grid gap-2 rounded-lg border p-4 ${index === 2 ? "col-span-2 sm:col-span-1" : ""}`}><Skeleton className="h-8 w-24" /><Skeleton className="h-4 w-32 max-w-full" /></div>)}</div>
    <div className="grid gap-4 rounded-lg border p-4"><Skeleton className="h-6 w-48 max-w-full" /><div className="flex h-32 items-end gap-2">{[40, 65, 50, 85, 70, 95, 80].map((height, index) => <Skeleton key={index} className="min-w-0 flex-1" style={{ height: `${height}%` }} />)}</div></div>
  </div>;
}
