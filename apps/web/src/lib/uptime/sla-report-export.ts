/**
 * Machine-readable SLA report exports (CSV/JSON). Same model as the PDF:
 * window (computed in UTC), display timezone, check success, downtime and
 * the incident list. Raw values stay numeric and timestamps stay ISO-8601 UTC.
 *
 * @module lib/uptime/sla-report-export
 */
import type { SlaReport } from "@/types/uptime";

export function slaReportExport(report: SlaReport, displayTimezone: string) {
  return {
    monitor: { uptimeMonitorId: report.uptimeMonitorId, name: report.monitorName, url: report.url },
    window: { from: report.windowFrom, to: report.windowTo, days: report.windowDays, periodLabel: report.periodLabel, computedIn: report.windowTimezone ?? "UTC" },
    displayTimezone,
    generatedAt: report.generatedAt,
    stats: report.stats,
    downtimeSeconds: report.incidents.totalDowntimeSeconds,
    incidents: { ...report.incidents, list: report.incidentList ?? [] },
    dailyUptime: report.dailyUptime,
  };
}

export function slaReportToJson(report: SlaReport, displayTimezone: string): string {
  return `${JSON.stringify(slaReportExport(report, displayTimezone), null, 2)}\n`;
}

/** Quote every text cell; neutralize spreadsheet formulas in user-controlled text. */
function cell(value: string | number | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

export function slaReportToCsv(report: SlaReport, displayTimezone: string): string {
  const data = slaReportExport(report, displayTimezone);
  const rows: (string | number | null)[][] = [
    ["field", "value"],
    ["monitor_id", data.monitor.uptimeMonitorId], ["monitor_name", data.monitor.name], ["monitor_url", data.monitor.url],
    ["window_from_utc", data.window.from], ["window_to_utc", data.window.to], ["window_days", data.window.days],
    ["window_computed_in", data.window.computedIn], ["display_timezone", data.displayTimezone], ["generated_at_utc", data.generatedAt],
    ["check_success_percentage", data.stats.uptimePercentage], ["total_checks", data.stats.totalChecks],
    ["successful_checks", data.stats.successfulChecks], ["degraded_checks", data.stats.degradedChecks], ["failed_checks", data.stats.failedChecks],
    ["avg_response_time_ms", data.stats.avgResponseTime], ["p95_response_time_ms", data.stats.p95ResponseTime],
    ["incident_count", data.incidents.count], ["downtime_seconds", data.downtimeSeconds], ["longest_incident_seconds", data.incidents.longestIncidentSeconds],
    [],
    ["incident_id", "status", "started_at_utc", "resolved_at_utc", "downtime_seconds"],
    ...data.incidents.list.map(incident => [incident.incidentId, incident.status, incident.startedAt, incident.resolvedAt, incident.downtimeSeconds]),
    [],
    ["date_utc", "check_success_percentage", "total_checks"],
    ...data.dailyUptime.map(day => [day.date, day.uptimePercentage, day.totalChecks]),
  ];
  return `${rows.map(row => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** Save generated text through a temporary object URL. */
export function downloadText(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
