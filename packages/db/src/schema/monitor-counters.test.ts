import { describe, expect, it } from "vitest";
import { assertCountersConsistent, countMonitorStates, meanUptimePercentage, monitorCounterState } from "./monitor-counters";

describe("monitor counters", () => {
  it("partitions every monitor into exactly one state, paused first", () => {
    expect(monitorCounterState({ status: "down", active: false })).toBe("paused");
    expect(monitorCounterState({ status: "degraded", active: true })).toBe("degraded");
    const counters = countMonitorStates([
      { status: "up", active: true }, { status: "down", active: true }, { status: "down", active: false },
      { status: "pending", active: true }, { status: "up", active: true, total: 3 },
    ]);
    expect(counters).toEqual({ totalMonitors: 7, activeMonitors: 6, monitorsUp: 4, monitorsDown: 1, monitorsDegraded: 0, monitorsPending: 1, monitorsPaused: 1 });
    expect(() => assertCountersConsistent(counters)).not.toThrow();
    expect(() => assertCountersConsistent({ ...counters, totalMonitors: 8 })).toThrow();
  });

  it("averages known measurements equally and keeps missing data missing", () => {
    expect(meanUptimePercentage([100, 0, null])).toEqual({ avgUptimePercentage: 50, uptimeMonitorsWithData: 2 });
    expect(meanUptimePercentage([null])).toEqual({ avgUptimePercentage: null, uptimeMonitorsWithData: 0 });
  });
});
