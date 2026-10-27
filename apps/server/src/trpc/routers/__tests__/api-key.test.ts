import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";

useCleanDatabase();

const originalEnv = { ...process.env };

let owner: Awaited<ReturnType<typeof createTestUser>>;
let other: Awaited<ReturnType<typeof createTestUser>>;

beforeEach(async () => {
	owner = await createTestUser({ email: "owner@pulsy.test" });
	other = await createTestUser({ email: "other@pulsy.test" });
});

afterEach(() => {
	process.env = { ...originalEnv }; vi.useRealTimers();
});

function ownerCaller() {
	return authedCaller({ id: owner.id, email: owner.email });
}

describe("apiKey.create / list", () => {
	it("creates a key, returns the plaintext once, and lists it masked", async () => {
		const created = await ownerCaller().apiKey.create({ name: "CI" });
		expect(created.plaintext.startsWith("pul_")).toBe(true);
		expect(created.name).toBe("CI");
		expect("hashedKey" in created).toBe(false);

		const list = await ownerCaller().apiKey.list();
		expect(list).toHaveLength(1);
		expect(list[0]?.name).toBe("CI");
		// The list never carries the secret.
		expect(list[0]).not.toHaveProperty("plaintext");
		expect(list[0]).not.toHaveProperty("hashedKey");
	});

	it("scopes the list to the caller", async () => {
		await ownerCaller().apiKey.create({ name: "mine" });
		const otherList = await authedCaller({
			id: other.id,
			email: other.email,
		}).apiKey.list();
		expect(otherList).toHaveLength(0);
	});
});

describe("apiKey.revoke", () => {
	it("revokes the caller's own key", async () => {
		const created = await ownerCaller().apiKey.create({ name: "revoke-me" });
		const result = await ownerCaller().apiKey.revoke({
			apiKeyId: created.apiKeyId,
		});
		expect(result).toEqual({ success: true });

		const list = await ownerCaller().apiKey.list();
		expect(list[0]?.revokedAt).not.toBeNull();
	});

	it("rejects revoking another user's key with NOT_FOUND", async () => {
		const created = await ownerCaller().apiKey.create({ name: "owned" });
		await expect(
			authedCaller({ id: other.id, email: other.email }).apiKey.revoke({
				apiKeyId: created.apiKeyId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects an unknown key id with NOT_FOUND", async () => {
		await expect(
			ownerCaller().apiKey.revoke({ apiKeyId: "missing" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

it("creates the requested scope and only accepts expiry dates after today UTC", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  for (const expiresAt of ["2026-10-14T23:59:59.999Z", "2026-10-15T23:59:59.999Z"]) await expect(ownerCaller().apiKey.create({ name: "Expiry", expiresAt })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const expiresAt = "2026-10-16T23:59:59.999Z";
  expect(await ownerCaller().apiKey.create({ name: "Reader" })).toMatchObject({ scope: "read" });
  const created = await ownerCaller().apiKey.create({ name: "Writer", scope: "full", expiresAt });
  expect(created).toMatchObject({ scope: "full", expiresAt });
  expect(created).not.toHaveProperty("userId"); expect(created).not.toHaveProperty("hashedKey");
});
it("removes only an owned revoked key from lists while retaining its audit row", async () => {
  const { apiKey, db } = await import("@pulsy/db"); const { eq } = await import("drizzle-orm");
  const created = await ownerCaller().apiKey.create({ name: "Audit" });
  await expect(ownerCaller().apiKey.remove({ apiKeyId: created.apiKeyId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await ownerCaller().apiKey.revoke({ apiKeyId: created.apiKeyId });
  await expect(authedCaller(other).apiKey.remove({ apiKeyId: created.apiKeyId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await ownerCaller().apiKey.remove({ apiKeyId: created.apiKeyId })).toEqual({ success: true });
  expect(await ownerCaller().apiKey.list()).toEqual([]);
  const stored = await db.query.apiKey.findFirst({ where: eq(apiKey.apiKeyId, created.apiKeyId) });
  expect(stored!.removedAt).toBeTruthy(); expect(stored!.revokedAt).toBeTruthy(); expect(stored!.hashedKey).toBeTruthy();
  await expect(ownerCaller().apiKey.remove({ apiKeyId: created.apiKeyId })).rejects.toMatchObject({ code: "NOT_FOUND" });
});
