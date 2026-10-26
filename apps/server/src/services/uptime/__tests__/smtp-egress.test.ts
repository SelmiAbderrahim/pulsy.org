import { createServer } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { sendViaProvider } from "../email-provider-service";

afterEach(() => vi.unstubAllEnvs());

it("never opens an SMTP socket to a private target under deny mode", async () => {
  vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "false");
  let connections = 0;
  const listener = createServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Fixture unavailable");
  try {
    await expect(sendViaProvider({
      providerType: "smtp", apiKey: null, smtpHost: "127.0.0.1",
      smtpPort: address.port, smtpUsername: null, smtpPassword: null,
      smtpSecure: false, fromAddress: "sender@fixture.invalid",
    }, "recipient@fixture.invalid", "Fixture", "Fixture")).rejects.toThrow(/SMTP delivery failed/);
    expect(connections).toBe(0);
  } finally {
    await new Promise<void>(resolve => listener.close(() => resolve()));
  }
});
