import { afterEach, describe, expect, it } from "vitest";
import { createTestEmailProvider, createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { mockFetch } from "../../../../test/fetch-mock";
import { encrypt } from "../../../lib/crypto";
import { vi } from "vitest";

useCleanDatabase();
afterEach(() => vi.restoreAllMocks());

describe("notification test admission", () => {
  it("shares three in-flight slots between channel/provider tests, isolates owners, and releases completed slots", async () => {
    const owner = await createTestUser(), other = await createTestUser();
    const caller = authedCaller(owner), foreign = authedCaller(other);
    const channel = await caller.uptimeMonitor.channel.createDefault({ channelType: "webhook", webhookUrl: "https://fixture.invalid/owner" });
    const otherChannel = await foreign.uptimeMonitor.channel.createDefault({ channelType: "webhook", webhookUrl: "https://fixture.invalid/other" });
    const provider = await createTestEmailProvider(owner.id, { providerType: "resend", apiKey: encrypt("fixture-api-key") });
    let release!: (response: Response) => void;
    const held = new Promise<Response>(resolve => { release = resolve; });
    const transport = mockFetch(() => held);
    const active = [caller.uptimeMonitor.channel.test({ channelId: channel.channelId }), caller.uptimeMonitor.channel.test({ channelId: channel.channelId }), caller.uptimeMonitor.emailProvider.test({ emailProviderId: provider.emailProviderId })];
    const requests: Promise<unknown>[] = [...active];
    try {
      await vi.waitFor(() => expect(transport.calls).toHaveLength(3));
      let code: string | undefined;
      requests.push(caller.uptimeMonitor.channel.test({ channelId: channel.channelId }).catch((error: unknown) => {
        if (error && typeof error === "object" && "code" in error && typeof error.code === "string") code = error.code;
      }));
      await vi.waitFor(() => expect(code).toBe("TOO_MANY_REQUESTS"));
      requests.push(foreign.uptimeMonitor.channel.test({ channelId: otherChannel.channelId }));
      await vi.waitFor(() => expect(transport.calls).toHaveLength(4));
      expect(transport.calls.some(call => call.url === "https://fixture.invalid/other")).toBe(true);
    } finally {
      release(new Response('{"id":"fixture-message"}', { status: 200, headers: { "Content-Type": "application/json" } }));
      await Promise.allSettled(requests);
      transport.restore();
    }
    const available = mockFetch();
    try { await expect(caller.uptimeMonitor.channel.test({ channelId: channel.channelId })).resolves.toMatchObject({ success: true }); }
    finally { available.restore(); }
  });
});
