import { Fragment, useLayoutEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { isSessionClientActive, retireSessionClient } from "@/lib/session-query-client";

/** Ownerless query keys must never survive a confirmed account transition. */
export function SessionQueryBoundary({ children }: { children: ReactNode }) {
  const parent = useQueryClient();
  const { data, isPending, error } = useSession();
  const [scope, setScope] = useState<{ owner: string | null | undefined; client: QueryClient }>(() => ({
    owner: undefined,
    client: isSessionClientActive(parent) ? parent : new QueryClient({ defaultOptions: parent.getDefaultOptions() }),
  }));
  const { owner, client } = scope;
  const terminal = error?.status === 401 || error?.status === 403;
  const transient = error && error.status !== 401 && error.status !== 403;
  // A first-load auth outage must still render public routes and the auth
  // guard's error/retry UI. Only preserve an owner that was actually resolved.
  const nextOwner = terminal ? null : isPending || (transient && owner !== undefined) ? owner : data?.user.id ?? null;
  const changing = nextOwner !== owner;
  useLayoutEffect(() => {
    if (!changing) return;
    if (owner === undefined) {
      client.clear();
      setScope({ owner: nextOwner, client });
    } else {
      // Clearing alone cannot stop a mutation's late success/rollback callback.
      // Its captured client must never become visible to another session.
      retireSessionClient(client);
      setScope({ owner: nextOwner, client: new QueryClient({ defaultOptions: parent.getDefaultOptions() }) });
    }
  }, [changing, client, nextOwner, owner, parent]);
  // Prevent a new account's components from observing the previous cache even
  // for the render before the layout effect. Remount drafts only on transition.
  // Do not mount queries with an unknown owner only to cancel and mount them
  // again when the initial session resolves (including anonymous public pages).
  if (changing || owner === undefined) return null;
  return <QueryClientProvider client={client}><Fragment key={owner ?? "anonymous"}>{children}</Fragment></QueryClientProvider>;
}
