import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Table-driven egress policy (lib/ssrf.ts + egress-input.ts). DNS is faked so no
// case depends on the network; the default policy (private networks denied) is
// restored for every test and the permissive self-host switch is exercised
// explicitly.
const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", async importActual => ({ ...(await importActual<typeof import("node:dns/promises")>()), lookup: lookupMock }));

const { assertAllowedAddress, assertAllowedHostname, assertAllowedUrl, assertOutboundUrlAllowed, resolveAndPin, SsrfBlockedError } = await import("../../../lib/ssrf");
const { isMonitorHostAllowed, isMonitorUrlAllowed } = await import("../egress-input");

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];
const ORIGINAL = process.env.MONITOR_ALLOW_PRIVATE_NETWORKS;

beforeEach(() => {
	process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = "false";
	lookupMock.mockReset();
	lookupMock.mockResolvedValue(PUBLIC);
});
afterEach(() => {
	if (ORIGINAL === undefined) delete process.env.MONITOR_ALLOW_PRIVATE_NETWORKS;
	else process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = ORIGINAL;
});

const ALLOWED_URLS = [
	"https://example.com",
	"http://example.com/path?q=1",
	"https://api.example.com:8443/health",
	"https://EXAMPLE.com",
	"https://example.com.",
	"https://sub.domain.example.co.uk/a/b",
	"https://8.8.8.8",
	"https://1.1.1.1:443/",
	"https://[2606:4700:4700::1111]/",
	"https://[2001:4860:4860::8888]:8443/",
	"https://xn--bcher-kva.example/",
	"https://bücher.example/",
	"https://my-host_01.example.org",
	"http://93.184.216.34:8080/",
];

const DENIED_URLS: Array<[string, string]> = [
	["http://localhost", "localhost"],
	["http://LOCALHOST:3000", "localhost uppercase"],
	["http://localhost.", "localhost trailing dot"],
	["http://127.0.0.1:4000", "loopback with port"],
	["http://127.1", "short loopback"],
	["http://2130706433", "decimal loopback"],
	["http://0x7f000001", "hex loopback"],
	["http://0x7f.0.0.1", "hex octet loopback"],
	["http://0177.0.0.1", "octal loopback"],
	["http://[::1]", "IPv6 loopback"],
	["http://[::1]:8080/", "IPv6 loopback with port"],
	["http://[::]/", "IPv6 unspecified"],
	["http://0.0.0.0", "unspecified"],
	["http://10.0.0.1", "RFC1918 10/8"],
	["http://172.16.5.4", "RFC1918 172.16/12"],
	["http://172.31.255.255", "RFC1918 upper bound"],
	["http://192.168.1.1", "RFC1918 192.168/16"],
	["http://100.64.0.1", "CGNAT"],
	["http://198.18.0.1", "benchmarking"],
	["http://169.254.169.254", "cloud metadata"],
	["http://169.254.169.254/latest/meta-data/", "cloud metadata path"],
	["http://2852039166", "decimal metadata"],
	["http://0xa9fea9fe", "hex metadata"],
	["http://0251.0376.0251.0376", "octal metadata"],
	["http://[::ffff:169.254.169.254]", "IPv4-mapped metadata"],
	["http://[::ffff:127.0.0.1]", "IPv4-mapped loopback"],
	["http://[::ffff:7f00:1]", "IPv4-mapped hex loopback"],
	["http://[fe80::1]", "IPv6 link-local"],
	["http://[fc00::1]", "IPv6 unique-local"],
	["http://[fd12:3456::1]", "IPv6 unique-local fd"],
	["http://[64:ff9b::a9fe:a9fe]", "NAT64 metadata"],
	["http://[2002:7f00:1::]", "6to4 loopback"],
	["http://224.0.0.1", "multicast"],
	["http://255.255.255.255", "broadcast"],
	["http://metadata.google.internal", "GCP metadata name"],
	["http://METADATA.GOOGLE.INTERNAL.", "GCP metadata uppercase trailing dot"],
	["http://pulsy-postgres", "single-label docker name"],
	["http://pulsy-server:4000", "single-label docker name with port"],
	["http://redis/", "single-label name"],
	["http://printer.local", "mDNS suffix"],
	["http://db.internal", "internal suffix"],
	["http://nas.lan", "lan suffix"],
	["http://router.home.arpa", "home.arpa suffix"],
	["http://api.localhost", "localhost subdomain"],
	["http://127.0.0.1.nip.io", "wildcard DNS loopback"],
	["http://10-0-0-1.sslip.io", "dashed wildcard DNS private"],
	["http://169.254.169.254.nip.io", "wildcard DNS metadata"],
	["http://app.192.168.0.10.nip.io", "wildcard DNS private with prefix"],
	["http://ｌｏｃａｌｈｏｓｔ", "fullwidth localhost normalizes to a denied name"],
	["http://127。0。0。1", "ideographic full stops normalize to loopback"],
	["http://１２７.０.０.１", "fullwidth digits normalize to loopback"],
	["http://localhost%2e", "percent-encoded trailing dot"],
	["http://pulsy%2dserver", "percent-encoded single-label name"],
	["http://user:pass@example.com", "credentials in URL"],
	["http://user@example.com", "username in URL"],
	["ftp://example.com", "ftp scheme"],
	["file:///etc/passwd", "file scheme"],
	["gopher://example.com", "gopher scheme"],
	["javascript:alert(1)", "javascript scheme"],
	["not a url", "unparseable"],
	["", "empty"],
];

