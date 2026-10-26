import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestUser, useCleanDatabase } from "../../test/db";
import { createHeartbeatForUser, rotateHeartbeatToken, receiveHeartbeat } from "../services/uptime/heartbeat-service";
import { getTranslator } from "../lib/i18n";
import { createHeartbeatRouter } from "./heartbeat-route";
vi.mock("../services/uptime/heartbeat-service", async importActual => {
  const actual = await importActual<typeof import("../services/uptime/heartbeat-service")>();
  return { ...actual, receiveHeartbeat: vi.fn(actual.receiveHeartbeat) };
});
useCleanDatabase();
const servers: Array<ReturnType<ReturnType<typeof express>["listen"]>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(receiveHeartbeat).mockReset();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
async function app() {
  const application = express();
  application.set("trust proxy", 1);
  application.use("/api/heartbeat", createHeartbeatRouter());
  const server = application.listen(0, "127.0.0.1"); servers.push(server);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing heartbeat fixture address");
  return `http://127.0.0.1:${address.port}/api/heartbeat`;
}
describe("dedicated heartbeat HTTP ingress", () => {
  it("accepts copied capability URLs for start, fail and success without reflecting credentials", async () => {
    const owner = await createTestUser();
    const heartbeat = await createHeartbeatForUser({ name: "URL job", interval: 300, graceSeconds: 30, active: true, tags: [] }, owner.id, getTranslator("en"));
    const origin = await app();
    for (const event of ["start", "fail", "success"]) {
      const response = await fetch(`${origin}/${heartbeat.token}/${event}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toContain(heartbeat.token);
    }
  });
  it("records a ping from the documented snippet: no body and no content type, for GET, HEAD and POST", async () => {
    const owner = await createTestUser();
    const heartbeat = await createHeartbeatForUser({ name: "Cron job", interval: 300, graceSeconds: 60, active: true, tags: [] }, owner.id, getTranslator("en"));
    const url = `${await app()}/${heartbeat.token}/success`;
    // Shape of `curl -fsS -m 10 --retry 3 "<ping url>"`: a bare GET.
    const get = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ outcome: "accepted" });
    expect((await fetch(url, { method: "HEAD" })).status).toBe(200);
    expect((await fetch(url, { method: "POST" })).status).toBe(200);
    // curl -d '{}' without -H sends form encoding; plain text bodies are accepted too.
    expect((await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "{}" })).status).toBe(200);
    expect((await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "done" })).status).toBe(200);
    expect((await fetch(url, { method: "PUT" })).status).toBe(405);
    expect((await fetch(`${url.replace(heartbeat.token, "x".repeat(43))}`)).status).toBe(404);
  });
  it("accepts an actual header-scoped start/success pair and never returns the token", async () => {
    const owner = await createTestUser(); const heartbeat = await createHeartbeatForUser({ name: "Job", interval: 300, graceSeconds: 30, active: true, tags: [] }, owner.id, getTranslator("en")); const origin = await app();
    const headers = { Authorization: `Bearer ${heartbeat.token}`, "Content-Type": "application/json" };
    const started = await fetch(origin + "/start", { method: "POST", headers, body: JSON.stringify({ runId: "job-1" }) });
    expect(started.status).toBe(200); expect(started.headers.get("cache-control")).toBe("no-store");
    expect(await started.json()).toEqual({ outcome: "accepted", runId: "job-1" });
    const finished = await fetch(origin + "/success", { method: "POST", headers, body: JSON.stringify({ runId: "job-1" }) });
    expect(finished.status).toBe(200); expect(await finished.text()).not.toContain(heartbeat.token);
  });
  it("rejects unknown secrets, malformed/oversized JSON, raw logs, unsupported events and URL tokens safely", async () => {
    const owner = await createTestUser(); const heartbeat = await createHeartbeatForUser({ name: "Job", interval: 300, graceSeconds: 0, active: true, tags: [] }, owner.id, getTranslator("en")); const origin = await app();
    const post = (path: string, body: string, token = heartbeat.token) => fetch(origin + path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body });
    expect((await post("/success", "{}", "x".repeat(43))).status).toBe(404);
    for (const [body, code] of [["{", 400], [JSON.stringify({ log: "private log" }), 400], [JSON.stringify({ metadata: { environment: "a".repeat(11_000) } }), 413]] as const) {
      const res = await post("/success", body); expect(res.status).toBe(code); const text = await res.text(); expect(text).not.toContain(heartbeat.token); expect(text).not.toContain("private log");
    }
    expect((await post("/other", "{}")).status).toBe(404);
    expect((await post("/success?token=" + heartbeat.token, "{}")).status).toBe(400);
    expect((await fetch(origin + "/success", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(404);
  });
  it("answers unknown, rotated and wrongly-routed tokens with one identical 404 for every verb and auth form", async () => {
    const owner = await createTestUser(); const t = getTranslator("en");
    const heartbeat = await createHeartbeatForUser({ name: "Rotating", interval: 300, graceSeconds: 30, active: true, tags: [] }, owner.id, t); const origin = await app();
    const oldToken = heartbeat.token;
    expect((await fetch(`${origin}/${oldToken}/success`)).status).toBe(200);
    const rotated = await rotateHeartbeatToken(heartbeat.monitor.uptimeMonitorId, owner.id, t);
    expect(rotated.token).not.toBe(oldToken);
    const unknownToken = "y".repeat(43);
    const seen = new Set<string>();
    for (const token of [oldToken, unknownToken, "short", "invalid!".repeat(6)]) {
      for (const method of ["GET", "HEAD", "POST"]) {
        const res = await fetch(`${origin}/${token}/success`, { method });
        expect(res.status, `${method} ${token === oldToken ? "rotated" : "unknown"}`).toBe(404);
        if (method !== "HEAD") seen.add(await res.text());
      }
      const bearer = await fetch(`${origin}/success`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      expect(bearer.status).toBe(404);
      seen.add(await bearer.text());
    }
    expect(seen.size).toBe(1);
    expect([...seen][0]).not.toContain(oldToken);
    expect((await fetch(`${origin}/${rotated.token}/success`)).status).toBe(200);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("bounded heartbeat ingress", () => {
  it("rejects ambiguous credentials, malformed JSON shapes and compressed bodies without reflecting input", async () => {
    const owner = await createTestUser();
    const heartbeat = await createHeartbeatForUser({ name: "Abuse fixture", interval: 300, graceSeconds: 30, active: true, tags: [] }, owner.id, getTranslator("en"));
    const origin = await app();
    const url = `${origin}/${heartbeat.token}/success`;
    for (const [body, extra] of [
      ["[]", {}], ["null", {}], ['"private-receipt"', {}],
      [JSON.stringify({ log: "private-receipt" }), {}],
      ["{}", { "Content-Encoding": "gzip" }],
      ["{}", { Authorization: `Bearer ${heartbeat.token}` }],
    ] as const) {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...extra }, body });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ outcome: "invalid" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const oversized = await fetch(url, { method: "POST", body: "x".repeat(10 * 1024 + 1) });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ outcome: "invalid" });
    for (const authorization of ["Bearer short", "Basic private-receipt", `bearer ${heartbeat.token}`]) {
      const response = await fetch(`${origin}/success`, { headers: { Authorization: authorization } });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ outcome: "unavailable" });
    }
    const unsupported = await fetch(url, { method: "PATCH" });
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("GET, HEAD, POST");
    expect(await unsupported.json()).toEqual({ outcome: "invalid" });
  });

  it("shapes service results explicitly and returns bounded errors without logging secrets", async () => {
    const origin = await app();
    const token = "k".repeat(43);
    const internal = { statusCode: 200 as const, outcome: "accepted" as const, runId: "public-run", token, tokenCipher: "private-cipher", userId: "private-owner" };
    vi.mocked(receiveHeartbeat).mockResolvedValueOnce(internal);
    const accepted = await fetch(`${origin}/${token}/start`);
    expect(await accepted.json()).toEqual({ outcome: "accepted", runId: "public-run" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(receiveHeartbeat).mockRejectedValueOnce(new Error(`Private database ${token} private-receipt`));
    const failed = await fetch(`${origin}/${token}/success`);
    expect(failed.status).toBe(503);
    expect(failed.headers.get("retry-after")).toBe("1");
    expect(await failed.json()).toEqual({ outcome: "unavailable" });
    expect(JSON.stringify([error.mock.calls, warn.mock.calls, log.mock.calls])).not.toMatch(/private-receipt|Private database|kkkkkkkk/);
    vi.mocked(receiveHeartbeat).mockResolvedValueOnce({ statusCode: 429, outcome: "limited" });
    const limited = await fetch(`${origin}/${token}/success`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(await limited.json()).toEqual({ outcome: "limited" });
  });

  it("accepts 1,200 requests per IPv6 /64 before limiting the next address in that network", async () => {
    const origin = await app();
    for (let batch = 0; batch < 1200; batch += 50) {
      const responses = await Promise.all(Array.from({ length: 50 }, (_, offset) => fetch(`${origin}/unknown-event`, { headers: { "X-Forwarded-For": `2001:db8:abcd:1::${(batch + offset + 1).toString(16)}` } })));
      expect(responses.every(response => response.status === 404)).toBe(true);
      await Promise.all(responses.map(response => response.arrayBuffer()));
    }
    const limited = await fetch(`${origin}/unknown-event`, { headers: { "X-Forwarded-For": "2001:db8:abcd:1::ffff" } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(await limited.json()).toEqual({ outcome: "limited" });
    const otherNetwork = await fetch(`${origin}/unknown-event`, { headers: { "X-Forwarded-For": "2001:db8:abcd:2::1" } });
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
        return fetch(`${origin}/unknown-event`, { headers: { "X-Forwarded-For": `198.18.${Math.floor(ip / 256)}.${ip % 256}` } });
      }));
      expect(responses.every(response => response.status === 404)).toBe(true);
      await Promise.all(responses.map(response => response.arrayBuffer()));
    }
    const overflowHeaders = { "X-Forwarded-For": "203.0.113.42" };
    const overflow = await fetch(`${origin}/unknown-event`, { headers: overflowHeaders });
    expect(overflow.status).toBe(429);
    expect(await overflow.json()).toEqual({ outcome: "limited" });
    now += 60_001;
    const fresh = await fetch(`${origin}/unknown-event`, { headers: overflowHeaders });
    expect(fresh.status).toBe(404);
    await fresh.arrayBuffer();
  });

  it("bounds total pre-auth traffic to 12,000 requests per minute across clients", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    const origin = await app();
    for (let batch = 0; batch < 12_000; batch += 100) {
      const responses = await Promise.all(Array.from({ length: 100 }, (_, offset) => fetch(`${origin}/unknown-event`, { headers: { "X-Forwarded-For": `198.51.100.${(batch + offset) % 100 + 1}` } })));
      expect(responses.every(response => response.status === 404)).toBe(true);
      await Promise.all(responses.map(response => response.arrayBuffer()));
    }
    const limited = await fetch(`${origin}/unknown-event`, { headers: { "X-Forwarded-For": "203.0.113.99" } });
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
    vi.mocked(receiveHeartbeat).mockImplementation(async () => {
      if (++active === 16) entered.resolve();
      await release.promise;
      return { statusCode: 200, outcome: "accepted" };
    });
    const pending = Array.from({ length: 16 }, () => fetch(`${origin}/${token}/success`));
    await entered.promise;
    try {
      const busy = await fetch(`${origin}/${token}/success`);
      expect(busy.status).toBe(503);
      expect(busy.headers.get("retry-after")).toBe("1");
      expect(await busy.json()).toEqual({ outcome: "busy" });
    } finally {
      release.resolve();
      const finished = await Promise.all(pending);
      expect(finished.every(response => response.status === 200)).toBe(true);
      await Promise.all(finished.map(response => response.arrayBuffer()));
    }
    const fresh = await fetch(`${origin}/${token}/success`);
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toEqual({ outcome: "accepted" });
  });
});
