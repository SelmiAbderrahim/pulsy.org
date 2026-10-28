import { describe, expect, it } from "vitest";
import { parseMonitorManifest } from "./monitor-manifest";
const http = { key: "api-prod", type: "http", name: "API", interval: 300, active: false, tags: ["production"], url: "https://example.invalid/health", method: "GET", expectedStatus: 200, timeout: 10000, failureThreshold: 3, redirectPolicy: "follow", httpAssertions: [{ type: "json", path: "$.status", op: "equals", value: "ok" }] };
const encode = (monitors: unknown[]) => JSON.stringify({ format: "pulsy-monitor-configuration", version: 1, monitors });
describe("native configuration trust boundary", () => {
  it("round-trips typed non-secret HTTP and interval heartbeat configuration", () => {
    const input = encode([http, { key: "backup", type: "heartbeat", name: "Backup", interval: 3600, graceSeconds: 120, active: false, tags: [] }]);
    const result = parseMonitorManifest(input);
    expect(result.manifest.monitors).toEqual([http, { key: "backup", type: "heartbeat", name: "Backup", interval: 3600, graceSeconds: 120, active: false, tags: [] }]);
    expect(result.warnings).toEqual([]);
  });
  it("drops imported authentication, request values and token-bearing URLs without echoing or keeping them", () => {
    const result = parseMonitorManifest(encode([{ ...http, url: "https://user:private-password@example.invalid/health?api_key=private-token", requestConfig: { auth: { type: "bearer", token: "private-token" }, body: "private-body" }, heartbeatToken: "private-heartbeat", channelIds: ["owned-reference"] }]));
    expect(result.manifest.monitors[0]).toMatchObject({ url: null, needsReentry: ["request", "url"] });
    expect(JSON.stringify(result)).not.toMatch(/private-|user:|api_key/);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("refuses dangerous keys, unrecognized fields/types/versions, duplicate keys and excessive depth/count/bytes", () => {
    for (const text of [
      '{"format":"pulsy-monitor-configuration","version":1,"monitors":[],"__proto__":{}}',
      encode([{ ...http, unexpected: true }]), encode([{ ...http, type: "browser" }]),
      encode([http, http]), JSON.stringify({ format: "pulsy-monitor-configuration", version: 2, monitors: [http] }),
      encode(Array.from({ length: 201 }, (_, i) => ({ ...http, key: String(i) }))),
      encode([{ ...http, requestConfig: JSON.parse('['.repeat(18) + '0' + ']'.repeat(18)) }]),
      " ".repeat(262145),
    ]) expect(() => parseMonitorManifest(text)).toThrow();
  });
  it("strips sensitive response-header rules and leaves their absence explicit", () => {
    const result = parseMonitorManifest(encode([{ ...http, httpAssertions: [{ type: "header_equals", name: "Authorization", value: "private-auth" }, { type: "header_contains", name: "Set-Cookie", value: "private-cookie" }] }]));
    expect(result.manifest.monitors[0]).toMatchObject({ needsReentry: ["assertions"] });
    expect(result.manifest.monitors[0]).not.toHaveProperty("httpAssertions");
    expect(JSON.stringify(result)).not.toContain("private-");
  });
  it("redacts imported secrets repeated in assertions, names or URL paths before returning any preview", () => {
    const result = parseMonitorManifest(encode([{ ...http, name: "API private-token", url: "https://example.invalid/private-token", requestConfig: { auth: { type: "bearer", token: "private-token" } }, httpAssertions: [{ type: "json", path: "$.token", op: "equals", value: "private-token" }] }]));
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(result.manifest.monitors[0]).toMatchObject({ url: null });
    expect(result.manifest.monitors[0]).not.toHaveProperty("httpAssertions");
  });
  it("removes numeric private JSON-body values repeated as assertion expectations", () => {
    const result = parseMonitorManifest(encode([{ ...http, requestConfig: { body: '{"pin":1234}' }, httpAssertions: [{ type: "json", path: "$.pin", op: "equals", value: 1234 }] }]));
    expect(JSON.stringify(result)).not.toContain("1234");
    expect(result.manifest.monitors[0]).not.toHaveProperty("httpAssertions");
  });
  it("rejects malformed or non-HTTP destinations instead of treating them as secret omissions", () => {
    for (const url of ["relative/path", "ftp://example.invalid/file", "https://", "file:///etc/passwd"])
      expect(() => parseMonitorManifest(encode([{ ...http, url }]))).toThrow();
  });
});

it("reports only safe field or line coordinates without echoing private JSON", () => {
  for (const text of ['{\n  "private-token": secret\n}', JSON.stringify({ format: "private-token", version: 1, monitors: [] })]) {
    try { parseMonitorManifest(text); throw new Error("Expected validation failure"); }
    catch (error) { expect(error).toMatchObject({ name: "MonitorManifestError" }); expect(String(error)).not.toContain("private-token"); expect(JSON.stringify(error)).not.toContain("private-token"); }
  }
});

it("round-trips DNS and TCP configurations at the shared 60-second timeout maximum", () => {
  for (const type of ["dns", "tcp"] as const) {
    const configuration = type === "dns" ? { type, hostname: "example.invalid", recordType: "A", mode: "exists", expected: [] } : { type, hostname: "example.invalid", port: 443 };
    const monitor = { key: type, type, name: type, interval: 300, active: false, tags: [], timeout: 60000, failureThreshold: 3, configuration };
    const text = JSON.stringify({ format: "pulsy-monitor-configuration", version: 1, monitors: [monitor] });
    expect(parseMonitorManifest(text).manifest.monitors[0]).toMatchObject({ timeout: 60000 });
  }
});
