import { describe, expect, it } from "vitest";
import type { SlaReport } from "@/types/uptime";
import { slaReportExport, slaReportToCsv, slaReportToJson } from "./sla-report-export";

const report: SlaReport = {
  uptimeMonitorId: "m1",
  monitorName: "API",
  url: "https://api.example.com",
  windowFrom: "2026-09-17T00:00:00.000Z",
  windowTo: "2026-10-17T00:00:00.000Z",
  windowDays: 30,
  periodLabel: "Last 30 days",
  generatedAt: "2026-10-17T08:30:00.000Z",
  windowTimezone: "UTC",
  stats: { totalChecks: 1000, successfulChecks: 940, degradedChecks: 20, failedChecks: 40, avgResponseTime: 182.5, minResponseTime: 40, maxResponseTime: 4100, p95ResponseTime: 650, uptimePercentage: 94 },
  incidents: { count: 2, totalDowntimeSeconds: 5400, longestIncidentSeconds: 3600 },
  incidentList: [
    { incidentId: "i1", status: "resolved", startedAt: "2026-10-01T10:00:00.000Z", resolvedAt: "2026-10-01T11:00:00.000Z", downtimeSeconds: 3600 },
    { incidentId: "i2", status: "ongoing", startedAt: "2026-10-16T23:30:00.000Z", resolvedAt: null, downtimeSeconds: 1800 },
  ],
  dailyUptime: [
    { date: "2026-10-15", uptimePercentage: 99.65, totalChecks: 288 },
    { date: "2026-10-16", uptimePercentage: 87.5, totalChecks: 288 },
  ],
};

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [[]];
  let cellText = "";
  let quoted = false;
  const endCell = () => { rows[rows.length - 1]!.push(cellText); cellText = ""; };
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]!;
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') { cellText += '"'; i++; }
      else if (char === '"') quoted = false;
      else cellText += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") endCell();
    else if (char === "\r") { endCell(); i++; rows.push([]); }
    else cellText += char;
  }
  return rows.filter(row => row.length > 1);
}

describe("SLA report exports share the report (PDF) model", () => {
  it("JSON carries the exact window, timezone, check-success figures, downtime and incidents of the model", () => {
    const parsed = JSON.parse(slaReportToJson(report, "Europe/Paris (UTC+2)"));
    expect(parsed).toEqual(JSON.parse(JSON.stringify(slaReportExport(report, "Europe/Paris (UTC+2)"))));
    expect(parsed.window).toEqual({ from: report.windowFrom, to: report.windowTo, days: 30, periodLabel: "Last 30 days", computedIn: "UTC" });
    expect(parsed.displayTimezone).toBe("Europe/Paris (UTC+2)");
    expect(parsed.stats).toEqual(report.stats);
    expect(parsed.downtimeSeconds).toBe(report.incidents.totalDowntimeSeconds);
    expect(parsed.incidents.list).toEqual(report.incidentList);
    expect(parsed.dailyUptime).toEqual(report.dailyUptime);
    // Raw measurements stay numeric, never formatted strings.
    expect(typeof parsed.stats.uptimePercentage).toBe("number");
  });

  it("CSV repeats every JSON figure and labels both timezones", () => {
    const rows = parseCsv(slaReportToCsv(report, "Europe/Paris (UTC+2)"));
    const field = (name: string) => rows.find(row => row[0] === name)?.[1];
    expect(field("window_computed_in")).toBe("UTC");
    expect(field("display_timezone")).toBe("Europe/Paris (UTC+2)");
    expect(field("window_from_utc")).toBe(report.windowFrom);
    expect(field("window_to_utc")).toBe(report.windowTo);
    expect(Number(field("check_success_percentage"))).toBe(report.stats.uptimePercentage);
    expect(Number(field("total_checks"))).toBe(report.stats.totalChecks);
    expect(Number(field("successful_checks")) + Number(field("degraded_checks")) + Number(field("failed_checks"))).toBe(report.stats.totalChecks);
    expect(Number(field("downtime_seconds"))).toBe(report.incidents.totalDowntimeSeconds);
    expect(Number(field("incident_count"))).toBe(report.incidents.count);
    const incidentRows = rows.filter(row => row[0] === "i1" || row[0] === "i2");
    expect(incidentRows.map(row => Number(row[4]))).toEqual(report.incidentList!.map(incident => incident.downtimeSeconds));
    expect(incidentRows.reduce((sum, row) => sum + Number(row[4]), 0)).toBe(report.incidents.totalDowntimeSeconds);
    const dayRows = rows.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row[0] ?? ""));
    expect(dayRows.map(row => [row[0], Number(row[1]), Number(row[2])])).toEqual(report.dailyUptime.map(day => [day.date, day.uptimePercentage, day.totalChecks]));
  });

  it("keeps a missing measurement empty instead of inventing 0 or 100", () => {
    const empty = { ...report, stats: { ...report.stats, totalChecks: 0, successfulChecks: 0, degradedChecks: 0, failedChecks: 0, uptimePercentage: null, avgResponseTime: null, p95ResponseTime: null }, incidentList: [], dailyUptime: [] };
    expect(JSON.parse(slaReportToJson(empty, "UTC")).stats.uptimePercentage).toBeNull();
    const rows = parseCsv(slaReportToCsv(empty, "UTC"));
    expect(rows.find(row => row[0] === "check_success_percentage")?.[1] ?? "").toBe("");
  });

  it("neutralizes spreadsheet formulas and quotes in user-controlled text", () => {
    const csv = slaReportToCsv({ ...report, monitorName: '=HYPERLINK("http://evil")', url: "@cmd" }, "UTC");
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`"'@cmd"`);
  });
});
