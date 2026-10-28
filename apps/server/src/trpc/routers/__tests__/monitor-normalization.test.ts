import { describe, expect, it } from "vitest";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
useCleanDatabase();
describe("canonical personal monitor addresses", () => {
  it("normalizes bare hosts, derives names, and rejects owned and batch duplicates atomically", async () => {
    const owner = authedCaller(await createTestUser()), other = authedCaller(await createTestUser());
    const monitor = await owner.uptimeMonitor.monitor.create({ url: "example.com/health", active: false });
    expect(monitor).toMatchObject({ url: "https://example.com/health", name: "example.com" });
    await expect(owner.uptimeMonitor.monitor.create({ name: "Second", url: "https://example.com/health/", active: false })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("example.com") });
    await expect(owner.uptimeMonitor.monitor.createBulk({ monitors: [{ url: "batch.example.com", active: false }, { url: "https://batch.example.com/", active: false }] })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await owner.uptimeMonitor.monitor.list()).toHaveLength(1);
    expect(await other.uptimeMonitor.monitor.create({ url: "example.com/health", active: false })).toMatchObject({ name: "example.com" });
  });
  it("rejects whitespace-only provider names and saves trimmed owned names", async () => {
    const owner = authedCaller(await createTestUser()), other = authedCaller(await createTestUser());
    const config = { name: "   ", providerType: "resend" as const, apiKey: "local-fixture-secret", fromAddress: "qa@example.test" };
    await expect(owner.uptimeMonitor.emailProvider.create(config)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const provider = await owner.uptimeMonitor.emailProvider.create({ ...config, name: "  Primary  " });
    expect(provider.name).toBe("Primary");
    expect(JSON.stringify(provider)).not.toContain("local-fixture-secret");
    await expect(owner.uptimeMonitor.emailProvider.update({ emailProviderId: provider.emailProviderId, name: "  " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(other.uptimeMonitor.emailProvider.update({ emailProviderId: provider.emailProviderId, name: "Foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
