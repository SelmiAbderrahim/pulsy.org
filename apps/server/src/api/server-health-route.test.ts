import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestUser, useCleanDatabase } from "../../test/db";
import { authedCaller } from "../../test/trpc-caller";
import { createServerHealthRouter } from "./server-health-route";
import { receiveServerSample } from "../services/uptime/server-health-service";
vi.mock("../services/uptime/server-health-service", async importActual => {
  const actual = await importActual<typeof import("../services/uptime/server-health-service")>();
  return { ...actual, receiveServerSample: vi.fn(actual.receiveServerSample) };
});

useCleanDatabase();
const servers: Server[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.mocked(receiveServerSample).mockReset(); vi.unstubAllEnvs(); for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function app() {
  const application = express(); application.set("trust proxy", 1);
  application.use("/api/agent/v1", createServerHealthRouter());
  const server = application.listen(0, "127.0.0.1"); servers.push(server);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing metrics fixture address");
  return `http://127.0.0.1:${address.port}/api/agent/v1/metrics`;
}
describe("server-health HTTP boundary", () => {
  it("authenticates real requests and rejects malformed/oversized bodies without reflecting secrets", async () => {
    const owner = await createTestUser(), caller = authedCaller(owner);
    const created = await caller.uptimeMonitor.server.create({ name: "Host" }), url = await app();
    const body = { version: 1, bootId: "a811372b-61f5-444a-9cbe-9a1c651a8e49", sequence: 1, sampledAt: new Date().toISOString(), agent: { version: "1.0.0", arch: "amd64" }, cpuPercent: null, memoryPercent: 42, swapPercent: null, load: null, uptimeSeconds: 120, filesystems: [] };
    const post = (payload: string, token = created.token, target = url) => fetch(target, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: payload });
    for (const [payload, code] of [["{", 400], [JSON.stringify({ junk: "a".repeat(50000) }), 413], [JSON.stringify({ ...body, version: 2 }), 400]] as const) {
      const response = await post(payload); expect(response.status).toBe(code); expect(await response.text()).not.toContain(created.token);
    }
    expect((await post(JSON.stringify(body), "x".repeat(43))).status).toBe(401);
    expect((await post(JSON.stringify(body), created.token, url + "?token=forbidden")).status).toBe(400);
    const accepted = await post(JSON.stringify(body)); expect(accepted.status).toBe(200); expect(accepted.headers.get("cache-control")).toBe("no-store");
    expect(await accepted.json()).toMatchObject({ outcome: "accepted", interval: 60 });
    const rotated = await caller.uptimeMonitor.server.rotate({ monitorId: created.monitor.uptimeMonitorId });
    expect((await post(JSON.stringify(body))).status).toBe(401);
    expect((await post(JSON.stringify(body), rotated.token)).status).toBe(200);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("bounded server-health ingress", () => {
  it("requires exact Bearer credentials and JSON without query credentials or compression", async () => {
    const url = await app();
    for (const authorization of ["", "Bearer short", `bearer ${"k".repeat(43)}`, `Basic ${"k".repeat(43)}`]) {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: authorization }, body: "{}" });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ outcome: "unavailable" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    for (const [body, headers] of [
      ["{}", { "Content-Type": "text/plain" }],
      ["{}", { "Content-Type": "application/json", "Content-Encoding": "gzip" }],
      ["[1,2]", { "Content-Type": "application/json" }],
      ["null", { "Content-Type": "application/json" }],
    ] as const) {
      const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${"k".repeat(43)}`, ...headers }, body });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ outcome: "invalid" });
    }
    const absent = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${"k".repeat(43)}` } });
    expect(absent.status).toBe(400);
    expect(await absent.json()).toEqual({ outcome: "invalid" });
    const wrongPath = await fetch(url.replace("/metrics", `/${"k".repeat(43)}/metrics`));
    expect(wrongPath.status).toBe(404);
    expect(await wrongPath.json()).toEqual({ outcome: "unavailable" });
    const wrongVerb = await fetch(url);
    expect(wrongVerb.status).toBe(404);
    expect(await wrongVerb.json()).toEqual({ outcome: "unavailable" });
  });

  it("projects only audited sample-result fields and hides thrown service errors", async () => {
    const url = await app();
    const token = "k".repeat(43);
    const internal = { statusCode: 200, outcome: "accepted", interval: 60, excludedFilesystems: ["/backup"], userId: "private-owner", token, tokenCipher: "private-cipher", futureSecret: "private-secret" };
    vi.mocked(receiveServerSample).mockResolvedValueOnce(internal);
    const post = () => fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "accepted", interval: 60, excludedFilesystems: ["/backup"] });
    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    for (const log of logs) log.mockImplementation(() => {});
    vi.mocked(receiveServerSample).mockRejectedValueOnce(new Error(`private-secret ${token}`));
    const failed = await post();
    expect(failed.status).toBe(503);
    expect(failed.headers.get("retry-after")).toBe("1");
    expect(await failed.json()).toEqual({ outcome: "unavailable" });
    expect(JSON.stringify(logs.map(log => log.mock.calls))).not.toMatch(/private-secret|kkkkkkkk/);
    vi.mocked(receiveServerSample).mockResolvedValueOnce({ statusCode: 429, outcome: "limited", retryAfter: 12, interval: 60, excludedFilesystems: [] });
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("12");
    expect(await limited.json()).toEqual({ outcome: "limited", interval: 60, excludedFilesystems: [] });
  });

  it("accepts 1,200 requests per IPv6 /64 before limiting the next address in that network", async () => {
    const origin = await app();
    for (let batch = 0; batch < 1200; batch += 50) {
      const responses = await Promise.all(Array.from({ length: 50 }, (_, offset) => fetch(origin.replace("/metrics", "/unknown-event"), { headers: { "X-Forwarded-For": `2001:db8:abcd:1::${(batch + offset + 1).toString(16)}` } })));
      expect(responses.every(response => response.status === 404)).toBe(true);
      await Promise.all(responses.map(response => response.arrayBuffer()));
    }
    const limited = await fetch(origin.replace("/metrics", "/unknown-event"), { headers: { "X-Forwarded-For": "2001:db8:abcd:1::ffff" } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(await limited.json()).toEqual({ outcome: "limited" });
    const otherNetwork = await fetch(origin.replace("/metrics", "/unknown-event"), { headers: { "X-Forwarded-For": "2001:db8:abcd:2::1" } });
    expect(otherNetwork.status).toBe(404);
    await otherNetwork.arrayBuffer();
  });

  it("fails closed after 1,024 live IP buckets and reuses expired capacity", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const origin = await app();
    for (let batch = 0; batch < 1024; batch += 32) {
      const responses = await Promise.all(Array.from({ length: 32 }, (_, offset) => {
        const ip = batch + offset;
        return fetch(origin.replace("/metrics", "/unknown-event"), { headers: { "X-Forwarded-For": `198.18.${Math.floor(ip / 256)}.${ip % 256}` } });
      }));
      expect(responses.every(response => response.status === 404)).toBe(true);
      await Promise.all(responses.map(response => response.arrayBuffer()));
    }
    const overflowHeaders = { "X-Forwarded-For": "203.0.113.42" };
    const overflow = await fetch(origin.replace("/metrics", "/unknown-event"), { headers: overflowHeaders });
    expect(overflow.status).toBe(429);
    expect(await overflow.json()).toEqual({ outcome: "limited" });
    now += 60_001;
    const fresh = await fetch(origin.replace("/metrics", "/unknown-event"), { headers: overflowHeaders });
    expect(fresh.status).toBe(404);
    await fresh.arrayBuffer();
  });

  it("bounds total pre-auth traffic to 12,000 requests per minute across clients", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    const origin = await app();
    for (let batch = 0; batch < 12_000; batch += 100) {
      const responses = await Promise.all(Array.from({ length: 100 }, (_, offset) => fetch(origin.replace("/metrics", "/unknown-event"), { headers: { "X-Forwarded-For": `198.51.100.${(batch + offset) % 100 + 1}` } })));
      expect(responses.every(response => response.status === 404)).toBe(true);
      await Promise.all(responses.map(response => response.arrayBuffer()));
    }
    const limited = await fetch(origin.replace("/metrics", "/unknown-event"), { headers: { "X-Forwarded-For": "203.0.113.99" } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(await limited.json()).toEqual({ outcome: "limited" });
  }, 120_000);

  it("admits sixteen receipt transactions, rejects overflow, and releases finished slots", async () => {
    const origin = await app();
    const token = "k".repeat(43);
    const entered = deferred<void>();
    const release = deferred<void>();
    let active = 0;
    vi.mocked(receiveServerSample).mockImplementation(async () => {
      if (++active === 16) entered.resolve();
      await release.promise;
      return { statusCode: 200, outcome: "accepted" };
    });
    const pending = Array.from({ length: 16 }, () => fetch(origin, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" }));
    await entered.promise;
    try {
      const busy = await fetch(origin, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
      expect(busy.status).toBe(503);
      expect(busy.headers.get("retry-after")).toBe("1");
      expect(await busy.json()).toEqual({ outcome: "busy" });
    } finally {
      release.resolve();
      const finished = await Promise.all(pending);
      expect(finished.every(response => response.status === 200)).toBe(true);
      await Promise.all(finished.map(response => response.arrayBuffer()));
    }
    const fresh = await fetch(origin, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toEqual({ outcome: "accepted" });
  });
});
