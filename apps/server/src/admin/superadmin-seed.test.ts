// DB-backed tests for the testable superadmin seeder core.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { user as userTable } from "@pulsy/db";

import { db, resetDb, createTestUser, createTestSuperadmin } from "../../test/db";
import { ensureSuperadmin, type SuperadminAuth } from "./superadmin-seed";

beforeEach(resetDb);

/** A fake better-auth whose signUpEmail inserts a plain user row. */
function authThatCreates(): SuperadminAuth {
	return {
		api: {
			signUpEmail: async ({ body }) => {
				await createTestUser({
					email: body.email,
					name: body.name,
					emailVerified: false,
				});
			},
		},
	};
}

/** A fake better-auth whose signUpEmail throws the given error. */
function authThatThrows(message: string): SuperadminAuth {
	return {
		api: {
			signUpEmail: async () => {
				throw new Error(message);
			},
		},
	};
}

/** A fake better-auth whose signUpEmail rejects with a non-Error value. */
function authThatThrowsNonError(value: unknown): SuperadminAuth {
	return {
		api: {
			signUpEmail: async () => {
				throw value;
			},
		},
	};
}

describe("ensureSuperadmin", () => {
	it("skips when the email is missing (default no-op logger)", async () => {
		const result = await ensureSuperadmin({
			db,
			auth: authThatCreates(),
			email: undefined,
			password: "pw",
		});
		expect(result.status).toBe("skipped");
	});

	it("skips when the password is missing", async () => {
		const log = vi.fn();
		const result = await ensureSuperadmin({
			db,
			auth: authThatCreates(),
			email: "admin@pulsy.test",
			password: undefined,
			log,
		});
		expect(result.status).toBe("skipped");
		expect(log).toHaveBeenCalled();
	});

	it("creates the account and promotes it to superadmin", async () => {
		const log = vi.fn();
		const result = await ensureSuperadmin({
			db,
			auth: authThatCreates(),
			email: "admin@pulsy.test",
			password: "pw",
			name: "Ops",
			log,
		});
		expect(result.status).toBe("created");
		const row = await db.query.user.findFirst({
			where: eq(userTable.email, "admin@pulsy.test"),
		});
		expect(row?.role).toBe("superadmin");
		expect(row?.emailVerified).toBe(true);
		expect(row?.name).toBe("Ops");
	});

	it("is a no-op when already a verified superadmin (default name)", async () => {
		await createTestSuperadmin({
			email: "admin@pulsy.test",
			emailVerified: true,
		});
		const result = await ensureSuperadmin({
			db,
			auth: authThatThrows("user already exists"),
			email: "admin@pulsy.test",
			password: "pw",
			log: vi.fn(),
		});
		expect(result.status).toBe("exists");
	});

	it("promotes an existing non-superadmin when sign-up reports it exists", async () => {
		await createTestUser({ email: "admin@pulsy.test", emailVerified: true });
		const result = await ensureSuperadmin({
			db,
			auth: authThatThrows("Email already exists"),
			email: "admin@pulsy.test",
			password: "pw",
			log: vi.fn(),
		});
		expect(result.status).toBe("promoted");
		const row = await db.query.user.findFirst({
			where: eq(userTable.email, "admin@pulsy.test"),
		});
		expect(row?.role).toBe("superadmin");
	});

	it("logs and proceeds when sign-up fails for a non-exists reason", async () => {
		await createTestUser({ email: "admin@pulsy.test" });
		const log = vi.fn();
		const result = await ensureSuperadmin({
			db,
			auth: authThatThrows("boom"),
			email: "admin@pulsy.test",
			password: "pw",
			log,
		});
		expect(result.status).toBe("promoted");
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("signUpEmail returned"),
		);
	});

	it("redacts a non-Error sign-up rejection", async () => {
		await createTestUser({ email: "admin@pulsy.test" });
		const log = vi.fn();
		const result = await ensureSuperadmin({
			db,
			auth: authThatThrowsNonError("plain string failure"),
			email: "admin@pulsy.test",
			password: "pw",
			log,
		});
		expect(result.status).toBe("promoted");
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("Unknown error"),
		);
		expect(JSON.stringify(log.mock.calls)).not.toContain("plain string failure");
	});

	it("throws when the user cannot be found after a failed sign-up", async () => {
		await expect(
			ensureSuperadmin({
				db,
				auth: authThatThrows("boom"),
				email: "ghost@pulsy.test",
				password: "pw",
				log: vi.fn(),
			}),
		).rejects.toThrow(/Could not find/);
	});
});
