// Exercise the actual bootstrap: router-only tests cannot detect an earlier
// cookie-origin gate rejecting requests before the API-key router sees them.
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createApiKey } from "../services/api-keys/api-key-service";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../test/db";

useCleanDatabase();
const foreignOrigin = "https://api-client.example";
const trustedOrigin = "https://pulsy.example";
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null) continue;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
      child.kill("SIGTERM");
    });
  }
});

async function bootstrap(enabled = true) {
  // Observe the real listener's ephemeral port without replacing middleware,
  // route handlers, authentication, rate limiting or the HTTP transport.
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import express from 'express';
    const listen = express.application.listen;
    express.application.listen = function (...args) {
      const server = listen.apply(this, args);
      server.once('listening', () => process.send({ port: server.address().port }));
      return server;
    };
    await import('./src/index.ts');
  `], {
    env: { ...process.env, SERVER_PORT: "0", API_V1_ENABLED: String(enabled),
      PUBLIC_WEB_URL: trustedOrigin, BETTER_AUTH_URL: trustedOrigin,
      TRUSTED_ORIGINS: "", SUPERADMIN_EMAIL: "", SUPERADMIN_PASSWORD: "" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.push(child);
  let output = "";
  child.stdout?.on("data", chunk => { output += String(chunk); });
  child.stderr?.on("data", chunk => { output += String(chunk); });
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Bootstrap timed out: ${output}`)), 15000);
    child.once("message", message => {
      clearTimeout(timeout);
      if (typeof message === "object" && message !== null && "port" in message) {
        resolve(`http://127.0.0.1:${message.port}`);
      } else reject(new Error("Bootstrap did not publish its HTTP port"));
    });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Bootstrap exited (${code}): ${output}`)); });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
  });
}

function expectKeyCors(response: Response) {
  expect(response.headers.get("access-control-allow-origin")).toBe(foreignOrigin);
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  expect(response.headers.get("set-cookie")).toBeNull();
}

async function keyFixture() {
  const user = await createTestUser();
  const monitor = await createTestMonitor(user.id, { active: false });
  const { plaintext } = await createApiKey(user.id, "foreign-origin client", undefined, undefined, { scope: "read" });
  return { monitor, headers: { Origin: foreignOrigin, Authorization: `Bearer ${plaintext}` } };
}

describe("bootstrap keeps API-key CORS independent from cookie origins", () => {
  it("allows a foreign-origin Authorization preflight without allowing cookies", async () => {
    const base = await bootstrap();
    const response = await fetch(`${base}/api/v1/monitors`, { method: "OPTIONS", headers: {
      Origin: foreignOrigin, "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "Authorization,Content-Type,Accept-Language",
    } });
    expect(response.status).toBe(204);
    expectKeyCors(response);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET,POST,PATCH,DELETE,OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe("Authorization,Content-Type,Accept-Language");
  });

  it("reads only the Bearer owner's monitor from a foreign browser origin", async () => {
    const { monitor, headers } = await keyFixture();
    const foreign = await createTestMonitor((await createTestUser()).id, { active: false });
    const response = await fetch(`${await bootstrap()}/api/v1/monitors`, { headers });
    expect(response.status).toBe(200);
    expectKeyCors(response);
    const body = await response.json() as { data: Array<{ id: string }> };
    expect(body.data.map(row => row.id)).toEqual([monitor.uptimeMonitorId]);
    expect(body.data.map(row => row.id)).not.toContain(foreign.uptimeMonitorId);
  });

  it("returns a browser-readable 401 when no Bearer key is supplied", async () => {
    const response = await fetch(`${await bootstrap()}/api/v1/monitors`, { headers: { Origin: foreignOrigin, Cookie: "session=not-api-authority" } });
    expect(response.status).toBe(401);
    expectKeyCors(response);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("keeps malformed JSON errors inside the noncredentialed API CORS policy", async () => {
    const { headers } = await keyFixture();
    const response = await fetch(`${await bootstrap()}/api/v1/monitors`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{" });
    expect(response.status).toBe(400);
    expectKeyCors(response);
    expect(await response.json()).toMatchObject({ error: { code: "validation_error" } });
  });

  it("does not fall through to cookie CORS for unknown API-key routes", async () => {
    const { headers } = await keyFixture();
    const response = await fetch(`${await bootstrap()}/api/v1/not-a-route`, { headers });
    expect(response.status).toBe(404);
    expectKeyCors(response);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it.each(["/api/auth/get-session", "/api/trpc/uptimeMonitor.public.status", "/api/v10/monitors"])("still rejects foreign cookie origins at %s", async path => {
    const response = await fetch(`${await bootstrap()}${path}`, { headers: { Origin: foreignOrigin } });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toMatchObject({ error: { code: "origin_not_allowed" } });
  });

  it("keeps trusted session origins credentialed", async () => {
    const response = await fetch(`${await bootstrap()}/api/auth/get-session`, { method: "OPTIONS", headers: { Origin: trustedOrigin, "Access-Control-Request-Method": "GET" } });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(trustedOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it.each(["OPTIONS", "GET"])("does not bypass cookie CORS for disabled API %s", async method => {
    const response = await fetch(`${await bootstrap(false)}/api/v1/monitors`, { method, headers: { Origin: foreignOrigin, "Access-Control-Request-Method": "GET" } });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toMatchObject({ error: { code: "origin_not_allowed" } });
  });
});
