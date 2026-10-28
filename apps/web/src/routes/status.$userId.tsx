/**
 * Public status page (no auth) — legacy per-user URL.
 *
 * Named child routes render through the Outlet. The exact legacy URL resolves
 * the user's published `default` status page via `uptimeMonitor.public.status`
 * and renders the shared `<PublicStatusContent>`. Kept for backward
 * compatibility with existing `/status/:userId` links.
 *
 * @module routes/status.$userId
 */

import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PublicStatusContent } from "@/components/uptime/public-status-content";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { UptimeService } from "@/services/uptime/uptimeService";

export const Route = createFileRoute("/status/$userId")({
	component: PublicStatusPage,
});

function PublicStatusPage() {
	const namedPage = useMatch({
		from: "/status/$userId/$slug",
		shouldThrow: false,
	});
	return namedPage ? <Outlet /> : <LegacyDefaultStatusPage />;
}

function LegacyDefaultStatusPage() {
	const { userId } = Route.useParams();

	const { data, isLoading, error, refetch } = useQuery({
		queryKey: uptimeKeys.public.status(userId),
		queryFn: () => UptimeService.getPublicStatus(userId),
		staleTime: 1000 * 30,
		refetchInterval: 1000 * 60,
		retry: false,
	});

	return <PublicStatusContent data={data} isLoading={isLoading} error={error} onRetry={() => void refetch()} errorKey="statusPage.notFound" />;
}
