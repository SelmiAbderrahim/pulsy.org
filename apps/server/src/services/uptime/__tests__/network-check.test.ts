import { Resolver } from "node:dns/promises";
import { createSocket } from "node:dgram";
import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { performDnsCheck, performTcpCheck, evaluateDnsAnswers } from "../network-check";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const dns = { type: "dns" as const, hostname: "example.invalid", recordType: "A" as const, mode: "matches" as const, expected: ["1.1.1.1", "8.8.8.8"] };
describe("native DNS and TCP outcomes", () => {
  it("compares unordered exact sets without learning changed or missing records", () => {
    expect(evaluateDnsAnswers(dns, ["8.8.8.8", "1.1.1.1"])).toBeUndefined();
    expect(evaluateDnsAnswers(dns, ["1.1.1.1", "8.8.8.8", "1.1.1.1"])).toBeUndefined();
    expect(evaluateDnsAnswers(dns, ["1.1.1.1"])).toBe("assertion_failed");
    expect(evaluateDnsAnswers(dns, [])).toBe("dns_no_records");
    expect(evaluateDnsAnswers({ ...dns, mode: "exists", expected: [] }, ["8.8.4.4"])).toBeUndefined();
  });
  it("normalizes CNAME/MX names and priorities while preserving TXT case and chunks", () => {
    expect(evaluateDnsAnswers({ type: "dns", hostname: "example.invalid", recordType: "CNAME", mode: "matches", expected: ["API.Example.invalid."] }, ["api.example.invalid"])).toBeUndefined();
    expect(evaluateDnsAnswers({ type: "dns", hostname: "example.invalid", recordType: "MX", mode: "matches", expected: [{ priority: 10, exchange: "Mail.Example.invalid." }] }, [{ priority: 10, exchange: "mail.example.invalid" }])).toBeUndefined();
    expect(evaluateDnsAnswers({ type: "dns", hostname: "example.invalid", recordType: "MX", mode: "matches", expected: [{ priority: 10, exchange: "mail.example.invalid" }] }, [{ priority: 20, exchange: "mail.example.invalid" }])).toBeDefined();
    const txt = { type: "dns" as const, hostname: "_acme-challenge.example.invalid", recordType: "TXT" as const, mode: "matches" as const, expected: ["Case Sensitive"] };
    expect(evaluateDnsAnswers(txt, [["Case ", "Sensitive"]])).toBeUndefined(); expect(evaluateDnsAnswers(txt, [["case sensitive"]])).toBeDefined();
    expect(evaluateDnsAnswers({ type: "dns", hostname: "example.invalid", recordType: "AAAA", mode: "matches", expected: ["2001:4860:4860::8888"] }, ["2001:4860:4860:0:0:0:0:8888"])).toBeUndefined();
  });
  it("blocks mixed/private DNS answers only under the existing egress policy and bounds answer work", () => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "false"); expect(evaluateDnsAnswers({ ...dns, mode: "exists" }, ["1.1.1.1", "127.0.0.1"])).toBe("blocked_target");
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true"); expect(evaluateDnsAnswers({ ...dns, mode: "exists" }, ["127.0.0.1"])).toBeUndefined();
    expect(evaluateDnsAnswers({ ...dns, mode: "exists" }, Array(51).fill("1.1.1.1"))).toBe("assertion_failed");
  });
  it("uses a real native resolver for underscore TXT and distinguishes NXDOMAIN, empty, transient and timeout", async () => {
    const server = createSocket("udp4"); const questions: string[] = [];
    server.on("message", (request, remote) => {
      let end = 12, labels: string[] = [];
      while (request[end]) { const length = request[end++]!; labels.push(request.subarray(end, end + length).toString()); end += length; }
      const name = labels.join("."); questions.push(name); end += 5;
      if (name.startsWith("timeout.")) return;
      const response = Buffer.from(request.subarray(0, end)); response.writeUInt16BE(name.startsWith("missing.") ? 0x8183 : name.startsWith("temporary.") ? 0x8182 : 0x8180, 2);
      const answer = name.startsWith("_acme-challenge."); response.writeUInt16BE(answer ? 1 : 0, 6);
      const rdata = Buffer.concat([Buffer.from([5]), Buffer.from("Case "), Buffer.from([9]), Buffer.from("Sensitive")]);
      const rr = Buffer.alloc(12); rr.writeUInt16BE(0xc00c, 0); rr.writeUInt16BE(16, 2); rr.writeUInt16BE(1, 4); rr.writeUInt32BE(30, 6); rr.writeUInt16BE(rdata.length, 10);
      server.send(answer ? Buffer.concat([response, rr, rdata]) : response, remote.port, remote.address);
    });
    await new Promise<void>(resolve => server.bind(0, "127.0.0.1", resolve)); const address = server.address();
    const resolver = () => { const value = new Resolver({ timeout: 50, tries: 1 }); value.setServers([`127.0.0.1:${address.port}`]); return value; };
    try {
      const config = { type: "dns" as const, hostname: "_acme-challenge.example.invalid", recordType: "TXT" as const, mode: "matches" as const, expected: ["Case Sensitive"] };
      expect((await performDnsCheck(config, 60000, resolver())).status).toBe("up"); expect(questions[0]).toBe(config.hostname);
      expect((await performDnsCheck({ ...config, hostname: "missing.example.invalid" }, 1000, resolver())).errorMessage).toBe("dns_not_found");
      expect((await performDnsCheck({ ...config, hostname: "empty.example.invalid" }, 1000, resolver())).errorMessage).toBe("dns_no_records");
      expect((await performDnsCheck({ ...config, hostname: "temporary.example.invalid" }, 1000, resolver())).errorMessage).toBe("dns_temporary");
      expect((await performDnsCheck({ ...config, hostname: "timeout.example.invalid" }, 20, resolver())).errorMessage).toBe("response_timeout");
    } finally { await new Promise<void>(resolve => server.close(resolve)); }
  });
  it("recognizes the native resolver's null MX without treating it as a mail server", async () => {
    const server = createSocket("udp4");
    server.on("message", (request, remote) => {
      let end = 12; while (request[end]) end += request[end]! + 1; end += 5;
      const response = Buffer.from(request.subarray(0, end)); response.writeUInt16BE(0x8180, 2); response.writeUInt16BE(1, 6);
      const rr = Buffer.alloc(12); rr.writeUInt16BE(0xc00c, 0); rr.writeUInt16BE(15, 2); rr.writeUInt16BE(1, 4); rr.writeUInt32BE(30, 6); rr.writeUInt16BE(3, 10);
      server.send(Buffer.concat([response, rr, Buffer.from([0, 0, 0])]), remote.port, remote.address);
    });
    await new Promise<void>(resolve => server.bind(0, "127.0.0.1", resolve));
    const resolver = new Resolver({ timeout: 100, tries: 1 }); resolver.setServers([`127.0.0.1:${server.address().port}`]);
    const configuration = { type: "dns" as const, hostname: "nomail.example.invalid", recordType: "MX" as const, mode: "matches" as const, expected: [{ exchange: ".", priority: 0 }] };
    try {
      const answers = await resolver.resolveMx(configuration.hostname);
      // Node 24 includes the record discriminator on native MX answers.
      expect(answers).toEqual([{ priority: 0, exchange: "", type: "MX" }]);
      expect((await performDnsCheck(configuration, 1000, resolver)).status).toBe("up");
      expect(evaluateDnsAnswers(configuration, [...answers, { exchange: "mail.example.invalid", priority: 10 }])).toBeDefined();
    } finally { resolver.cancel(); await new Promise<void>(resolve => server.close(resolve)); }
  });
  it("checks a real TCP port opening, closing and recovering without retaining client sockets", async () => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true"); let active = 0; const closed: Promise<void>[] = [];
    const server = createServer(socket => { active++; socket.on("error", () => {}); socket.resume(); closed.push(new Promise(resolve => socket.once("close", () => { active--; resolve(); }))); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture port");
    const config = { type: "tcp" as const, hostname: "127.0.0.1", port: address.port };
    expect((await performTcpCheck(config, 60000)).status).toBe("up");
    await new Promise<void>(resolve => server.close(() => resolve()));
    await Promise.all(closed); expect(active).toBe(0);
    expect((await performTcpCheck(config, 1000)).errorMessage).toBe("connection_refused");
    await new Promise<void>(resolve => server.listen(address.port, "127.0.0.1", resolve));
    try { const result = await performTcpCheck(config, 1000); expect(result.status).toBe("up"); expect(result.responseTime).toBeGreaterThanOrEqual(0); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); await Promise.all(closed); expect(active).toBe(0); }
  });
  it.each(["127.0.0.1", "2130706433", "0x7f000001", "[::ffff:7f00:1]"])("applies the explicit private-network deny policy to %s", async hostname => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "false"); expect((await performTcpCheck({ type: "tcp", hostname, port: 80 }, 1000)).errorMessage).toBe("blocked_target");
  });
});

