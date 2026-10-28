import { useRef } from "react";
import { Button } from "@/components/ui/button";
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
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/share/$token")({
	component: SharePage,
});

function SharePage() {
	const { token } = Route.useParams();
	const { data: observed, isPending, error, refetch } = useSession();
  const previous = useRef(observed);
  const terminal = error?.status === 401 || error?.status === 403;
  if (observed && !terminal) previous.current = observed;
  const transient = error && error.status !== 401 && error.status !== 403;
  const session = terminal ? null : observed ?? (isPending || transient ? previous.current : null);
	const { t } = useTranslation("uptimeMonitor");
  // Once signed in, ShareClaimPage owns the title ("Shared monitors" or "Link unavailable").
  useDocumentTitle(session ? undefined : t("share.claim.pageTitle"));

	if (isPending && !session) {
		return <main className="grid min-h-[calc(100dvh-45px)] place-content-center gap-4 p-4 text-center">
			<h1 className="text-xl font-semibold">{t("share.claim.pageTitle")}</h1>
			<p role="status" className="flex items-center justify-center gap-2 text-muted-foreground"><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />{t("common:states.loading")}</p>
		</main>;
	}

	if (!session && transient) return <main className="grid min-h-[calc(100dvh-45px)] place-content-center gap-4 p-4 text-center"><h1 className="text-xl font-semibold">{t("common:session.unavailable")}</h1><p role="alert">{t("common:session.retryDescription")}</p><Button onClick={() => void refetch()}>{t("common:actions.retry")}</Button></main>;

  if (!session) {
		return <Navigate to="/signup" search={{ share: token }} replace />;
	}

	return (
		<main className="min-h-[calc(100dvh-45px)] bg-background">
			<div className="mx-auto w-full max-w-2xl px-4 py-10">
				<div className="mb-8 flex items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2">
						<Activity className="h-6 w-6 shrink-0 text-primary" />
						<h1 className="break-words text-2xl font-semibold">
							{t("share.claim.pageTitle", "Shared monitors")}
						</h1>
					</div>
					<ThemeToggle />
				</div>

				<ShareClaimPage token={token} />
			</div>
		</main>
	);
}
