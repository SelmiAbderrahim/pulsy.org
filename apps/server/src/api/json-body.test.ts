import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => vi.fn());
vi.mock("../auth/auth", () => ({ auth: { api: { getSession: session } } }));
import { createApiJsonParser } from "./json-body";
import { getTranslator } from "../lib/i18n";
let server: Server;
async function fixture() {
  const app = express(); app.use(createApiJsonParser());
  app.post("/api/trpc/:procedure", (req, res) => res.json({ textBytes: Buffer.byteLength(req.body?.text ?? "") }));
  app.post("/api/v1/configuration/preview", express.json({ limit: "1mb" }), (req, res) => res.json({ textBytes: Buffer.byteLength(req.body?.text ?? "") }));
  // Observe the existing small parser's error safely; no stack/input reflection.
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error && typeof error === "object" && "status" in error ? Number(error.status) : 500).json({ error: "rejected" }));
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture port"); return `http://127.0.0.1:${address.port}`;
}
beforeEach(() => { session.mockReset(); session.mockResolvedValue({ user: { id: "disposable" } }); });
afterEach(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
describe("bounded authenticated native configuration transport", () => {
  it("accepts bounded large component preview/apply bodies only after session authentication", async () => {
    const origin = await fixture(); const body = JSON.stringify({ text: "م".repeat(200000) });
    for (const procedure of ["componentsPreviewPost", "componentsApply"]) {
      const url = origin + "/api/trpc/uptimeMonitor.statusPage.communication." + procedure;
      const accepted = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      expect(accepted.status).toBe(200); expect(await accepted.json()).toEqual({ textBytes: 400000 });
      session.mockResolvedValueOnce(null);
      expect((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })).status).toBe(401);
      const oversized = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": "fr" }, body: JSON.stringify({ text: "x".repeat(1048576) }) });
      expect(oversized.status).toBe(413);
      expect(await oversized.json()).toMatchObject({ error: { message: getTranslator("fr")("errors.statusPageCommunicationInvalid") } });
    }
  });
  it("accepts the advertised manifest envelope on UI paths while other tRPC remains bounded at its old limit", async () => {
    const origin = await fixture(); const body = JSON.stringify({ text: "x".repeat(157605) });
    const accepted = await fetch(origin + "/api/trpc/uptimeMonitor.portability.preview", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    expect(accepted.status).toBe(200); expect(await accepted.json()).toEqual({ textBytes: 157605 }); expect(session).toHaveBeenCalledTimes(1);
    const rejected = await fetch(origin + "/api/trpc/uptimeMonitor.monitor.create", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    expect(rejected.status).toBe(413); expect(session).toHaveBeenCalledTimes(1);
  });
  it("rejects unauthenticated malformed bodies before parsing and never reflects private source text", async () => {
    session.mockResolvedValue(null); const origin = await fixture();
    const response = await fetch(origin + "/api/trpc/uptimeMonitor.portability.reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"private-secret"' });
    expect(response.status).toBe(401); expect(await response.text()).not.toContain("private-secret");
  });
  it("bounds authenticated bytes, refuses compression and gives safe localized malformed-input errors", async () => {
    const origin = await fixture();
    for (const [body, headers, expectedStatus] of [
      [JSON.stringify({ text: "x".repeat(1048576) }), {}, 413],
      ['{"private-secret"', {}, 400],
      [JSON.stringify({ text: "small" }), { "Content-Encoding": "gzip" }, 415],
    ] as const) {
      const response = await fetch(origin + "/api/trpc/uptimeMonitor.portability.preview", { method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": "ar", ...headers }, body });
      expect(response.status).toBe(expectedStatus); expect(await response.json()).toMatchObject({ error: { message: getTranslator("ar")("errors.manifestInvalid") } });
    }
  });
  it("leaves REST manifest authentication and its own parser to the existing API router", async () => {
    const origin = await fixture();
    const response = await fetch(origin + "/api/v1/configuration/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x".repeat(157605) }) });
    expect(response.status).toBe(200); expect(session).not.toHaveBeenCalled();
  });
});
