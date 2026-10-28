import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { useSession } from "@/lib/auth-client";
import { PublicStatusContent } from "@/components/uptime/public-status-content";
import { usePublicStatusPageByDomain } from "@/hooks/uptime/useStatusPages";
import { getCustomStatusDomain } from "@/lib/status-domain";

export const Route = createFileRoute("/")({
	component: IndexPage,
});

/**
 * Application front door. On the app's own host, guests are redirected to
 * /login and authenticated sessions to their dashboard (or the superadmin
 * panel). On a verified custom status-page domain, the root serves that page.
 */
function IndexPage() {
	const customDomain = getCustomStatusDomain();
	if (customDomain) {
		return <CustomDomainStatusPage host={customDomain} />;
	}
	return <AppEntryGate />;
}

function AppEntryGate() {
	const { data: session, isPending } = useSession();

	if (isPending) {
		return (
			<div className="flex min-h-[calc(100dvh-45px)] items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (session) {
		if (session.user?.role === "superadmin") {
			return (
				<Navigate to="/superadmin" search={{ section: "overview" }} replace />
			);
		}
		return <Navigate to="/dashboard" replace />;
	}

	return <Navigate to="/login" replace />;
}

function CustomDomainStatusPage({ host }: { host: string }) {
	const { data, isLoading, error, refetch } = usePublicStatusPageByDomain(host);
	return (
		<PublicStatusContent
			data={data}
			isLoading={isLoading}
			error={error}
			errorKey="statusPage.notFound"
      onRetry={() => void refetch()}
		/>
	);
}