describe("OSS network probe policy and bounds", () => {
  it("allows LAN DNS answers by default and rejects every address when one is prohibited", () => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "");
    vi.stubEnv("BLOCK_PRIVATE_TARGETS", "");
    expect(evaluateDnsAnswers({ ...dns, mode: "exists" }, ["192.168.1.12", "10.0.0.5"])).toBeUndefined();
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "false");
    expect(evaluateDnsAnswers({ ...dns, mode: "exists" }, ["1.1.1.1", "192.168.1.12"])).toBe("blocked_target");
    expect(evaluateDnsAnswers({ type: "dns", hostname: "example.invalid", recordType: "AAAA", mode: "exists", expected: [] }, ["2001:4860:4860::8888", "fd00::1"])).toBe("blocked_target");
  });

  it.each(["169.254.169.254", "169.254.12.2", "0.0.0.0"])("blocks intrinsically unsafe A answer %s even when LAN access is allowed", address => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
    expect(evaluateDnsAnswers({ ...dns, mode: "exists" }, ["1.1.1.1", address])).toBe("blocked_target");
  });

  it.each(["fe80::1", "fd00:ec2::254", "::ffff:169.254.169.254"])("blocks intrinsically unsafe AAAA answer %s even when LAN access is allowed", address => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
    expect(evaluateDnsAnswers({ type: "dns", hostname: "example.invalid", recordType: "AAAA", mode: "exists", expected: [] }, [address])).toBe("blocked_target");
  });

  it("bounds malformed records, per-record TXT bytes and aggregate answer bytes", () => {
    expect(evaluateDnsAnswers({ ...dns, mode: "exists" }, ["not-an-ip"])).toBe("assertion_failed");
    expect(evaluateDnsAnswers({ ...dns, mode: "exists" }, ["::1"])).toBe("assertion_failed");
    const txt = { type: "dns" as const, hostname: "example.invalid", recordType: "TXT" as const, mode: "exists" as const, expected: [] };
    expect(evaluateDnsAnswers(txt, [["x".repeat(4097)]])).toBe("assertion_failed");
    expect(evaluateDnsAnswers(txt, ["é".repeat(2049)])).toBe("assertion_failed");
    expect(evaluateDnsAnswers(txt, Array.from({ length: 17 }, () => "x".repeat(4096)))).toBe("assertion_failed");
    expect(evaluateDnsAnswers(txt, [[1]])).toBe("assertion_failed");
    expect(evaluateDnsAnswers({ type: "dns", hostname: "example.invalid", recordType: "MX", mode: "exists", expected: [] }, [{ priority: "10", exchange: "mail.example.invalid" }])).toBe("assertion_failed");
  });

  it.each(["169.254.169.254", "metadata.google.internal", "2130706433", "0x7f000001"])("rejects prohibited DNS hostname %s before asking the resolver", async hostname => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
    const resolve4 = vi.spyOn(Resolver.prototype, "resolve4").mockResolvedValue(["1.1.1.1"]);
    const result = await performDnsCheck({ ...dns, hostname }, 1000);
    expect(result).toMatchObject({ status: "down", errorMessage: "blocked_target", responseTime: null });
    expect(resolve4).not.toHaveBeenCalled();
  });

  it("reports a timing sample only once DNS answers have arrived", async () => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
    const resolve4 = vi.spyOn(Resolver.prototype, "resolve4").mockResolvedValue(["1.1.1.1"]);
    const mismatch = await performDnsCheck(dns, 1000);
    expect(mismatch).toMatchObject({ status: "down", errorMessage: "assertion_failed" });
    expect(mismatch.responseTime).toBeGreaterThanOrEqual(0);
    resolve4.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
    expect(await performDnsCheck(dns, 1000)).toMatchObject({ errorMessage: "dns_not_found", responseTime: null });
  });

  it.each(["169.254.169.254", "[fe80::1]", "metadata.google.internal"])("blocks unsafe TCP destination %s even when LAN access is allowed", async hostname => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
    expect(await performTcpCheck({ type: "tcp", hostname, port: 80 }, 1000)).toMatchObject({ status: "down", errorMessage: "blocked_target", responseTime: null });
  });

  it.each([NaN, Infinity, -1, 0, 60001])("rejects invalid DNS/TCP timeout %s before native work", async timeoutMs => {
    const resolve4 = vi.spyOn(Resolver.prototype, "resolve4").mockResolvedValue(["1.1.1.1"]);
    expect(await performDnsCheck(dns, timeoutMs)).toMatchObject({ errorMessage: "invalid_configuration", responseTime: null });
    expect(await performTcpCheck({ type: "tcp", hostname: "example.invalid", port: 443 }, timeoutMs)).toMatchObject({ errorMessage: "invalid_configuration", responseTime: null });
    expect(resolve4).not.toHaveBeenCalled();
  });
});

