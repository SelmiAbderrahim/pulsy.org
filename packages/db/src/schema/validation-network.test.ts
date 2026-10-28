import { describe, expect, it } from "vitest";
import { apiNetworkMonitor, apiDnsConfiguration } from "./validation-network";
const base = { name: "DNS health", interval: 300, timeout: 1000, failureThreshold: 2, active: false, tags: [] };
describe("typed DNS/TCP configuration", () => {
  it("preserves underscore TXT names and type-specific expectations", () => {
    const configuration = { type: "dns", hostname: "_acme-challenge.Example.invalid.", recordType: "TXT", mode: "matches", expected: ["Case Sensitive", "two chunks"] };
    expect(apiNetworkMonitor.parse({ ...base, configuration }).configuration).toEqual(configuration);
    expect(apiDnsConfiguration.parse({ type: "dns", hostname: "example.invalid", recordType: "MX", mode: "matches", expected: [{ exchange: "Mail.Example.invalid.", priority: 10 }] }).recordType).toBe("MX");
  });
  it("rejects mismatched answer types, empty required expectations, socket URLs, invalid ports and unbounded work", () => {
    for (const configuration of [
      { type: "dns", hostname: "example.invalid", recordType: "A", mode: "matches", expected: ["not-an-ip"] },
      { type: "dns", hostname: "example.invalid", recordType: "AAAA", mode: "matches", expected: ["127.0.0.1"] },
      { type: "dns", hostname: "example.invalid", recordType: "MX", mode: "matches", expected: ["mail.invalid"] },
      { type: "dns", hostname: "example.invalid", recordType: "TXT", mode: "matches", expected: [] },
      { type: "dns", hostname: "example.invalid", recordType: "TXT", mode: "exists", expected: ["x".repeat(4097)] },
      { type: "dns", hostname: "bad/hostname", recordType: "A", mode: "exists", expected: [] },
      { type: "tcp", hostname: "http://127.0.0.1", port: 80 }, { type: "tcp", hostname: "127.0.0.1", port: 65536 },
    ]) expect(apiNetworkMonitor.safeParse({ ...base, configuration }).success).toBe(false);
    expect(apiNetworkMonitor.safeParse({ ...base, timeout: 60001, configuration: { type: "tcp", hostname: "localhost", port: 80 } }).success).toBe(false);
  });
  it("accepts underscore CNAME targets and an exclusive zero-priority null MX", () => {
    expect(apiDnsConfiguration.safeParse({ type: "dns", hostname: "_selector.example.invalid", recordType: "CNAME", mode: "matches", expected: ["_target.Example.invalid."] }).success).toBe(true);
    const nullMx = { type: "dns", hostname: "example.invalid", recordType: "MX", mode: "matches", expected: [{ exchange: ".", priority: 0 }] };
    expect(apiDnsConfiguration.safeParse(nullMx).success).toBe(true);
    expect(apiDnsConfiguration.safeParse({ ...nullMx, expected: [{ exchange: ".", priority: 10 }] }).success).toBe(false);
    expect(apiDnsConfiguration.safeParse({ ...nullMx, expected: [...nullMx.expected, { exchange: "mail.invalid", priority: 10 }] }).success).toBe(false);
  });
  it("requires paired IPv6 brackets while accepting bracketed and unbracketed addresses", () => {
    for (const hostname of ["[::1", "::1]", "[[::1]]"]) expect(apiNetworkMonitor.safeParse({ ...base, configuration: { type: "tcp", hostname, port: 80 } }).success).toBe(false);
    for (const hostname of ["[::1]", "::1"]) expect(apiNetworkMonitor.safeParse({ ...base, configuration: { type: "tcp", hostname, port: 80 } }).success).toBe(true);
  });
});

it.each(["dns", "tcp"])("shares the HTTP 60-second timeout boundary for %s", type => {
  const configuration = type === "dns" ? { type, hostname: "example.invalid", recordType: "A", mode: "exists", expected: [] } : { type, hostname: "example.invalid", port: 443 };
  expect(apiNetworkMonitor.safeParse({ ...base, configuration, timeout: 60000 }).success).toBe(true);
  expect(apiNetworkMonitor.safeParse({ ...base, configuration, timeout: 60001 }).success).toBe(false);
});
