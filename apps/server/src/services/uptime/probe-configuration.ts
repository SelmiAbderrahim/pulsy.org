import type { UptimeMonitor } from "./monitor-service";

/** Identity of the request that produced a sample. Never log this key. */
export function probeConfigurationKey(monitor: UptimeMonitor): string {
  return JSON.stringify([
    monitor.monitorType, monitor.url, monitor.method, monitor.networkConfig,
    monitor.expectedStatus, monitor.expectedStatuses, monitor.httpAssertions,
    monitor.redirectPolicy, monitor.requestCipher, monitor.timeout, monitor.interval,
  ]);
}

/** A completed old request must not overwrite a paused or retargeted monitor. */
export function acceptsProbeResult(current: UptimeMonitor, probed: UptimeMonitor): boolean {
  return current.active && probeConfigurationKey(current) === probeConfigurationKey(probed);
}