describe("assertAllowedUrl — allowed public destinations", () => {
	it.each(ALLOWED_URLS)("%s is allowed", url => {
		expect(() => assertAllowedUrl(url)).not.toThrow();
	});
});

describe("assertAllowedUrl — denied destinations", () => {
	it.each(DENIED_URLS)("%s (%s) is rejected", url => {
		expect(() => assertAllowedUrl(url)).toThrow(SsrfBlockedError);
	});
});

describe("assertAllowedUrl — ports", () => {
	it.each(["http://example.com:0", "http://example.com:65536", "http://example.com:99999"])("%s is rejected", url => {
		expect(() => assertAllowedUrl(url)).toThrow(SsrfBlockedError);
	});
	it.each(["http://example.com:1", "http://example.com:65535", "https://example.com:8443"])("%s is allowed", url => {
		expect(() => assertAllowedUrl(url)).not.toThrow();
	});
});

describe("assertAllowedHostname", () => {
	it.each(["example.com", "EXAMPLE.COM", "example.com.", "a.b.c.example.org", "8.8.8.8", "[2606:4700:4700::1111]"])("%s is allowed", host => {
		expect(() => assertAllowedHostname(host)).not.toThrow();
	});
	it.each(["localhost", "LOCALHOST.", "127.0.0.1", "[::1]", "10.0.0.1", "169.254.169.254", "pulsy-server", "db.internal", "127.0.0.1.nip.io", "bad host", "ex ample.com", "-", "a..b.example", `${"a".repeat(64)}.example`, `${"a.".repeat(130)}com`])("%s is rejected", host => {
		expect(() => assertAllowedHostname(host)).toThrow(SsrfBlockedError);
	});
	it("rejects non-canonical encodings only when the typed form differs", () => {
		expect(() => assertAllowedHostname("127.0.0.1", "127.0.0.1")).toThrow(/private|address/i);
		expect(() => assertAllowedHostname("8.8.8.8", "0x8.8.8.8")).toThrow(/Non-canonical/);
		expect(() => assertAllowedHostname("8.8.8.8", "8.8.8.8")).not.toThrow();
	});
	it("treats a numeric final label as an encoded IPv4 number", () => {
		expect(() => assertAllowedHostname("example.123")).toThrow(/Non-canonical/);
		expect(() => assertAllowedHostname("example.0x7f")).toThrow(/Non-canonical/);
	});
});

describe("assertAllowedAddress", () => {
	it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])("%s is allowed", ip => {
		expect(() => assertAllowedAddress(ip)).not.toThrow();
	});
	it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "0.0.0.0", "::1", "::", "fe80::1", "fc00::1", "::ffff:8.8.8.8", "::ffff:10.0.0.1", "not-an-ip", ""])("%s is rejected without echoing the address", ip => {
		expect.assertions(2);
		try { assertAllowedAddress(ip); } catch (error) {
			expect(error).toBeInstanceOf(SsrfBlockedError);
			expect((error as Error).message).not.toContain(ip || "\u0000");
		}
	});
});

describe("permissive self-host mode (MONITOR_ALLOW_PRIVATE_NETWORKS=true)", () => {
	beforeEach(() => { process.env.MONITOR_ALLOW_PRIVATE_NETWORKS = "true"; });

	it.each(["http://localhost", "http://10.0.0.1", "http://192.168.1.1:8080", "http://pulsy-server:4000", "http://[::1]", "http://127.0.0.1.nip.io", "http://db.internal"])("%s becomes allowed", url => {
		expect(() => assertAllowedUrl(url)).not.toThrow();
	});
	it.each([
		"http://169.254.169.254",
		"http://169.254.169.254/latest/meta-data/",
		"http://0.0.0.0",
		"http://[::ffff:127.0.0.1]",
		"http://metadata.google.internal",
		"http://[fe80::1]",
		"http://user:pw@example.com",
		"http://2130706433",
		"ftp://example.com",
	])("%s stays denied", url => {
		expect(() => assertAllowedUrl(url)).toThrow(SsrfBlockedError);
	});
});

