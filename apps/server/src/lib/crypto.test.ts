import { beforeAll, describe, expect, it } from "vitest";

// The key is read lazily inside encrypt()/decrypt(), so setting it before the
// first call is sufficient. We set it up-front to be robust regardless of order.
beforeAll(() => {
	process.env.ENCRYPTION_KEY =
		process.env.ENCRYPTION_KEY ?? "test-encryption-key-for-crypto-unit-tests";
});

describe("crypto (AES-256-GCM)", () => {
	it("round-trips a value: decrypt(encrypt(x)) === x", async () => {
		const { encrypt, decrypt } = await import("./crypto");
		const plain = "super-secret-api-key-12345";

		const cipher = encrypt(plain);
		expect(decrypt(cipher)).toBe(plain);
	});

	it("produces ciphertext that differs from the plaintext", async () => {
		const { encrypt } = await import("./crypto");
		const plain = "another-secret";

		const cipher = encrypt(plain);
		expect(cipher).not.toBe(plain);
		expect(cipher.length).toBeGreaterThan(0);
	});

	it("uses a random IV: two encryptions of the same value differ", async () => {
		const { encrypt, decrypt } = await import("./crypto");
		const plain = "repeatable-input";

		const a = encrypt(plain);
		const b = encrypt(plain);

		// Different ciphertext (random IV) ...
		expect(a).not.toBe(b);
		// ... but both decrypt back to the same plaintext.
		expect(decrypt(a)).toBe(plain);
		expect(decrypt(b)).toBe(plain);
	});

	it("handles unicode and empty strings", async () => {
		const { encrypt, decrypt } = await import("./crypto");

		expect(decrypt(encrypt(""))).toBe("");
		expect(decrypt(encrypt("héllo — مرحبا — 你好"))).toBe(
			"héllo — مرحبا — 你好",
		);
	});

	it("rejects a payload that is too short to be valid", async () => {
		const { decrypt } = await import("./crypto");
		expect(() => decrypt("AAAA")).toThrow();
	});

	it("throws when ENCRYPTION_KEY is not set", async () => {
		const { encrypt } = await import("./crypto");
		const saved = process.env.ENCRYPTION_KEY;
		// Key is read lazily inside encrypt(), so unset it just for this call.
		delete process.env.ENCRYPTION_KEY;
		try {
			expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY/);
		} finally {
			process.env.ENCRYPTION_KEY = saved;
		}
	});

	it("rejects the .env.example placeholder value", async () => {
		const { encrypt } = await import("./crypto");
		const saved = process.env.ENCRYPTION_KEY;
		process.env.ENCRYPTION_KEY = "replace-with-32-byte-base64-key";
		try {
			expect(() => encrypt("x")).toThrow(/placeholder/);
		} finally {
			process.env.ENCRYPTION_KEY = saved;
		}
	});

	it("rejects a key shorter than the minimum length", async () => {
		const { encrypt } = await import("./crypto");
		const saved = process.env.ENCRYPTION_KEY;
		process.env.ENCRYPTION_KEY = "short-key";
		try {
			expect(() => encrypt("x")).toThrow(/placeholder|shorter/);
		} finally {
			process.env.ENCRYPTION_KEY = saved;
		}
	});
});
