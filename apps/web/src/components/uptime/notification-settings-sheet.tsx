import { Bell, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
}

export function NotificationSettingsSheet({
	open,
	onOpenChange,
	monitors,
}: NotificationSettingsSheetProps) {
	const { t } = useTranslation("uptimeMonitor");

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="sm:max-w-lg overflow-y-auto"
			>
				<SheetHeader>
					<SheetTitle>
						{t("notificationSettings.title", "Notification Settings")}
					</SheetTitle>
					<SheetDescription>
						{t(
							"notificationSettings.description",
							"Configure email providers and manage alert channels for your monitors.",
						)}
					</SheetDescription>
				</SheetHeader>

				<div className="mt-6 flex flex-col gap-6">
					{/* Email Providers (global) */}
					<EmailProvidersSection />

					<Separator />

					{/* Account-level default channels (apply to all monitors) */}
					<DefaultChannelsSection />

					<Separator />

					{/* Monitor Alerts summary */}
					<div className="flex flex-col gap-3">
						<div>
							<h3 className="text-lg font-medium">
								{t("notificationSettings.monitorAlerts", "Monitor Alerts")}
							</h3>
							<p className="text-sm text-muted-foreground">
								{t(
									"notificationSettings.monitorAlertsDescription",
									"Set up notification channels for each monitor.",
								)}
							</p>
						</div>

						{monitors.length === 0 ? (
							<div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
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
								{monitors.map((monitor) => (
									<div
										key={monitor.uptimeMonitorId}
										className="flex items-center justify-between gap-3 rounded-lg border p-3"
									>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium truncate">
												{monitor.name}
											</p>
											<p className="text-xs text-muted-foreground truncate">
												{monitor.url}
											</p>
										</div>
										<Button
											variant="outline"
											size="sm"
											className="h-[44px] shrink-0"
											asChild
											onClick={() => onOpenChange(false)}
										>
											<Link
												to="/dashboard/uptime/$monitorId"
												params={{ monitorId: monitor.uptimeMonitorId }}
												search={{ tab: "notifications" }}
											>
												<Settings className="h-3.5 w-3.5 me-1.5" />
												{t("notificationSettings.configure", "Configure")}
											</Link>
										</Button>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
