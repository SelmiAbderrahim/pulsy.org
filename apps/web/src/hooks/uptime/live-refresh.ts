import type { QueryClient } from "@tanstack/react-query";
import { uptimeKeys } from "./queryKeys";

/** Monitor intervals are seconds; Query's polling interval is milliseconds. */
export function monitorRefetchInterval(checkInterval: number): number {
  return Math.min(60_000, Math.max(15_000, (Number.isFinite(checkInterval) ? checkInterval : 60) * 1000));
}

/** Prefix keys refresh every loaded window and page without touching another monitor. */
export async function invalidateMonitorData(client: QueryClient, monitorId: string) {
  await Promise.all([
    uptimeKeys.monitors.detail(monitorId),
    uptimeKeys.checkLogs.stats(monitorId),
    uptimeKeys.checkLogs.list(monitorId),
    uptimeKeys.checkLogs.daily(monitorId),
  ].map(queryKey => client.invalidateQueries({ queryKey })));
}
