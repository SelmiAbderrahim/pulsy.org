/**
 * Monitor Empty State - Compelling first-run experience
 *
 * Shown when user has zero monitors. Highlights key capabilities
 * and provides a CTA to create the first monitor.
 *
 * @module components/dashboard/uptime/monitor-empty-state
 */

import { useTranslation } from "react-i18next";
import { Activity, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MonitorEmptyStateProps {
	onCreateMonitor: () => void;
}

export function MonitorEmptyState({ onCreateMonitor }: MonitorEmptyStateProps) {
	const { t } = useTranslation("uptimeMonitor");

	const features = [
		t("emptyState.features.healthChecks", "HTTP & HTTPS health checks"),
		t("emptyState.features.intervals", "Configurable check intervals"),
		t(
			"emptyState.features.alerts",
			"Email, Slack, Discord & webhook alerts",
		),
		t(
			"emptyState.features.statusPage",
			"Public status page for your customers",
		),
	];

	return (
		<div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 sm:p-12 text-center">
			<Activity className="h-12 w-12 text-muted-foreground mb-4" />

			<h3 className="text-lg font-semibold mb-2">
				{t("emptyState.title", "Start Monitoring Your Services")}
			</h3>

			<p className="text-sm text-muted-foreground max-w-md mb-6">
				{t(
					"emptyState.description",
					"Add your first uptime monitor to track availability, response times, and TLS certificate expiry across your endpoints.",
				)}
			</p>

			<ul className="text-sm text-muted-foreground space-y-2 mb-8 text-start">
				{features.map((feature) => (
					<li key={feature} className="flex items-center gap-2">
						<CheckCircle className="h-4 w-4 text-success shrink-0" />
						<span>{feature}</span>
					</li>
				))}
			</ul>

			<Button onClick={onCreateMonitor} className="h-[44px] min-w-[44px]">
				{t("emptyState.cta", "Add Your First Monitor")}
			</Button>
		</div>
	);
}