describe("resolution is checked, not just the name", () => {
	it("allows a public name resolving to public addresses", async () => {
		await expect(isMonitorUrlAllowed("https://example.com")).resolves.toBe(true);
	});
	it.each([
		["loopback", [{ address: "127.0.0.1", family: 4 }]],
		["metadata", [{ address: "169.254.169.254", family: 4 }]],
		["RFC1918", [{ address: "10.0.0.5", family: 4 }]],
		["IPv6 unique-local", [{ address: "fd00::1", family: 6 }]],
		["IPv4-mapped IPv6", [{ address: "::ffff:127.0.0.1", family: 6 }]],
		["mixed public + private (one bad answer rejects)", [{ address: "93.184.216.34", family: 4 }, { address: "192.168.0.9", family: 4 }]],
		["private listed first", [{ address: "10.0.0.1", family: 4 }, { address: "93.184.216.34", family: 4 }]],
	])("a public name resolving to %s is rejected", async (_label, answers) => {
		lookupMock.mockResolvedValue(answers);
		await expect(isMonitorUrlAllowed("https://rebind.example.com")).resolves.toBe(false);
	});
	it("fails closed on resolver failure and empty answers", async () => {
		lookupMock.mockRejectedValue(Object.assign(new Error("nope"), { code: "ENOTFOUND" }));
		await expect(isMonitorUrlAllowed("https://gone.example.com")).resolves.toBe(false);
		lookupMock.mockResolvedValue([]);
		await expect(isMonitorUrlAllowed("https://empty.example.com")).resolves.toBe(false);
	});
	it("fails closed when a name returns an unreasonable number of answers", async () => {
		lookupMock.mockResolvedValue(Array.from({ length: 40 }, () => ({ address: "93.184.216.34", family: 4 })));
		await expect(isMonitorUrlAllowed("https://many.example.com")).resolves.toBe(false);
	});
	it("an injected resolver is honoured and the first validated answer is pinned", async () => {
		const resolver = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }, { address: "8.8.8.8", family: 4 }]);
		await expect(resolveAndPin("example.com", resolver)).resolves.toEqual({ address: "93.184.216.34", family: 4 });
		expect(resolver).toHaveBeenCalledWith("example.com");
	});
	it("IP literals never touch DNS", async () => {
		await expect(isMonitorUrlAllowed("https://8.8.8.8")).resolves.toBe(true);
		await expect(isMonitorUrlAllowed("http://127.0.0.1")).resolves.toBe(false);
		expect(lookupMock).not.toHaveBeenCalled();
	});
	it("assertOutboundUrlAllowed does not echo the resolved address", async () => {
		lookupMock.mockResolvedValue([{ address: "10.9.8.7", family: 4 }]);
		await expect(assertOutboundUrlAllowed("https://leak.example.com")).rejects.toSatisfy((error: unknown) => error instanceof SsrfBlockedError && !error.message.includes("10.9.8.7"));
	});
});

describe("isMonitorUrlAllowed — scheme-less input", () => {
	it("judges the host as typed before normalisation", async () => {
		await expect(isMonitorUrlAllowed("example.com")).resolves.toBe(true);
		await expect(isMonitorUrlAllowed("localhost:3000")).resolves.toBe(false);
		await expect(isMonitorUrlAllowed("169.254.169.254")).resolves.toBe(false);
		await expect(isMonitorUrlAllowed("2130706433")).resolves.toBe(false);
		await expect(isMonitorUrlAllowed("  https://example.com  ")).resolves.toBe(true);
	});
});

describe("isMonitorHostAllowed — DNS and TCP monitor hosts", () => {
	it.each(["example.com", "8.8.8.8", "2606:4700:4700::1111"])("%s is allowed for tcp and dns", async host => {
		await expect(isMonitorHostAllowed(host, "tcp")).resolves.toBe(true);
		await expect(isMonitorHostAllowed(host, "dns")).resolves.toBe(true);
	});
	it.each(["localhost", "127.0.0.1", "::1", "10.0.0.1", "169.254.169.254", "pulsy-postgres", "db.internal", "127.0.0.1.nip.io", "0x7f000001"])("%s is denied for tcp and dns", async host => {
		await expect(isMonitorHostAllowed(host, "tcp")).resolves.toBe(false);
		await expect(isMonitorHostAllowed(host, "dns")).resolves.toBe(false);
	});
	it("a TCP host resolving to a private address is denied, while a DNS monitor only gets name checks", async () => {
		lookupMock.mockResolvedValue([{ address: "10.0.0.8", family: 4 }]);
		await expect(isMonitorHostAllowed("rebind.example.com", "tcp")).resolves.toBe(false);
		await expect(isMonitorHostAllowed("rebind.example.com", "dns")).resolves.toBe(true);
	});
});
