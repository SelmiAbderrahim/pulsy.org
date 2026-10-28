/**
 * Monitor Empty State - Compelling first-run experience
 *
 * Shown when user has zero monitors. Highlights key capabilities
 * and provides a CTA to create the first monitor.
 *
 * @module components/dashboard/uptime/monitor-empty-state
 */

import { useTranslation } from "react-i18next";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MonitorEmptyStateProps {
	onCreateMonitor: () => void;
	hideAction?: boolean;
}

export function MonitorEmptyState({ onCreateMonitor, hideAction = false }: MonitorEmptyStateProps) {
	const { t } = useTranslation("uptimeMonitor");

	const steps = [t("emptyState.steps.monitor"), t("emptyState.steps.alerts"), t("emptyState.steps.status")];

	return (
		<div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 sm:p-12 text-center">
			<Activity className="h-12 w-12 text-muted-foreground mb-4" />

			<h2 className="text-lg font-semibold mb-2">
				{t("emptyState.title", "Start monitoring your services")}
			</h2>

			<p className="text-sm text-muted-foreground max-w-md mb-6">
				{t(
					"emptyState.description",
					"Add your first uptime monitor to track availability, response times, and TLS certificate expiry across your endpoints.",
				)}
			</p>

			<ol className="max-w-md list-decimal space-y-3 ps-5 text-start text-sm text-muted-foreground">
				{steps.map(step => <li key={step}>{step}</li>)}
			</ol>

			{!hideAction && <Button onClick={onCreateMonitor} className="mt-6 h-[44px] min-w-[44px]">
				{t("emptyState.cta", "Add your first monitor")}
			</Button>}
		</div>
	);
}
