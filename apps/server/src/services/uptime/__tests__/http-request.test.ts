import { afterEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../../../lib/crypto";
import { performAdvancedHttpCheck } from "../http-request";
import { performHttpCheck } from "../checker-service";
import type { UptimeMonitor } from "../monitor-service";

function monitor(extra: Partial<UptimeMonitor> = {}): UptimeMonitor {
  return { monitorType: "http", externalKey: null, networkConfig: null, name: "Fixture", userId: "fixture-owner", status: "pending", interval: 300, active: true, createdAt: "2026-10-09T00:00:00Z", uptimeMonitorId: "fixture", url: "http://8.8.8.8/health", method: "GET", timeout: 1000, expectedStatus: 200, expectedStatuses: null, tlsMonitoringEnabled: true, httpAssertions: [], redirectPolicy: "follow", requestCipher: null, notificationOutageId: null, latencyPolicy: null, consecutiveSlow: 0, consecutiveHealthy: 0, lastOperationalAlertAt: null, lastOperationalAlertId: null, httpStatus: null, responseTime: null, lastCheckedAt: null, nextCheckAt: null, tlsExpiresAt: null, tlsExpiresInDays: null, consecutiveFailures: 0, failureThreshold: 3, uptimePercentage: null, tags: [], isPublic: false, statusPageTitle: null, statusPageDescription: null, ...extra };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("advanced HTTP request", () => {
  it.each([201, 401])("keeps unexpected %i classification consistent with optional request configuration", async (status) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ready", { status, headers: { "x-ready": "yes" } }));
    for (const extra of [
      {},
      { requestCipher: encrypt("{}") },
      { httpAssertions: [{ type: "header_equals" as const, name: "X-Ready", value: "yes" }] },
    ]) {
      expect(await performHttpCheck(monitor(extra))).toMatchObject({
        status: status >= 400 ? "down" : "degraded", httpStatus: status, errorMessage: "unexpected_status",
      });
    }
  });

  it("keeps failed assertions down even when the unexpected status alone would be degraded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ready", { status: 201 }));
    expect(await performHttpCheck(monitor({ httpAssertions: [{ type: "header_equals", name: "X-Ready", value: "yes" }] })))
      .toMatchObject({ status: "down", httpStatus: 201, assertionOutcomes: [{ index: 0, passed: false, reason: "missing" }] });
  });

  it("turns a successful status with failed JSON into Down using exactly one response", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"status":"error","private":"fixture-secret"}'));
    const result = await performAdvancedHttpCheck(monitor({ httpAssertions: [{ type: "json", path: "$.status", op: "equals", value: "ok" }] }));
    expect(result.status).toBe("down");
    expect(result.httpStatus).toBe(200);
    expect(result).toHaveProperty("assertionOutcomes", [{ index: 0, passed: false, reason: "mismatch" }]);
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("decrypts request values only for the single request and strips all configured headers on another origin", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push({ url: String(input), init });
      return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "http://1.1.1.1/health" } }) : new Response("ready");
    });
    const result = await performAdvancedHttpCheck(monitor({ requestCipher: encrypt(JSON.stringify({ headers: [{ name: "X-Private", value: "fixture-secret" }], auth: { type: "bearer", token: "fixture-bearer" } })) }));
    expect(result.status).toBe("up");
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer fixture-bearer");
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBeNull();
    expect(new Headers(calls[1]?.init?.headers).get("x-private")).toBeNull();
  });
  it("does not forward a private POST body through an unrelated-origin 307", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 307, headers: { location: "http://1.1.1.1/" } }));
    const result = await performAdvancedHttpCheck(monitor({ method: "POST", requestCipher: encrypt(JSON.stringify({ headers: [], body: "fixture-private-body", contentType: "text/plain" })) }));
    expect(result.status).toBe("down");
    expect(result.errorMessage).toMatch(/redirect/i);
    expect(JSON.stringify(result)).not.toContain("fixture-private-body");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds decompressed response bytes and reports unread limits separately from mismatch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x".repeat(524289)));
    const result = await performAdvancedHttpCheck(monitor({ httpAssertions: [{ type: "body_not_contains", value: "bad" }] }));
    expect(result.status).toBe("down");
    expect(result).toHaveProperty("assertionOutcomes.0.reason", "response_limit");
  });
  it("keeps timeout active through body reads", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => new Response(new ReadableStream({ start(controller) { init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true }); } })));
    const result = await performAdvancedHttpCheck(monitor({ timeout: 25, httpAssertions: [{ type: "json", path: "$", op: "exists" }] }));
    expect(result.status).toBe("down");
    expect(result.errorMessage).toBe("response_timeout");
  });
  it("honors manual redirects while filtering every advanced request destination", async () => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "false");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }));
    const result = await performAdvancedHttpCheck(monitor({ url: "http://8.8.8.8/", expectedStatus: 302, redirectPolicy: "manual" }));
    expect(result.status).toBe("up");
    expect(fetch).toHaveBeenCalledTimes(1);
    const blocked = await performAdvancedHttpCheck(monitor({ url: "http://8.8.8.8/", httpAssertions: [{ type: "header_contains", name: "X-Ready", value: "yes" }] }));
    expect(blocked.status).toBe("down");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(blocked.errorMessage).not.toContain("127.0.0.1");
  });
  it("allows LAN monitoring by OSS default and always blocks metadata and link-local destinations", async () => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "");
    vi.stubEnv("BLOCK_PRIVATE_TARGETS", "");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ready"));
    expect((await performAdvancedHttpCheck(monitor({ url: "http://127.0.0.1/health", httpAssertions: [{ type: "body_contains", value: "ready" }] }))).status).toBe("up");
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const url of ["http://169.254.169.254/latest/meta-data/", "http://169.254.1.1/", "http://[fe80::1]/"]) {
      const result = await performAdvancedHttpCheck(monitor({ url }));
      expect(result).toMatchObject({ status: "down", httpStatus: null, responseTime: null, errorMessage: "blocked_target" });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("evaluates permitted status ranges and every rule against one response", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"ready":true}', { status: 201, headers: { "x-ready": "yes" } }));
    const result = await performAdvancedHttpCheck(monitor({ expectedStatuses: "200-299", httpAssertions: [{ type: "header_equals", name: "X-Ready", value: "yes" }, { type: "json", path: "$.ready", op: "equals", value: true }] }));
    expect(result).toMatchObject({ status: "up", httpStatus: 201, assertionOutcomes: [{ index: 0, passed: true, reason: "pass" }, { index: 1, passed: true, reason: "pass" }] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects configured redirects without following or leaking their destination", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://1.1.1.1/private?token=fixture-secret" } }));
    const result = await performAdvancedHttpCheck(monitor({ redirectPolicy: "error" }));
    expect(result).toMatchObject({ status: "down", httpStatus: 302, errorMessage: "redirect_rejected" });
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid encrypted requests before making any outbound request", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await performAdvancedHttpCheck(monitor({ requestCipher: encrypt(JSON.stringify({ headers: [{ name: "Host", value: "fixture-secret" }] })) }));
    expect(result).toMatchObject({ status: "down", httpStatus: null, responseTime: null, errorMessage: "invalid_configuration" });
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(fetch).not.toHaveBeenCalled();
  });
});
