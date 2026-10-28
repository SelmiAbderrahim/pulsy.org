import type { QueryClient } from "@tanstack/react-query";

const retired = new WeakSet<QueryClient>();

/** Retired clients stay detached even if an old mutation later settles. */
export function retireSessionClient(client: QueryClient): void {
  retired.add(client);
  client.clear();
}

/** Browser side effects from an old session must stop as well as cache writes. */
export function isSessionClientActive(client: QueryClient): boolean {
  return !retired.has(client);
}
