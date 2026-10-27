/**
 * Uptime Onboarding Hint - Dismissible banner for first-time users
 *
 * Shows a hint banner at the top of the uptime page when the user
 * has zero monitors and has never dismissed the hint.
 * Dismissal state stored in localStorage.
 *
 * @module components/dashboard/uptime/uptime-onboarding-hint
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Activity, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "uptime_onboarding_dismissed";

interface UptimeOnboardingHintProps {
	onGetStarted: () => void;
}

export function UptimeOnboardingHint({
	onGetStarted,
}: UptimeOnboardingHintProps) {
	const { t } = useTranslation("uptimeMonitor");
	const [dismissed, setDismissed] = useState(() => {
		try {
			return localStorage.getItem(STORAGE_KEY) === "true";
		} catch {
			return false;
		}
	});

	const handleDismiss = useCallback(() => {
		try {
			localStorage.setItem(STORAGE_KEY, "true");
		} catch {
			// localStorage unavailable
		}
		setDismissed(true);
	}, []);

	if (dismissed) return null;

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex items-start gap-3 sm:items-center">
				<Activity className="h-5 w-5 text-primary shrink-0 mt-0.5 sm:mt-0" />
				<div>
					<p className="text-sm font-medium">
						{t("onboarding.title", "New: uptime monitoring")}
					</p>
					<p className="text-sm text-muted-foreground">
						{t(
							"onboarding.description",
							"Monitor HTTP endpoints, track response times, and get alerts when services go down.",
						)}
					</p>
				</div>
			</div>
			<div className="flex items-center gap-2 shrink-0">
				<Button
					size="sm"
					onClick={onGetStarted}
					className="h-[44px] min-w-[44px]"
				>
					{t("onboarding.getStarted", "Get started")}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={handleDismiss}
 aria-label={t("onboarding.dismiss", "Dismiss")}
					className="h-[44px] min-w-[44px]"
				>
					<X className="h-4 w-4 sm:me-1" />
					<span className="hidden sm:inline">
						{t("onboarding.dismiss", "Dismiss")}
					</span>
				</Button>
			</div>
		</div>
	);
}
