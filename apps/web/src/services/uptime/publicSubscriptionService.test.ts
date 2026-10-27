import { afterEach, expect, it, vi } from "vitest";
import { PublicSubscriptionService } from "./publicSubscriptionService";

afterEach(() => vi.unstubAllGlobals());
it("redeems capabilities only in a bounded POST body without cookies or referrers", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetcher);
  const token = "x".repeat(43);
  await PublicSubscriptionService.redeem("page-key", { action: "unsubscribe", token, path: "/status/owner/page" });
  const [url, request] = fetcher.mock.calls[0]!;
  expect(url).toMatch(/\/api\/status\/pages\/page-key\/subscription$/);
  expect(url).not.toContain(token);
  expect(request).toEqual(expect.objectContaining({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer", signal: expect.any(AbortSignal) }));
  expect(JSON.parse(request.body)).toEqual({ action: "unsubscribe", token });
});
it("returns a generic error for a failed subscription response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  await expect(PublicSubscriptionService.request("missing", { email: "person@example.test", componentIds: [], language: "ar" })).rejects.toThrow("Subscription request unavailable");
});
