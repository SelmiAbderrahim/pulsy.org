/**
 * Public status page (no auth) — legacy per-user URL.
 *
 * Resolves the user's `default` status page via `uptimeMonitor.public.status`
 * and renders the shared `<PublicStatusContent>`. Kept for backward
 * compatibility with existing `/status/:userId` links.
 *
 * @module routes/status.$userId
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PublicStatusContent } from "@/components/uptime/public-status-content";
import { uptimeKeys } from "@/hooks/uptime/queryKeys";
import { UptimeService } from "@/services/uptime/uptimeService";

export const Route = createFileRoute("/status/$userId")({
	component: PublicStatusPage,
});

function PublicStatusPage() {
	const { userId } = Route.useParams();

	const { data, isLoading, error } = useQuery({
		queryKey: uptimeKeys.public.status(userId),
		queryFn: () => UptimeService.getPublicStatus(userId),
		staleTime: 1000 * 30,
		refetchInterval: 1000 * 60,
	});

	return <PublicStatusContent data={data} isLoading={isLoading} error={error} />;
}
