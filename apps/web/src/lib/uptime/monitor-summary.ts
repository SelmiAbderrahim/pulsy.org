/**
 * Dashboard counters derived from the same monitor rows the list renders, so
 * the card and the list always describe one snapshot.
 *
 * @module lib/uptime/monitor-summary
 */
import { countMonitorStates, meanUptimePercentage, monitorCounterState } from "@pulsy/db/monitor-counters";
import type { UptimeDashboardSummary, UptimeMonitor } from "@/types/uptime";

export { monitorCounterState };

type SummarizedMonitor = Pick<UptimeMonitor, "status" | "active" | "uptimePercentage">;

export function summarizeMonitors(rows: readonly SummarizedMonitor[]): UptimeDashboardSummary {
  const counters = countMonitorStates(rows);
  return {
    totalMonitors: counters.totalMonitors,
    monitorsUp: counters.monitorsUp,
    monitorsDown: counters.monitorsDown,
    monitorsDegraded: counters.monitorsDegraded,
    monitorsPending: counters.monitorsPending,
    monitorsPaused: counters.monitorsPaused,
    ...meanUptimePercentage(rows.map(row => row.uptimePercentage)),
  };
}
