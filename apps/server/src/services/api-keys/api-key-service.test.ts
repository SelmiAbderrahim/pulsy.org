import { apiKey, db } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createTestApiKey,
	createTestUser,
	useCleanDatabase,
} from "../../../test/db";
import {
	createApiKey,
	generateApiKey,
	hashApiKey,
	listApiKeys,
	resolveApiKey,
	revokeApiKey,
} from "./api-key-service";

useCleanDatabase();

const originalEnv = { ...process.env };

afterEach(() => {
	process.env = { ...originalEnv };
});

describe("generateApiKey / hashApiKey", () => {
	it("generates a prefixed, unique token", () => {
		const a = generateApiKey();
		const b = generateApiKey();
		expect(a.startsWith("pul_")).toBe(true);
		expect(a).not.toBe(b);
	});

	it("hashes deterministically and never equals the plaintext", () => {
		const plain = "pul_example";
		expect(hashApiKey(plain)).toBe(hashApiKey(plain));
		expect(hashApiKey(plain)).not.toBe(plain);
		expect(hashApiKey(plain)).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe("createApiKey", () => {
	it("returns the plaintext once and stores only its hash", async () => {
		const u = await createTestUser();
		const { row, plaintext } = await createApiKey(u.id, "CI");

		expect(plaintext.startsWith("pul_")).toBe(true);
		expect(row.name).toBe("CI");
		expect(row.keyPrefix).toBe(plaintext.slice(0, 8));
		// The masked row never carries the hash.
		expect("hashedKey" in row).toBe(false);

		const stored = await db.query.apiKey.findFirst({
			where: eq(apiKey.apiKeyId, row.apiKeyId),
		});
		expect(stored?.hashedKey).toBe(hashApiKey(plaintext));
		expect(stored?.hashedKey).not.toBe(plaintext);
	});
});

describe("listApiKeys", () => {
	it("returns the owner's keys newest-first, without the hash", async () => {
		const owner = await createTestUser();
		const other = await createTestUser();
		await createTestApiKey(owner.id, {
			name: "old",
			createdAt: new Date(Date.now() - 1000).toISOString(),
		});
		await createTestApiKey(owner.id, {
			name: "new",
			createdAt: new Date().toISOString(),
		});
		await createTestApiKey(other.id, { name: "theirs" });

		const keys = await listApiKeys(owner.id);
		expect(keys).toHaveLength(2);
		expect(keys[0]?.name).toBe("new");
		expect(keys.every((k) => !("hashedKey" in k))).toBe(true);
	});
});

describe("revokeApiKey", () => {
	it("revokes a live key the user owns", async () => {
		const u = await createTestUser();
		const { row } = await createTestApiKey(u.id);
		expect(await revokeApiKey(u.id, row.apiKeyId)).toBe(true);

		const stored = await db.query.apiKey.findFirst({
			where: eq(apiKey.apiKeyId, row.apiKeyId),
		});
		expect(stored?.revokedAt).not.toBeNull();
	});

	it("returns false for an already-revoked key", async () => {
		const u = await createTestUser();
		const { row } = await createTestApiKey(u.id, {
			revokedAt: new Date().toISOString(),
		});
		expect(await revokeApiKey(u.id, row.apiKeyId)).toBe(false);
	});

	it("returns false for another user's key", async () => {
		const owner = await createTestUser();
		const attacker = await createTestUser();
		const { row } = await createTestApiKey(owner.id);
		expect(await revokeApiKey(attacker.id, row.apiKeyId)).toBe(false);
	});

	it("returns false for an unknown key id", async () => {
		const u = await createTestUser();
		expect(await revokeApiKey(u.id, "nope")).toBe(false);
	});
});

describe("resolveApiKey", () => {
	it("rejects a token without the pul_ prefix", async () => {
		expect(await resolveApiKey("xxx")).toEqual({ ok: false, reason: "invalid" });
	});

	it("rejects an unknown token", async () => {
		expect(await resolveApiKey("pul_unknown")).toEqual({
			ok: false,
			reason: "invalid",
		});
	});

	it("rejects a revoked token as revoked", async () => {
		const u = await createTestUser();
		const { plaintext } = await createTestApiKey(u.id, {
			revokedAt: new Date().toISOString(),
		});
		expect(await resolveApiKey(plaintext)).toEqual({
			ok: false,
			reason: "revoked",
		});
	});

	it("rejects an expired token", async () => {
		const u = await createTestUser();
		const { plaintext } = await createTestApiKey(u.id, {
			expiresAt: new Date(Date.now() - 1000).toISOString(),
		});
		expect(await resolveApiKey(plaintext)).toEqual({
			ok: false,
			reason: "invalid",
		});
	});

	it("rejects a live token owned by a banned user without updating usage", async () => {
		const u = await createTestUser({ banned: true });
		const { row, plaintext } = await createTestApiKey(u.id);

		expect(await resolveApiKey(plaintext)).toEqual({
			ok: false,
			reason: "invalid",
		});

		const stored = await db.query.apiKey.findFirst({
			where: eq(apiKey.apiKeyId, row.apiKeyId),
		});
		expect(stored?.lastUsedAt).toBeNull();
	});

	it("resolves a valid token, bumps lastUsedAt, and returns effective access", async () => {
		const u = await createTestUser();
		const { row, plaintext } = await createTestApiKey(u.id);
		expect(row.lastUsedAt).toBeNull();

		const result = await resolveApiKey(plaintext);
		expect(result).toEqual({
			ok: true,
			user: { id: u.id },
			apiKeyId: row.apiKeyId,
		});

		const stored = await db.query.apiKey.findFirst({
			where: eq(apiKey.apiKeyId, row.apiKeyId),
		});
		expect(stored?.lastUsedAt).not.toBeNull();
	});
});
