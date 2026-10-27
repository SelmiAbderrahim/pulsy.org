/**
 * tRPC client wrapper for the Pulsy server.
 *
 * The historical service layer (carried over from the source project) calls
 * tRPC procedures dynamically by string — `trpcQuery("uptimeMonitor",
 * "monitor.list")`. This module reimplements that contract on top of the
 * typed `@trpc/client` v11 vanilla client.
 *
 * In development the Vite dev server proxies `/api/*` to the backend, so the
 * default base URL is empty (same-origin). `VITE_SERVER_URL` can override it
 * for non-proxied environments.
 *
 * @module lib/api/trpc
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import i18n from "i18next";
// The server exports `AppRouter` from its `/trpc` subpath (`src/trpc/router.ts`).
// The package root (`src/index.ts`) is the Express bootstrap and does not
// re-export the type, so we import the subpath directly.
import type { AppRouter } from "@pulsy/server/trpc";

/**
 * Browser-facing server origin. Empty (same-origin) in proxied/dev builds;
 * `VITE_SERVER_URL` overrides it for non-proxied environments. Exported so the
 * non-tRPC download routes (e.g. the SLA-report PDF) build matching URLs.
 */
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? "";
const API_URL = `${SERVER_URL}/api/trpc`;

/**
 * Typed vanilla tRPC client. Cookies are sent with every request so the
 * better-auth session is honored.
 */
export const client = createTRPCClient<AppRouter>({
	links: [
		httpBatchLink({
			url: API_URL,
			transformer: superjson,
			fetch: async (url, options) => {
				try {
					const headers = new Headers(options?.headers);
					headers.set("Accept-Language", i18n.language ?? i18n.resolvedLanguage ?? "en");
					const response = await fetch(url, { ...options, headers, credentials: "include" });
					// Proxy errors often contain HTML rather than a tRPC envelope.
					// A received response is never a connectivity failure.
					if (response.status >= 500 && !response.headers.get("content-type")?.includes("application/json")) throw new Error(i18n.t("common:states.serverProblem"));
					return response;
				} catch (error) {
					// The browser reports an unreachable server as a bare TypeError ("Failed to fetch").
					// Aborts (stale search, navigation) are DOMExceptions and pass through untouched.
					if (error instanceof TypeError) throw new Error(i18n.t("common:states.unreachable"));
					throw error;
				}
			},
		}),
	],
});

type DynamicProcedure = {
	query?: (input?: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
	mutate?: (input?: unknown) => Promise<unknown>;
};

function getProperty(source: unknown, key: string): unknown {
	if (
		(typeof source !== "object" && typeof source !== "function") ||
		source === null
	) {
		return undefined;
	}
	return (source as Record<string, unknown>)[key];
}

/**
 * Dynamic accessor over the typed client. The client exposes nested
 * procedures as `client[router][procedure].query/mutate`, including dotted
 * procedure names (e.g. `monitor.list`). We traverse each path segment.
 */
function resolveProcedure(router: string, procedure: string): DynamicProcedure {
	let node = getProperty(client, router);
	for (const segment of procedure.split(".")) {
		node = getProperty(node, segment);
	}
	if ((typeof node !== "object" && typeof node !== "function") || node === null) {
		throw new Error(`Unknown tRPC procedure: ${router}.${procedure}`);
	}
	return node as DynamicProcedure;
}

/**
 * Execute a tRPC query procedure by string path.
 */
export async function trpcQuery<T>(
	router: string,
	procedure: string,
	input?: unknown,
	options?: { signal?: AbortSignal },
): Promise<T> {
	const resolved = resolveProcedure(router, procedure);
	if (typeof resolved.query !== "function") {
		throw new Error(`tRPC procedure is not a query: ${router}.${procedure}`);
	}
	return (options?.signal ? resolved.query(input, { signal: options.signal }) : resolved.query(input)) as Promise<T>;
}

/**
 * Execute a tRPC mutation procedure by string path.
 */
export async function trpcMutation<T>(
	router: string,
	procedure: string,
	input?: unknown,
): Promise<T> {
	const resolved = resolveProcedure(router, procedure);
	if (typeof resolved.mutate !== "function") {
		throw new Error(`tRPC procedure is not a mutation: ${router}.${procedure}`);
	}
	return resolved.mutate(input) as Promise<T>;
}
