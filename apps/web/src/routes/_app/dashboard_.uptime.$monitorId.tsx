/**
 * Monitor detail route with 5 tabs (overview, incidents, history,
 * notifications, settings). Active tab is persisted in the URL.
 *
 * @module routes/_app/dashboard.uptime.$monitorId
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { MonitorDetailHeader } from "@/components/uptime/monitor-detail/monitor-detail-header";
import { HistoryTab } from "@/components/uptime/monitor-detail/tabs/history-tab";
import { IncidentsTab } from "@/components/uptime/monitor-detail/tabs/incidents-tab";
import { NotificationsTab } from "@/components/uptime/monitor-detail/tabs/notifications-tab";
import { OverviewTab } from "@/components/uptime/monitor-detail/tabs/overview-tab";
import { SettingsTab } from "@/components/uptime/monitor-detail/tabs/settings-tab";
import { SlaReportTab } from "@/components/uptime/monitor-detail/tabs/sla-report-tab";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
import { useUptimeMonitor } from "@/hooks/uptime";

type TabState =
	| "overview"
	| "incidents"
	| "history"
	| "notifications"
	| "slaReport"
	| "settings";

export const Route = createFileRoute("/_app/dashboard_/uptime/$monitorId")({
	component: MonitorDetailPage,
	validateSearch: (search: Record<string, unknown>): { tab?: TabState } => {
		const validTabs = [
			"overview",
			"incidents",
			"history",
			"notifications",
			"slaReport",
			"settings",
		] satisfies TabState[];
		return validTabs.includes(search.tab as TabState)
			? { tab: search.tab as TabState }
			: {};
	},
});

function MonitorDetailPage() {
	const { monitorId: routeMonitorId } = Route.useParams();
	const monitorId =
		routeMonitorId ||
		(typeof window !== "undefined"
			? decodeURIComponent(window.location.pathname.split("/").filter(Boolean).at(-1) ?? "")
			: "");
	const { tab: initialTab = "overview" } = Route.useSearch();
	const navigate = useNavigate();
	const { t } = useTranslation(["uptimeMonitor", "common"]);
	const [tab, setTab] = useState<TabState>(initialTab);

	const { data: monitor, isLoading, error } = useUptimeMonitor(monitorId);

	const handleTabChange = useCallback(
		(newTab: string) => {
			const tabValue = newTab as TabState;
			setTab(tabValue);
			navigate({
				to: "/dashboard/uptime/$monitorId",
				params: { monitorId },
				search: { tab: tabValue },
				replace: true,
			});
		},
		[navigate, monitorId],
	);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (error || !monitor) {
		return (
			<div className="flex flex-col items-center justify-center py-12 gap-2">
				<p className="text-muted-foreground">
					{t("errors.monitorNotFound", "Monitor not found")}
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<MonitorDetailHeader monitor={monitor} />

			<Tabs value={tab} onValueChange={handleTabChange}>
				<div className="max-w-full pb-1">
					<TabsList className="grid w-full grid-cols-2 justify-start gap-1 min-[390px]:grid-cols-3 sm:inline-flex sm:w-max sm:min-w-0">
						<TabsTrigger
							value="overview"
							className="min-w-0 whitespace-normal px-2 text-center text-xs sm:whitespace-nowrap sm:px-3 sm:text-sm"
						>
							{t("tabs.overview", "Overview")}
						</TabsTrigger>
						<TabsTrigger
							value="incidents"
							className="min-w-0 whitespace-normal px-2 text-center text-xs sm:whitespace-nowrap sm:px-3 sm:text-sm"
						>
							{t("tabs.incidents", "Incidents")}
						</TabsTrigger>
						<TabsTrigger
							value="history"
							className="min-w-0 whitespace-normal px-2 text-center text-xs sm:whitespace-nowrap sm:px-3 sm:text-sm"
						>
							{t("tabs.history", "History")}
						</TabsTrigger>
						<TabsTrigger
							value="notifications"
							className="min-w-0 whitespace-normal px-2 text-center text-xs sm:whitespace-nowrap sm:px-3 sm:text-sm"
						>
							{t("tabs.notifications", "Notifications")}
						</TabsTrigger>
						<TabsTrigger
							value="slaReport"
							className="min-w-0 whitespace-normal px-2 text-center text-xs sm:whitespace-nowrap sm:px-3 sm:text-sm"
						>
							{t("tabs.slaReport", "SLA Report")}
						</TabsTrigger>
						<TabsTrigger
							value="settings"
							className="min-w-0 whitespace-normal px-2 text-center text-xs sm:whitespace-nowrap sm:px-3 sm:text-sm"
						>
							{t("tabs.settings", "Settings")}
						</TabsTrigger>
					</TabsList>
				</div>

				<TabsContent value="overview">
					<OverviewTab monitor={monitor} />
				</TabsContent>
				<TabsContent value="incidents">
					<IncidentsTab monitorId={monitorId} />
				</TabsContent>
				<TabsContent value="history">
					<HistoryTab monitorId={monitorId} />
				</TabsContent>
				<TabsContent value="notifications">
					<NotificationsTab monitorId={monitorId} />
				</TabsContent>
				<TabsContent value="slaReport">
					<SlaReportTab monitorId={monitorId} />
				</TabsContent>
				<TabsContent value="settings">
					<SettingsTab monitor={monitor} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
