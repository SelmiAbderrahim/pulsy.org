import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminService } from "@/services/admin/adminService";
import { createWrapper } from "@/test/query-wrapper";

import {
	useAdminStats,
	useAdminUser,
	useAdminUsers,
	useBanUser,
	useDeleteUser,
	useSetUserRole,
	useUnbanUser,
} from "./useAdmin";

vi.mock("@/services/admin/adminService", () => ({
	AdminService: {
		statsOverview: vi.fn(),
		listUsers: vi.fn(),
		getUser: vi.fn(),
		setRole: vi.fn(),
		banUser: vi.fn(),
		unbanUser: vi.fn(),
		deleteUser: vi.fn(),
	},
}));

const svc = vi.mocked(AdminService);
const USERS_INPUT = { limit: 25, offset: 0 };

beforeEach(() => {
	vi.clearAllMocks();
});

describe("admin query hooks", () => {
	it("useAdminStats fetches the overview", async () => {
		svc.statsOverview.mockResolvedValue({} as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useAdminStats(), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.statsOverview).toHaveBeenCalled();
	});

	it("useAdminUsers fetches the user list", async () => {
		svc.listUsers.mockResolvedValue({ items: [], total: 0 } as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useAdminUsers(USERS_INPUT), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.listUsers).toHaveBeenCalledWith(USERS_INPUT);
	});

	it("useAdminUser fetches a user when an id is given", async () => {
		svc.getUser.mockResolvedValue({} as never);
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useAdminUser("u1"), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(svc.getUser).toHaveBeenCalledWith("u1");
	});

	it("useAdminUser is disabled when id is null", () => {
		const { Wrapper } = createWrapper();
		const { result } = renderHook(() => useAdminUser(null), {
			wrapper: Wrapper,
		});
		expect(result.current.fetchStatus).toBe("idle");
		expect(svc.getUser).not.toHaveBeenCalled();
	});
});

describe("admin mutation hooks", () => {
	it("useSetUserRole mutates and invalidates", async () => {
		svc.setRole.mockResolvedValue(undefined as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useSetUserRole(), { wrapper: Wrapper });
		await act(async () => {
			await result.current.mutateAsync({ userId: "u1", role: "superadmin" });
		});
		expect(svc.setRole).toHaveBeenCalledWith("u1", "superadmin");
		expect(spy).toHaveBeenCalled();
	});

	it("useBanUser mutates and invalidates", async () => {
		svc.banUser.mockResolvedValue(undefined as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useBanUser(), { wrapper: Wrapper });
		await act(async () => {
			await result.current.mutateAsync({ userId: "u1", reason: "spam" });
		});
		expect(svc.banUser).toHaveBeenCalledWith("u1", "spam");
		expect(spy).toHaveBeenCalled();
	});

	it("useUnbanUser mutates and invalidates", async () => {
		svc.unbanUser.mockResolvedValue(undefined as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useUnbanUser(), { wrapper: Wrapper });
		await act(async () => {
			await result.current.mutateAsync("u1");
		});
		expect(svc.unbanUser).toHaveBeenCalledWith("u1");
		expect(spy).toHaveBeenCalled();
	});

	it("useDeleteUser mutates and invalidates", async () => {
		svc.deleteUser.mockResolvedValue(undefined as never);
		const { Wrapper, client } = createWrapper();
		const spy = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useDeleteUser(), { wrapper: Wrapper });
		await act(async () => {
			await result.current.mutateAsync("u1");
		});
		expect(svc.deleteUser).toHaveBeenCalledWith("u1");
		expect(spy).toHaveBeenCalled();
	});
});
