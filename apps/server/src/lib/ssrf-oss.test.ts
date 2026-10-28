import { afterEach, describe, expect, it, vi } from "vitest";
import { assertAllowedUrl, describeEgressPolicy, isPrivateNetworkAllowed, SsrfBlockedError } from "./ssrf";

afterEach(() => vi.unstubAllEnvs());

describe("OSS egress policy", () => {
  it("permits private targets by default and logs that policy", () => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", undefined);
    vi.stubEnv("BLOCK_PRIVATE_TARGETS", undefined);
    expect(isPrivateNetworkAllowed()).toBe(true);
    expect(() => assertAllowedUrl("http://192.168.1.10:8080/health")).not.toThrow();
    expect(describeEgressPolicy().join(" ")).toMatch(/WARNING.*private\/LAN/);
  });

  it("supports the deprecated deny alias and gives the explicit setting precedence", () => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", undefined);
    vi.stubEnv("BLOCK_PRIVATE_TARGETS", "true");
    expect(isPrivateNetworkAllowed()).toBe(false);
    expect(() => assertAllowedUrl("http://127.0.0.1/")).toThrow(SsrfBlockedError);
    expect(describeEgressPolicy().join(" ")).toMatch(/deprecated/);
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
    expect(isPrivateNetworkAllowed()).toBe(true);
  });

  it.each([
    "http://169.254.169.254/", "http://metadata.google.internal/",
    "http://[fe80::1]/", "http://[fd00:ec2::254]/",
    "http://[::169.254.169.254]/",
    "http://[64:ff9b::a9fe:a9fe]/", "http://[2002:a9fe:a9fe::]/",
    "http://169.254.169.254.nip.io/",
  ])("blocks metadata or link-local destination %s while allowing LAN targets", url => {
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
    expect(() => assertAllowedUrl(url)).toThrow(SsrfBlockedError);
  });
});
