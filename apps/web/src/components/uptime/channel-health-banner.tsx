/**
 * Dashboard banner — surfaces notification channels that are failing every
 * delivery.
 *
 * Exists because a broken channel used to be invisible: the delivery log
 * renders only inside Monitor detail → Notifications, per monitor, so an
 * account-wide channel could fail every send for days without any signal on
 * a screen the owner actually visits.
 *
 * @module components/uptime/channel-health-banner
 */

import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useUptimeChannelHealth } from "@/hooks/uptime";
import { CHANNEL_UNHEALTHY_THRESHOLD } from "@/types/uptime";

interface ChannelHealthBannerProps {
	/** Opens the notification settings sheet so the channel can be fixed. */
	onManageChannels: () => void;
}

export function ChannelHealthBanner({
	onManageChannels,
}: ChannelHealthBannerProps) {
	const { t } = useTranslation("uptimeMonitor");
	const { data } = useUptimeChannelHealth();

	const broken = (data ?? []).filter(
		(channel) => channel.consecutiveFailures >= CHANNEL_UNHEALTHY_THRESHOLD,
	);

	if (broken.length === 0) {
		return null;
	}

	return (
		<div className="rounded-lg border border-destructive/40 bg-card p-4 shadow-xs">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex items-start gap-3">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
					<div className="space-y-1">
						<p className="text-sm font-semibold">
							{t("channelHealth.title", { count: broken.length })}
						</p>
						<ul className="space-y-1">
							{broken.map((channel) => (
								<li
									key={channel.channelId}
									className="text-sm text-muted-foreground"
								>
									<span className="font-medium text-foreground">
										{t(`notifications.channelTypes.${channel.channelType}`, {
											defaultValue: channel.channelType,
										})}
									</span>
									{channel.target ? ` — ${channel.target}` : null}
									{": "}
									{t("channelHealth.failedAttempts", {
										count: channel.consecutiveFailures,
									})}
									{channel.lastError ? (
										<span className="block break-words ps-0 text-xs">
											{channel.lastError}
										</span>
									) : null}
								</li>
							))}
						</ul>
					</div>
				</div>

				<Button
					variant="outline"
					size="sm"
					className="shrink-0 rounded-md"
					onClick={onManageChannels}
				>
					{t("channelHealth.manage", "Manage channels")}
				</Button>
			</div>
		</div>
	);
}
