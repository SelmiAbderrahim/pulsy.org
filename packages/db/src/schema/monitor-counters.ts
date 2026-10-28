/**
 * One partition of monitors into dashboard states, shared by the server
 * summary and the browser counters. Paused takes precedence over the last
 * measured health, so Up + Down + Degraded + Pending + Paused = Total.
 */
export type MonitorCounterState = "up" | "down" | "degraded" | "pending" | "paused";

export interface MonitorCounters {
  totalMonitors: number;
  activeMonitors: number;
  monitorsUp: number;
  monitorsDown: number;
  monitorsDegraded: number;
  monitorsPending: number;
  monitorsPaused: number;
}

interface CountedMonitor { status: string; active: boolean }

export function monitorCounterState(monitor: CountedMonitor): MonitorCounterState {
  if (!monitor.active) return "paused";
  return monitor.status === "up" || monitor.status === "down" || monitor.status === "degraded" ? monitor.status : "pending";
}

/** Count rows (or pre-grouped rows with `total`) into one consistent snapshot. */
export function countMonitorStates(rows: Iterable<CountedMonitor & { total?: number }>): MonitorCounters {
  const counts = { up: 0, down: 0, degraded: 0, pending: 0, paused: 0 };
  for (const row of rows) counts[monitorCounterState(row)] += row.total ?? 1;
  const totalMonitors = counts.up + counts.down + counts.degraded + counts.pending + counts.paused;
  return {
    totalMonitors,
    activeMonitors: totalMonitors - counts.paused,
    monitorsUp: counts.up,
    monitorsDown: counts.down,
    monitorsDegraded: counts.degraded,
    monitorsPending: counts.pending,
    monitorsPaused: counts.paused,
  };
}

/** Invariant guard: every monitor lands in exactly one state. */
export function assertCountersConsistent(counters: MonitorCounters): void {
  const sum = counters.monitorsUp + counters.monitorsDown + counters.monitorsDegraded + counters.monitorsPending + counters.monitorsPaused;
  if (sum !== counters.totalMonitors || counters.activeMonitors !== counters.totalMonitors - counters.monitorsPaused) {
    throw new Error("Monitor state counters do not add up to the total");
  }
}

/** Equal-weight mean of per-monitor measurements, rounded to two decimals. */
export function meanUptimePercentage(values: readonly (number | null | undefined)[]): { avgUptimePercentage: number | null; uptimeMonitorsWithData: number } {
  const known = values.filter((value): value is number => typeof value === "number");
  return {
    avgUptimePercentage: known.length ? Math.round((known.reduce((sum, value) => sum + value, 0) / known.length) * 100) / 100 : null,
    uptimeMonitorsWithData: known.length,
  };
}
