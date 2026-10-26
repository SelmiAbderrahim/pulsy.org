import { describe, expect, it } from "vitest";
import { canonicalMonitorUrl, duplicateMonitor, normalizeMonitorUrl } from "./monitor-url";
import { checkErrorCodeOf, isCheckErrorCode } from "./check-error";
import { jsonDiagnostic } from "./json-diagnostic";
import { apiLatencyPolicy } from "./validation-latency";
import { apiMaintenanceConfig } from "./validation-maintenance";
import { apiReliabilityWindow } from "./validation-reliability";
import { apiMonitorViewFilters } from "./monitor-view";
import { apiMonitorTemplateConfiguration } from "./monitor-template";
import { apiServerConfiguration } from "./validation-server";

describe("shared configuration boundaries", () => {
  it("normalizes destinations and identifies duplicate fragments and trailing slashes", () => {
    expect(normalizeMonitorUrl(" example.com/health#private ")).toBe("https://example.com/health");
    expect(canonicalMonitorUrl("https://example.com/health///")).toBe("https://example.com/health");
    const monitors = [{ name: "API", url: "https://example.com/health/" }];
    expect(duplicateMonitor("example.com/health#section", monitors)).toBe(monitors[0]);
    for (const url of ["ftp://example.com", "https://user:secret@example.com", "", "bad host"])
      expect(normalizeMonitorUrl(url)).toBeNull();
  });

  it("classifies legacy check failures without treating owner notes as check errors", () => {
    expect(checkErrorCodeOf("TCP connection refused")).toBe("connection_refused");
    expect(checkErrorCodeOf("Unexpected status: 503 (expected 200)")).toBe("unexpected_status");
    expect(checkErrorCodeOf("Investigating deployment")).toBeNull();
    expect(isCheckErrorCode("heartbeat_missed")).toBe(true);
    expect(isCheckErrorCode({ code: "unknown" })).toBe(false);
  });

  it("reports safe JSON coordinates without copying the private parser message", () => {
    expect(jsonDiagnostic('{\n"token":', new SyntaxError("Unexpected end of JSON input")))
      .toEqual({ line: 2, column: 9, reason: "incomplete" });
    const diagnostic = jsonDiagnostic("private-token", new SyntaxError("Invalid private-token at position 3"));
    expect(diagnostic).toEqual({ line: 1, column: 4, reason: "syntax" });
    expect(JSON.stringify(diagnostic)).not.toContain("private-token");
  });

  it("requires a recovery latency threshold below the failure threshold", () => {
    const policy = { thresholdMs: 1000, slowCount: 2, recoveryThresholdMs: 500, recoveryCount: 2 };
    expect(apiLatencyPolicy.safeParse(policy).success).toBe(true);
    expect(apiLatencyPolicy.safeParse({ ...policy, recoveryThresholdMs: 1001 }).success).toBe(false);
    expect(apiLatencyPolicy.safeParse({ ...policy, thresholdMs: null }).success).toBe(false);
  });

  it("bounds recurring maintenance duration and accepts explicit timezone offsets", () => {
    const config = { name: "Deploy", startsAt: "2026-10-01T10:00:00+02:00", endsAt: "2026-10-01T12:00:00+02:00", recurrence: "daily" };
    expect(apiMaintenanceConfig.parse(config).startsAt).toBe("2026-10-01T08:00:00.000Z");
    expect(apiMaintenanceConfig.safeParse({ ...config, endsAt: "2026-10-03T12:00:00+02:00" }).success).toBe(false);
    expect(apiMaintenanceConfig.safeParse({ ...config, timezone: "Mars/Base" }).success).toBe(false);
  });

  it("rejects reversed and unbounded reliability windows", () => {
    expect(apiReliabilityWindow.safeParse({ from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" }).success).toBe(true);
    expect(apiReliabilityWindow.safeParse({ from: "2026-02-01T00:00:00Z", to: "2026-01-01T00:00:00Z" }).success).toBe(false);
    expect(apiReliabilityWindow.safeParse({ from: "2020-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" }).success).toBe(false);
  });

  it("deduplicates view tags and keeps request credentials out of templates", () => {
    expect(apiMonitorViewFilters.parse({ tags: [" prod ", "prod"] }).tags).toEqual(["prod"]);
    expect(apiMonitorViewFilters.safeParse({ health: "unrecognized" }).success).toBe(false);
    expect(apiMonitorTemplateConfiguration.safeParse({ requestConfig: { auth: { type: "bearer", token: "secret" } } }).success).toBe(false);
    expect(apiMonitorTemplateConfiguration.safeParse({}).success).toBe(true);
  });

  it("applies nested server thresholds when configuration omits them", () => {
    expect(apiServerConfiguration.parse({ name: "Host" }).thresholds).toEqual({ cpu: 90, memory: 90, disk: 90 });
  });
});
