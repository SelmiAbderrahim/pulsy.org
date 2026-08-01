import { beforeEach, describe, expect, it, vi } from "vitest";

import { trpcMutation, trpcQuery } from "@/lib/api/trpc";

import { AdminService } from "./adminService";

vi.mock("@/lib/api/trpc", () => ({
	trpcQuery: vi.fn(),
	trpcMutation: vi.fn(),
}));

const mockQuery = vi.mocked(trpcQuery);
const mockMutation = vi.mocked(trpcMutation);

beforeEach(() => {
	vi.clearAllMocks();
	mockQuery.mockResolvedValue(undefined as never);
	mockMutation.mockResolvedValue(undefined as never);
});

describe("AdminService", () => {
	it("statsOverview queries admin stats.overview", async () => {
		await AdminService.statsOverview();
		expect(mockQuery).toHaveBeenCalledWith("admin", "stats.overview");
	});

	it("listUsers queries admin users.list with input", async () => {
		await AdminService.listUsers({ limit: 25, offset: 0 });
		expect(mockQuery).toHaveBeenCalledWith("admin", "users.list", {
			limit: 25,
			offset: 0,
		});
	});

	it("getUser queries admin users.one", async () => {
		await AdminService.getUser("u1");
		expect(mockQuery).toHaveBeenCalledWith("admin", "users.one", {
			userId: "u1",
		});
	});

	it("setRole mutates admin users.setRole", async () => {
		await AdminService.setRole("u1", "superadmin");
		expect(mockMutation).toHaveBeenCalledWith("admin", "users.setRole", {
			userId: "u1",
			role: "superadmin",
		});
	});

	it("banUser mutates admin users.ban", async () => {
		await AdminService.banUser("u1", "spam");
		expect(mockMutation).toHaveBeenCalledWith("admin", "users.ban", {
			userId: "u1",
			reason: "spam",
		});
	});

	it("unbanUser mutates admin users.unban", async () => {
		await AdminService.unbanUser("u1");
		expect(mockMutation).toHaveBeenCalledWith("admin", "users.unban", {
			userId: "u1",
		});
	});

	it("deleteUser mutates admin users.delete", async () => {
		await AdminService.deleteUser("u1");
		expect(mockMutation).toHaveBeenCalledWith("admin", "users.delete", {
			userId: "u1",
		});
	});
});
