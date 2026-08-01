/**
 * Share-link claim route (public).
 *
 * Recipients land here from a share URL. Without a session they are sent to
 * signup with the token preserved in `?share=`, so they come back here after
 * registering (or logging in via the cross-link) and get the claim popup.
 *
 * @module routes/share.$token
 */

import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Activity, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ThemeToggle } from "@/components/theme-toggle";
import { ShareClaimPage } from "@/components/uptime/share/share-claim-page";
import { useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/share/$token")({
	component: SharePage,
});

function SharePage() {
	const { token } = Route.useParams();
	const { data: session, isPending } = useSession();
	const { t } = useTranslation("uptimeMonitor");

	if (isPending) {
		return (
			<div className="flex min-h-[calc(100dvh-45px)] items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!session) {
		return <Navigate to="/signup" search={{ share: token }} replace />;
	}

	return (
		<div className="min-h-[calc(100dvh-45px)] bg-muted/30">
			<div className="mx-auto w-full max-w-2xl px-4 py-10">
				<div className="mb-8 flex items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2">
						<Activity className="h-6 w-6 shrink-0 text-primary" />
						<h1 className="truncate text-2xl font-semibold">
							{t("share.claim.pageTitle", "Shared monitors")}
						</h1>
					</div>
					<ThemeToggle />
				</div>

				<ShareClaimPage token={token} />
			</div>
		</div>
	);
}
