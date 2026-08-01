/**
 * Server policy config — exposes the email-verification policy to the web app.
 * The server `.env` is the single source of truth; this reads it via the public
 * `config.get` tRPC query.
 *
 * @module hooks/useConfig
 */

import { useQuery } from "@tanstack/react-query";
import { trpcQuery } from "@/lib/api/trpc";

export interface AppConfig {
	requireEmailVerification: boolean;
}

export function useConfig() {
	return useQuery({
		queryKey: ["config"] as const,
		queryFn: () => trpcQuery<AppConfig>("config", "get"),
		// Policy rarely changes within a session.
		staleTime: 1000 * 60 * 60,
	});
}
