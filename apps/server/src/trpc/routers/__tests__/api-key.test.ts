import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
	process.env = { ...originalEnv };
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
