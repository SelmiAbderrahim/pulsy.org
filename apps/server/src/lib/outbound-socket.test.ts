import { createServer } from "node:net";
import { describe, expect, it, vi, afterEach } from "vitest";
import { connectOutboundSocket } from "./outbound-socket";
const dns = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: dns }));
afterEach(() => { vi.unstubAllEnvs(); dns.mockReset(); });
describe("bounded native outbound sockets", () => {
  it.each(["127.0.0.1", "2130706433", "0x7f000001", "[::1]", "[::ffff:7f00:1]"])("blocks private literal %s under the existing Cloud policy", async host => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "false");
    await expect(connectOutboundSocket(host, 25, 100)).rejects.toMatchObject({ code: "EDESTINATION" });
    expect(dns).not.toHaveBeenCalled();
  });
  it("checks every resolved address before connecting, including mixed answers", async () => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "false"); dns.mockResolvedValue([{ address: "1.1.1.1", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(connectOutboundSocket("fixture.invalid", 25, 100)).rejects.toMatchObject({ code: "EDESTINATION" });
  });
  it("pins the validated answer while preserving intentional self-hosted private access", async () => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
    const server = createServer(socket => { socket.on("error", () => {}); socket.end("local fixture"); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture port");
    dns.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]).mockRejectedValue(new Error("A second lookup must not happen"));
    try {
      const socket = await connectOutboundSocket("fixture.invalid", address.port, 1000);
      expect(socket.remoteAddress).toBe("127.0.0.1"); expect(dns).toHaveBeenCalledTimes(1);
      socket.destroy();
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it("bounds stalled DNS and rejects malformed host/port without resolution", async () => {
    dns.mockImplementation(() => new Promise(() => {}));
    await expect(connectOutboundSocket("fixture.invalid", 25, 20)).rejects.toMatchObject({ code: "ETIMEDOUT" });
    dns.mockClear();
    for (const host of ["user:secret@fixture.invalid", "fixture.invalid/path", "fixture.invalid?token=private", "", "a".repeat(254)]) await expect(connectOutboundSocket(host, 25, 100)).rejects.toMatchObject({ code: "EDESTINATION" });
    await expect(connectOutboundSocket("fixture.invalid", 0, 100)).rejects.toMatchObject({ code: "EDESTINATION" });
    expect(dns).not.toHaveBeenCalled();
  });
  it("fails closed on empty or excessive DNS answers and cleans up connection refusal", async () => {
    dns.mockResolvedValueOnce([]).mockResolvedValueOnce(Array.from({ length: 17 }, () => ({ address: "1.1.1.1", family: 4 })));
    await expect(connectOutboundSocket("fixture.invalid", 25, 100)).rejects.toMatchObject({ code: "EDESTINATION" });
    await expect(connectOutboundSocket("fixture.invalid", 25, 100)).rejects.toMatchObject({ code: "EDESTINATION" });
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
    const server = createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture port"); await new Promise<void>(resolve => server.close(() => resolve()));
    await expect(connectOutboundSocket("127.0.0.1", address.port, 1000)).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });
});
