/**
 * API keys settings route. Manages keys for the public REST API.
 *
 * @module routes/_app/dashboard.api-keys
 */

import { createFileRoute } from "@tanstack/react-router";

import { ApiKeysManager } from "@/components/uptime/api-keys/api-keys-manager";

export const Route = createFileRoute("/_app/dashboard_/api-keys")({
	component: ApiKeysPage,
});

function ApiKeysPage() {
	return <ApiKeysManager />;
}
