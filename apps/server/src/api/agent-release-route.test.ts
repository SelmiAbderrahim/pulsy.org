import express from "express";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentReleaseRouter } from "./agent-release-route";

const fixtures: Array<{ server: ReturnType<ReturnType<typeof express>["listen"]>; directory: string }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) {
    fixture.server.closeAllConnections();
    await new Promise<void>(resolve => fixture.server.close(() => resolve()));
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "pulsy-release-test-"));
  for (const filename of ["install.sh", "compose.yaml", "SHA256SUMS", "pulsy-agent-linux-amd64", "pulsy-agent-linux-arm64", "private.txt", ".hidden"]) {
    await writeFile(join(directory, filename), `fixture:${filename}`);
  }
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api/agent/releases/v1.0.0", createAgentReleaseRouter(directory));
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  fixtures.push({ server, directory });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent/releases/v1.0.0`;
}
describe("versioned public agent artifacts", () => {
  it("serves only the five built release files with immutable caching and HEAD support", async () => {
    const origin = await fixture();
    for (const filename of ["install.sh", "compose.yaml", "SHA256SUMS", "pulsy-agent-linux-amd64", "pulsy-agent-linux-arm64"]) {
      const response = await fetch(`${origin}/${filename}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toMatch(/max-age=31536000.*immutable/);
      expect(await response.text()).toBe(`fixture:${filename}`);
    }
    const head = await fetch(`${origin}/install.sh`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const post = await fetch(`${origin}/install.sh`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });
  it("never exposes extra files, directory indexes, encoded paths or query-bearing requests", async () => {
    const origin = await fixture();
    const bodies = new Set<string>();
    for (const path of ["/", "/private.txt", "/.hidden", "/missing", "/install.sh?token=fixture-secret", "/..%2Fprivate.txt", "/install%2esh"]) {
      const response = await fetch(origin + path);
      expect(response.status, path).toBe(404);
      bodies.add(await response.text());
    }
    expect([...bodies]).toEqual([JSON.stringify({ outcome: "unavailable" })]);
  });
  it("limits unauthenticated downloads by IPv6 /64 and reopens the window", async () => {
    const origin = await fixture();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    for (let request = 0; request < 240; request++) {
      expect((await fetch(`${origin}/install.sh`, { headers: { "X-Forwarded-For": `2001:4860:abcd:1234::${request + 1}` } })).status).toBe(200);
    }
    const limited = await fetch(`${origin}/install.sh`, { headers: { "X-Forwarded-For": "2001:4860:abcd:1234::ffff" } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(await limited.json()).toEqual({ outcome: "limited" });
    now += 60_001;
    expect((await fetch(`${origin}/install.sh`, { headers: { "X-Forwarded-For": "2001:4860:abcd:1234::ffff" } })).status).toBe(200);
  });
});
