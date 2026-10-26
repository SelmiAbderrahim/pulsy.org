import { describe, expect, it } from "vitest";
import { availabilityPercent, overallStatus, slowSharePercent } from "./status-math";

const parts = (...statuses: string[]) => statuses.map(status => ({ status }));

describe("status math", () => {
  it("counts degraded checks as available and reports them as slow", () => {
    expect(availabilityPercent(0, 10, 10)).toBe(100);
    expect(slowSharePercent(10, 10)).toBe(100);
    expect(availabilityPercent(6, 3, 10)).toBe(90);
    expect(slowSharePercent(0, 10)).toBe(0);
    expect(availabilityPercent(0, 0, 0)).toBeNull();
    expect(slowSharePercent(0, 0)).toBeNull();
  });

  it.each([
    [parts(), "unknown"],
    [parts("up", "up"), "operational"],
    [parts("up", "degraded"), "degraded"],
    [parts("up", "pending"), "unknown"],
    [parts("up", "up", "up", "down", "down"), "partial"],
    [parts("degraded", "down"), "partial"],
    [parts("down", "down"), "outage"],
    [parts("down"), "outage"],
  ] as const)("overallStatus(%j) = %s", (components, expected) => {
    expect(overallStatus(components)).toBe(expected);
  });

  it("derives availability 100% and slow share 60% for 100 checks of which 60 are degraded", () => {
    expect(availabilityPercent(40, 60, 100)).toBe(100);
    expect(slowSharePercent(60, 100)).toBe(60);
  });

  it.each([
    [0, "operational"],
    [1, "partial"],
    [2, "partial"],
    [3, "partial"],
    [5, "outage"],
  ] as const)("five components with %i down is %s", (down, expected) => {
    const components = Array.from({ length: 5 }, (_, index) => ({ status: index < down ? "down" : "up" }));
    expect(overallStatus(components)).toBe(expected);
  });

  it("keeps maintenance a per-component badge that never changes the banner", () => {
    expect(overallStatus([{ status: "up", maintenance: true }, { status: "up" }])).toBe("operational");
    expect(overallStatus([{ status: "down", maintenance: true }, { status: "up" }])).toBe("partial");
    expect(overallStatus([{ status: "degraded" }, { status: "up", maintenance: true }])).toBe("degraded");
  });
});
