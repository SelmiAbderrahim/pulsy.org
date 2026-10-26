import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { updateUptimeMonitor } from "../monitor-service";
import { executeCheck } from "../scheduler-service";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeMonitor, apiCreateUptimeMonitor } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "../../../lib/crypto";
import { getTranslator } from "../../../lib/i18n";
import { assertCredentialOrigin, httpConfigPatch, maskMonitor, toOwnerMonitor } from "../http-config";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";

vi.mock("../scheduler-service", async () => {
  const actual = await vi.importActual<typeof import("../scheduler-service")>("../scheduler-service");
  return { ...actual, scheduleMonitorCheck: vi.fn(), cancelMonitorCheck: vi.fn(), rescheduleMonitorCheck: vi.fn(), initializeAllMonitors: vi.fn(), shutdownScheduler: vi.fn() };
});
useCleanDatabase();
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const advanced = { name: "API fixture", url: "https://fixture.invalid/health", active: false, method: "POST" as const, requestConfig: { headers: [{ name: "X-Private", value: "fixture-header" }], body: '{"private":"fixture-body"}', contentType: "application/json", auth: { type: "bearer" as const, token: "fixture-token" } }, httpAssertions: [{ type: "json" as const, path: "$.status", op: "equals" as const, value: "ok" }] };

describe("HTTP configuration secrets", () => {
  const t = getTranslator("en");

  it("retains omitted ciphertext, replaces the complete request, and clears explicitly", () => {
    const original = encrypt(JSON.stringify(advanced.requestConfig));
    expect(httpConfigPatch({}, "POST", t, original)).toEqual({});
    expect(httpConfigPatch({ requestConfig: null }, "GET", t, original)).toEqual({ requestCipher: null });
    const patch = httpConfigPatch({ requestConfig: { headers: [{ name: "X-New", value: "replacement-value" }] } }, "GET", t, original);
    expect(patch.requestCipher).toEqual(expect.any(String));
    expect(patch.requestCipher).not.toContain("replacement-value");
    expect(JSON.parse(decrypt(patch.requestCipher!))).toEqual({ headers: [{ name: "X-New", value: "replacement-value" }] });
  });

  it("rejects a non-POST method when an omitted configuration retains a body", () => {
    const cipher = encrypt(JSON.stringify(advanced.requestConfig));
    for (const method of ["GET", "HEAD"]) {
      expect(() => httpConfigPatch({}, method, t, cipher)).toThrow(t("errors.httpBodyMethod"));
      expect(() => httpConfigPatch({ requestConfig: advanced.requestConfig }, method, t)).toThrow(t("errors.httpBodyMethod"));
    }
    expect(httpConfigPatch({ requestConfig: null }, "HEAD", t, cipher)).toEqual({ requestCipher: null });
  });

  it("requires replacement or clearing before credentials move to a different origin", () => {
    const cipher = encrypt(JSON.stringify(advanced.requestConfig));
    expect(() => assertCredentialOrigin(cipher, "https://example.com/a", "https://example.com/b", undefined, t)).not.toThrow();
    for (const target of ["https://other.example/a", "http://example.com/a", "https://example.com:8443/a"]) {
      expect(() => assertCredentialOrigin(cipher, "https://example.com/a", target, undefined, t)).toThrow(t("errors.httpCredentialOrigin"));
      expect(() => assertCredentialOrigin(cipher, "https://example.com/a", target, null, t)).not.toThrow();
      expect(() => assertCredentialOrigin(cipher, "https://example.com/a", target, advanced.requestConfig, t)).not.toThrow();
    }
  });

  it("exposes only a configured flag for stored secrets", () => {
    const cipher = encrypt(JSON.stringify(advanced.requestConfig));
    expect(maskMonitor({ name: "Fixture", requestCipher: cipher })).toEqual({ name: "Fixture", requestConfigured: true });
    expect(maskMonitor({ name: "Fixture", requestCipher: null })).toEqual({ name: "Fixture", requestConfigured: false });
  });
});

