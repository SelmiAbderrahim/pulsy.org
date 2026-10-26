import type { UptimeMonitor } from "./monitor-service";
import { performHttpCheck, type HttpCheckResult } from "./checker-service";
import { performDnsCheck, performTcpCheck } from "./network-check";
export function performMonitorProbe(monitor: UptimeMonitor): Promise<HttpCheckResult> {
  if (monitor.monitorType === "dns" && monitor.networkConfig?.type === "dns") return performDnsCheck(monitor.networkConfig, monitor.timeout);
  if (monitor.monitorType === "tcp" && monitor.networkConfig?.type === "tcp") return performTcpCheck(monitor.networkConfig, monitor.timeout);
  if (!monitor.monitorType || monitor.monitorType === "http") return performHttpCheck(monitor);
  return Promise.resolve({ status: "down", httpStatus: null, responseTime: null, errorMessage: "invalid_configuration" });
}
