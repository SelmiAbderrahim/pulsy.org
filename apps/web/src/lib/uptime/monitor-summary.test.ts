import { describe, expect, it } from "vitest";
import { monitorCounterState, summarizeMonitors } from "./monitor-summary";

type Row = Parameters<typeof summarizeMonitors>[0][number];
const row = (status: string, active = true, uptimePercentage: number | null = null) => ({ status, active, uptimePercentage }) as Row;

describe("summarizeMonitors (card derived from the list snapshot)", () => {
  it("Total equals the list length after every create in sequence (never lags by one)", () => {
    const rows: Row[] = [];
    for (let n = 1; n <= 25; n++) {
      rows.push(row(n % 3 === 0 ? "down" : "up"));
      expect(summarizeMonitors(rows).totalMonitors).toBe(n);
    }
  });

  it("the Down counter equals the number of Down rows for any mixed fleet, and the states sum to Total", () => {
    const fleet = [row("up"), row("down"), row("down"), row("down", false), row("degraded"), row("pending"), row("up", false), row("down")];
    const summary = summarizeMonitors(fleet);
    expect(summary.monitorsDown).toBe(fleet.filter(item => monitorCounterState(item) === "down").length);
    expect(summary.monitorsDown).toBe(3);
    expect(summary.monitorsPaused).toBe(2);
    expect(summary.monitorsUp + summary.monitorsDown + summary.monitorsDegraded + summary.monitorsPending + summary.monitorsPaused).toBe(summary.totalMonitors);
  });

  it("a paused monitor never counts as its last measured health", () => {
    expect(summarizeMonitors([row("down", false)])).toMatchObject({ monitorsDown: 0, monitorsPaused: 1, totalMonitors: 1 });
  });

  it("averages known percentages equally and reports unknown (not 0) with no data", () => {
    expect(summarizeMonitors([row("up", true, 100), row("down", true, 50), row("pending")])).toMatchObject({ avgUptimePercentage: 75, uptimeMonitorsWithData: 2 });
    expect(summarizeMonitors([row("pending")]).avgUptimePercentage).toBeNull();
    expect(summarizeMonitors([]).totalMonitors).toBe(0);
  });
});
