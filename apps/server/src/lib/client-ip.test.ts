import { describe, expect, it } from "vitest";
import { clientRateLimitKey } from "./client-ip";

describe("clientRateLimitKey", () => {
	it("keys IPv4 on the address, including IPv4-mapped IPv6", () => {
		expect(clientRateLimitKey("203.0.113.9")).toBe("203.0.113.9");
		expect(clientRateLimitKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
	});
	it("gives every address in one IPv6 /64 the same key, and different /64s different keys", () => {
		const a = clientRateLimitKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
		expect(clientRateLimitKey("2001:db8:1:2::1")).toBe(a);
		expect(clientRateLimitKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe(a);
		expect(clientRateLimitKey("2001:db8:1:3::1")).not.toBe(a);
	});
	it("falls back to the raw value when unparseable", () => {
		expect(clientRateLimitKey("not:an:ip:::::::x")).toBe("not:an:ip:::::::x");
		expect(clientRateLimitKey("unknown")).toBe("unknown");
	});
});
