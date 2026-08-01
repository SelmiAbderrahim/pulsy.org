/**
 * Public named status page (no auth) — `/status/:userId/:slug`.
 *
 * Resolves a published page by its per-user (userId, slug) via
 * `uptimeMonitor.public.statusPageBySlug` and renders the shared
 * `<PublicStatusContent>`. An unpublished or missing page resolves to a
 * NOT_FOUND error, shown as a "status page not found" state.
 *
 * @module routes/status.$userId.$slug
 */

import { createFileRoute } from "@tanstack/react-router";

import { PublicStatusContent } from "@/components/uptime/public-status-content";
import { usePublicStatusPageBySlug } from "@/hooks/uptime/useStatusPages";

export const Route = createFileRoute("/status/$userId/$slug")({
	component: NamedStatusPage,
});

function NamedStatusPage() {
	const { userId, slug } = Route.useParams();
	const { data, isLoading, error } = usePublicStatusPageBySlug(userId, slug);

	return (
		<PublicStatusContent
			data={data}
			isLoading={isLoading}
			error={error}
			errorKey="statusPage.notFound"
		/>
	);
}
