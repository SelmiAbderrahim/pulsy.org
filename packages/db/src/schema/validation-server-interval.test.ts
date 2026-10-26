import { describe, expect, it } from "vitest";
import { apiServerConfiguration } from "./validation-server";
import { apiServerReportingInterval, SERVER_REPORTING_INTERVALS } from "./validation-server-interval";

describe("server reporting interval choices", () => {
  it("accepts every Select choice through the server configuration schema", () => {
    for (const interval of SERVER_REPORTING_INTERVALS) expect(apiServerConfiguration.parse({ name: "Host", interval }).interval).toBe(interval);
  });
  it("preserves valid custom settings and rejects fractional or out-of-bounds values", () => {
    expect(apiServerConfiguration.parse({ name: "Host", interval: 90 }).interval).toBe(90);
    for (const interval of [59, 3601, 60.5, NaN, Infinity]) expect(apiServerReportingInterval.safeParse(interval).success).toBe(false);
  });
});