describe("persisted advanced configuration", () => {
  it("encrypts values, never projects ciphertext, preserves omitted secrets, and clears only explicitly", async () => {
    const user = await createTestUser(); const caller = authedCaller(user);
    const created = await caller.uptimeMonitor.monitor.create(advanced);
    const stored = await db.query.uptimeMonitor.findFirst({ where: eq(uptimeMonitor.uptimeMonitorId, created.uptimeMonitorId) });
    expect(stored?.requestCipher).toBeTruthy();
    expect(stored?.requestCipher).not.toContain("fixture-token");
    expect(JSON.parse(decrypt(stored!.requestCipher!))).toMatchObject(advanced.requestConfig);
    if (!stored) throw new Error("Missing stored monitor");
    const projected = toOwnerMonitor(stored);
    expect(projected).not.toHaveProperty("requestCipher");
    expect(projected).not.toHaveProperty("userId");
    expect(projected).not.toHaveProperty("notificationOutageId");
    expect(projected).toHaveProperty("requestConfigured", true);
    expect(JSON.stringify(projected)).not.toMatch(/fixture-(token|header|body)/);
    expect(created).not.toHaveProperty("requestCipher");
    expect(created).toHaveProperty("requestConfigured", true);
    const edited = await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: created.uptimeMonitorId, name: "Renamed" });
    const list = await caller.uptimeMonitor.monitor.list(); const detail = await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: created.uptimeMonitorId });
    for (const value of [edited, list, detail]) {
      expect(JSON.stringify(value)).not.toMatch(/fixture-(token|header|body)/);
      expect(JSON.stringify(value)).not.toContain(stored!.requestCipher!);
    }
    const unchanged = await db.query.uptimeMonitor.findFirst({ where: eq(uptimeMonitor.uptimeMonitorId, created.uptimeMonitorId) });
    expect(unchanged?.requestCipher).toBe(stored?.requestCipher);
    const replacement = { headers: [{ name: "X-New", value: "replacement-value" }], body: "replacement-body", contentType: "text/plain" };
    const replaced = await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: created.uptimeMonitorId, requestConfig: replacement });
    const afterReplacement = await db.query.uptimeMonitor.findFirst({ where: eq(uptimeMonitor.uptimeMonitorId, created.uptimeMonitorId) });
    expect(JSON.parse(decrypt(afterReplacement!.requestCipher!))).toEqual(replacement);
    expect(afterReplacement?.requestCipher).not.toBe(stored?.requestCipher);
    expect(JSON.stringify(replaced)).not.toMatch(/replacement-(value|body)/);
    await caller.uptimeMonitor.monitor.update({ uptimeMonitorId: created.uptimeMonitorId, requestConfig: null });
    expect((await db.query.uptimeMonitor.findFirst({ where: eq(uptimeMonitor.uptimeMonitorId, created.uptimeMonitorId) }))?.requestCipher).toBeNull();
  });
  it("persists-to-manual worker, keeps secrets out of incidents/logs, and rejects foreign edits", async () => {
    const user = await createTestUser(); const other = await createTestUser(); const caller = authedCaller(user);
    const created = await caller.uptimeMonitor.monitor.create({ ...advanced, active: true, failureThreshold: 1 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"status":"error","private":"fixture-response"}'));
    const checked = await caller.uptimeMonitor.monitor.checkNow({ uptimeMonitorId: created.uptimeMonitorId });
    expect(checked.status).toBe("down");
    const detail = await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: created.uptimeMonitorId });
    expect(await caller.uptimeMonitor.incident.list({ uptimeMonitorId: created.uptimeMonitorId })).toHaveLength(1);
    const logs = await caller.uptimeMonitor.checkLog.list({ uptimeMonitorId: created.uptimeMonitorId });
    expect(JSON.stringify([checked, detail, logs])).not.toMatch(/fixture-(token|header|body|response)/);
    await expect(authedCaller(other).uptimeMonitor.monitor.update({ uptimeMonitorId: created.uptimeMonitorId, name: "Foreign" })).rejects.toThrow();
  });
  it("tests only by explicit action, requires POST confirmation, and leaves history untouched", async () => {
    const owner = await createTestUser(); const stranger = await createTestUser(); const caller = authedCaller(owner);
    const created = await caller.uptimeMonitor.monitor.create(advanced);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"status":"ok"}'));
    expect(fetch).not.toHaveBeenCalled();
    await expect(caller.uptimeMonitor.monitor.testConfiguration({ uptimeMonitorId: created.uptimeMonitorId, configuration: advanced })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    const result = await caller.uptimeMonitor.monitor.testConfiguration({ uptimeMonitorId: created.uptimeMonitorId, configuration: { ...advanced, requestConfig: undefined }, allowPost: true });
    expect(result.status).toBe("up"); expect(fetch).toHaveBeenCalledTimes(1);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer fixture-token");
    expect((await caller.uptimeMonitor.checkLog.list({ uptimeMonitorId: created.uptimeMonitorId })).data).toHaveLength(0);
    await expect(authedCaller(stranger).uptimeMonitor.monitor.testConfiguration({ uptimeMonitorId: created.uptimeMonitorId, configuration: advanced, allowPost: true })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("executes persisted settings through the scheduled worker against a real local compressed response", async () => {
    let requests = 0; let receivedAuth = ""; let receivedBody = "";
    const sink = createServer(async (request, response) => {
      requests++; receivedAuth = request.headers.authorization ?? "";
      for await (const chunk of request) receivedBody += String(chunk);
      response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      response.end(gzipSync('{"status":"error","private":"fixture-response"}'));
    });
    await new Promise<void>(resolve => sink.listen(0, "127.0.0.1", resolve));
    try {
      const address = sink.address(); if (!address || typeof address === "string") throw new Error("Missing fixture address");
      const owner = await createTestUser(); const caller = authedCaller(owner);
      const created = await caller.uptimeMonitor.monitor.create({ ...advanced, url: `http://127.0.0.1:${address.port}/health`, failureThreshold: 1, active: true });
      await executeCheck(created.uptimeMonitorId);
      expect(requests).toBe(1); expect(receivedAuth).toBe("Bearer fixture-token"); expect(receivedBody).toBe(advanced.requestConfig.body);
      const detail = await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: created.uptimeMonitorId });
      const history = await caller.uptimeMonitor.checkLog.list({ uptimeMonitorId: created.uptimeMonitorId });
      expect(detail.status).toBe("down"); expect(await caller.uptimeMonitor.incident.list({ uptimeMonitorId: created.uptimeMonitorId })).toHaveLength(1);
      expect(history.data[0]?.assertionOutcomes).toEqual([{ index: 0, passed: false, reason: "mismatch" }]);
      expect(JSON.stringify([detail, history])).not.toMatch(/fixture-(token|header|body|response)/);
    } finally { sink.closeAllConnections(); await new Promise<void>((resolve, reject) => sink.close(error => error ? reject(error) : resolve())); }
  });
  it("reports incompatible bulk methods per item without changing the rejected monitor", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    const post = await caller.uptimeMonitor.monitor.create(advanced);
    const get = await caller.uptimeMonitor.monitor.create({ name: "GET", url: "https://fixture.invalid", active: false });
    const result = await caller.uptimeMonitor.monitor.updateBulk({ monitorIds: [post.uptimeMonitorId, get.uptimeMonitorId], patch: { method: "HEAD" } });
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({id:post.uptimeMonitorId,status:"rejected",reason:expect.any(String)}),
      {id:get.uptimeMonitorId,status:"updated"},
    ]));
    expect((await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: post.uptimeMonitorId })).method).toBe("POST");
    expect((await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: get.uptimeMonitorId })).method).toBe("HEAD");
  });
  it("serializes concurrent method and encrypted body edits and rejects direct foreign updates", async () => {
    const owner = await createTestUser(); const other = await createTestUser(); const caller = authedCaller(owner);
    for (const method of ["GET", "HEAD"] as const) {
      const created = await caller.uptimeMonitor.monitor.create({ name: "Concurrent", url: `https://fixture.invalid/${method.toLowerCase()}`, method: "POST", active: false });
      const results = await Promise.allSettled([
        caller.uptimeMonitor.monitor.update({ uptimeMonitorId: created.uptimeMonitorId, requestConfig: advanced.requestConfig }),
        caller.uptimeMonitor.monitor.update({ uptimeMonitorId: created.uptimeMonitorId, method }),
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const stored = await db.query.uptimeMonitor.findFirst({ where: eq(uptimeMonitor.uptimeMonitorId, created.uptimeMonitorId) });
      expect(stored?.method).toBe(stored?.requestCipher ? "POST" : method);
      await expect(updateUptimeMonitor({ uptimeMonitorId: created.uptimeMonitorId, requestConfig: null }, other.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
  it("tests legacy default configurations through the same checker used after saving", async () => {
    const owner = await createTestUser(); const caller = authedCaller(owner);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const result = await caller.uptimeMonitor.monitor.testConfiguration({ configuration: { name: "Default", url: "https://fixture.invalid" } });
    expect(result.status).toBe("degraded");
  });
  it("rejects dangerous request headers, credential URLs, excess body bytes and invalid rule values", () => {
    for (const patch of [
      { url: "https://user:secret@example.com/" },
      { requestConfig: { headers: [{ name: "Host", value: "private" }] } },
      { requestConfig: { headers: [{ name: "X-Test", value: "ok\r\nAuthorization: unsafe" }] } },
      { requestConfig: { headers: [], body: "é".repeat(32769) } },
      { requestConfig: { headers: [], contentType: "application/json", body: "not JSON" } },
      { httpAssertions: [{ type: "json", path: "$.count", op: "lt", value: "9" }] },
    ]) expect(apiCreateUptimeMonitor.safeParse({ ...advanced, ...patch }).success).toBe(false);
  });
});
