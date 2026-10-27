/**
 * Server policy config — exposes the email-verification policy to the web app.
 * The server `.env` is the single source of truth; this reads it via the authenticated
 * `config.get` tRPC query.
 *
 * @module hooks/useConfig
 */

import { useQuery } from "@tanstack/react-query";
import { trpcQuery } from "@/lib/api/trpc";
import { useSession } from "@/lib/auth-client";

export interface AppConfig {
	requireEmailVerification: boolean;
  timezone?: string | null;
}

export function useConfig() {
	const { data: session } = useSession();
	return useQuery({
		queryKey: ["config", session?.user.id] as const,
		queryFn: () => trpcQuery<AppConfig>("config", "get"),
		enabled: !!session?.user.id,
		// Policy rarely changes within a session.
		staleTime: 1000 * 60 * 60,
	});
}
