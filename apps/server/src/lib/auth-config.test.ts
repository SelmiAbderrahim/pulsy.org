import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// auth-config reads env once at module load, so each case stubs env and
// re-imports the module via vi.resetModules() + dynamic import.

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("REQUIRE_EMAIL_VERIFICATION", () => {
	it("defaults to true when unset", async () => {
		vi.stubEnv("REQUIRE_EMAIL_VERIFICATION", undefined);
		const mod = await import("./auth-config");
		expect(mod.REQUIRE_EMAIL_VERIFICATION).toBe(true);
	});

	it("is false only for the literal 'false' (case-insensitive)", async () => {
		vi.stubEnv("REQUIRE_EMAIL_VERIFICATION", "FALSE");
		const mod = await import("./auth-config");
		expect(mod.REQUIRE_EMAIL_VERIFICATION).toBe(false);
	});

	it("is true for any other value", async () => {
		vi.stubEnv("REQUIRE_EMAIL_VERIFICATION", "yes");
		const mod = await import("./auth-config");
		expect(mod.REQUIRE_EMAIL_VERIFICATION).toBe(true);
	});
});

describe("PUBLIC_WEB_URL", () => {
	it("defaults to localhost:3000 when unset", async () => {
		vi.stubEnv("PUBLIC_WEB_URL", undefined);
		const mod = await import("./auth-config");
		expect(mod.PUBLIC_WEB_URL).toBe("http://localhost:3000");
	});

	it("uses the env override when set", async () => {
		vi.stubEnv("PUBLIC_WEB_URL", "https://status.example.com");
		const mod = await import("./auth-config");
		expect(mod.PUBLIC_WEB_URL).toBe("https://status.example.com");
	});
});
