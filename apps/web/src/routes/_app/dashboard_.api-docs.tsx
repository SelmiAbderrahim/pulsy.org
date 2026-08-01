/**
 * API documentation route — the human guide to the public REST API
 * (`/api/v1`). Reachable from the top nav and from the API-keys page.
 *
 * @module routes/_app/dashboard.api-docs
 */

import { createFileRoute } from "@tanstack/react-router";

import { ApiDocsPage } from "@/components/uptime/api-docs/api-docs-page";

export const Route = createFileRoute("/_app/dashboard_/api-docs")({
	component: ApiDocsRoute,
});

function ApiDocsRoute() {
	return <ApiDocsPage />;
}
