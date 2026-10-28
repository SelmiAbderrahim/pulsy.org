import { afterEach, describe, expect, it, vi } from "vitest";
import { captureSubscriptionCapability, readSubscriptionCapability, clearSubscriptionCapability } from "./public-subscription-capability";
afterEach(() => { clearSubscriptionCapability(); vi.unstubAllEnvs(); vi.resetModules(); window.history.replaceState({}, "", "/"); });
describe("subscription capability privacy", () => {
  it("removes a fragment before router initialization and keeps only an in-memory path-bound capability", () => {
    const token = "a".repeat(43); window.history.replaceState({}, "", `/status/owner/customer?lng=ar#subscription=confirm%3A${token}`);
    captureSubscriptionCapability(); expect(window.location.hash).toBe("");
    expect(readSubscriptionCapability()).toEqual({ action: "confirm", token, path: "/status/owner/customer" });
    window.history.replaceState({}, "", "/status/owner/other"); expect(readSubscriptionCapability()).toBeNull();
    expect(window.localStorage.getItem("subscription")).toBeNull();
  });
});