describe("DNS checks under the private-target policy", () => {
  it("ask public resolvers instead of the host's, so internal names cannot be probed", async () => {
    const setServers = vi.spyOn(Resolver.prototype, "setServers").mockImplementation(() => undefined);
    const resolve4 = vi.spyOn(Resolver.prototype, "resolve4").mockResolvedValue(["93.184.216.34"]);
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "false");
    try {
      const result = await performDnsCheck({ ...dns, hostname: "service.example.com", expected: ["93.184.216.34"] }, 1000);
      expect(result.status).toBe("up");
      expect(setServers).toHaveBeenCalledWith(["1.1.1.1", "8.8.8.8"]);
      vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
      setServers.mockClear();
      await performDnsCheck({ ...dns, hostname: "service.example.com", expected: ["93.184.216.34"] }, 1000);
      expect(setServers).not.toHaveBeenCalled(); // self-hosted default keeps the system resolver (internal DNS works)
      expect(resolve4).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllEnvs(); vi.restoreAllMocks(); }
  });
});

it("rejects DNS/TCP timeouts beyond the shared 60-second maximum before starting work", async () => {
  expect((await performDnsCheck(dns, 60001)).errorMessage).toBe("invalid_configuration");
  expect((await performTcpCheck({ type: "tcp", hostname: "example.invalid", port: 443 }, 60001)).errorMessage).toBe("invalid_configuration");
});
