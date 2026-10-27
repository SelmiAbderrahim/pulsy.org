import { formatCount } from "@/lib/count-format";
import { SectionCard } from "@/components/ui/section-card";
import type { NotificationTab } from "@/lib/uptime/dashboard-search";
import { layoutTokens } from "@/components/ui/layout-tokens";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { DefaultChannelsSection } from "@/components/uptime/default-channels-section";
import { EmailProvidersSection } from "@/components/uptime/monitor-detail/tabs/email-providers-section";
import type { UptimeMonitor } from "@/types/uptime";

interface NotificationSettingsSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	monitors: UptimeMonitor[];
  tab?: NotificationTab;
  onTabChange?: (tab: NotificationTab) => void;
}

export function NotificationSettingsSheet({
	open,
	onOpenChange,
	monitors, tab: controlledTab, onTabChange,
}: NotificationSettingsSheetProps) {
	const { t, i18n } = useTranslation("uptimeMonitor");
 const selectedTabRef = useRef<HTMLButtonElement>(null);
 const [localTab, setLocalTab] = useState<NotificationTab>("providers");
 const tab = controlledTab ?? localTab;
 const setTab = (value: string) => { const next = value as NotificationTab; setLocalTab(next); onTabChange?.(next); };
 const [search, setSearch] = useState("");
 const filtered = monitors.filter(monitor => monitor.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
        onOpenAutoFocus={event => { event.preventDefault(); selectedTabRef.current?.focus(); }}
				className={`flex flex-col overflow-hidden ${layoutTokens.complexDrawer}`}
			>
				<SheetHeader>
					<SheetTitle>
						{t("notificationSettings.title", "Notification settings")}
					</SheetTitle>
					<SheetDescription>
						{t(
							"notificationSettings.description",
							"Configure email providers and manage alert channels for your monitors.",
						)}
					</SheetDescription>
				</SheetHeader>

				<Tabs value={tab} onValueChange={setTab} className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
<TabsList aria-label={t("notificationSettings.title")} className="shrink-0 w-full justify-start">
<TabsTrigger ref={tab === "providers" ? selectedTabRef : undefined} value="providers">{t("emailProviders.title")}</TabsTrigger>
<TabsTrigger ref={tab === "defaults" ? selectedTabRef : undefined} value="defaults">{t("notificationSettings.defaults.title")}</TabsTrigger>
<TabsTrigger ref={tab === "monitors" ? selectedTabRef : undefined} value="monitors">{t("notificationUX.overrides")}</TabsTrigger>
</TabsList>
<TabsContent value="providers" className="min-h-0 overflow-y-auto"><EmailProvidersSection /></TabsContent>
<TabsContent value="defaults" className="min-h-0 overflow-y-auto"><DefaultChannelsSection /></TabsContent>
<TabsContent value="monitors" className="min-h-0 overflow-y-auto">
					{/* Monitor alerts summary */}
          <SectionCard title={t("notificationUX.overrides")} description={t("notificationSettings.monitorAlertsDescription", "Set up notification channels for each monitor.")}>
            <div className="flex flex-col gap-3">
						<Input type="search" aria-label={t("notificationUX.searchMonitors")} placeholder={t("search.shortPlaceholder")} value={search} onChange={event => setSearch(event.target.value)} />
 {monitors.length === 0 ? (
							<div className="flex flex-col items-center justify-center rounded-lg border p-8 text-center">
								<Bell className="h-8 w-8 text-muted-foreground mb-2" />
								<p className="text-sm text-muted-foreground">
									{t(
										"notificationSettings.noMonitors",
										"Create a monitor first to configure alerts.",
									)}
								</p>
							</div>
						) : (
							<div className="flex flex-col gap-2">
								{filtered.length === 0 && <p role="status" className="text-sm">{t("incidentUX.filteredEmpty")}</p>}
								{filtered.length > 0 && <ul className="flex flex-col gap-2">
								{filtered.map((monitor) => (
									<li
										key={monitor.uptimeMonitorId}
										className="flex items-center justify-between gap-3 rounded-lg border p-3"
									>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium break-words">
												{monitor.name}
											</p><p className="text-sm text-muted-foreground">{formatCount(t, "notificationUX.overrideCount", monitor.overrideChannelCount ?? 0, i18n.language)}</p>

										</div>
										<Button
											variant="outline"
											size="sm"
											className="h-[44px] shrink-0"
											asChild
											data-dialog-discard onClick={() => onOpenChange(false)}
										>
											<Link
												to="/dashboard/uptime/$monitorId"
												params={{ monitorId: monitor.uptimeMonitorId }}
												search={{ tab: "alerts", returnPanel: "notifications" }}
 aria-label={`${t("notificationSettings.openAlerts")} ${monitor.name}`}
											>
												<Settings aria-hidden className="h-3.5 w-3.5 me-1.5" />
												{t("notificationSettings.openAlerts")}
											</Link>
										</Button>
									</li>
								))}
								</ul>}
							</div>
						)}
					</div>
</SectionCard>
</TabsContent></Tabs>
			</SheetContent>
		</Sheet>
	);
}
