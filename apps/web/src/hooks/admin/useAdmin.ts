/**
 * Admin React Query hooks for the /superadmin panel.
 *
 * @module hooks/admin/useAdmin
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AdminService } from "@/services/admin/adminService";
import type { AdminUsersListInput, PlatformRole } from "@/types/admin";
import { adminKeys } from "./queryKeys";

const STALE = 30_000;

export function useAdminStats() {
	return useQuery({
		queryKey: adminKeys.stats(),
		queryFn: () => AdminService.statsOverview(),
		staleTime: STALE,
	});
}

export function useAdminUsers(input: AdminUsersListInput) {
	return useQuery({
		queryKey: adminKeys.users.list(input),
		queryFn: () => AdminService.listUsers(input),
		staleTime: STALE,
	});
}

export function useAdminUser(userId: string | null) {
	return useQuery({
		queryKey: adminKeys.users.detail(userId ?? ""),
		queryFn: () => AdminService.getUser(userId as string),
		enabled: Boolean(userId),
		staleTime: STALE,
	});
}

/** Invalidate everything user-related (lists + detail + stats). */
function useInvalidateUsers() {
	const qc = useQueryClient();
	return () => {
		void qc.invalidateQueries({ queryKey: adminKeys.users.all() });
		void qc.invalidateQueries({ queryKey: adminKeys.stats() });
	};
}

export function useSetUserRole() {
	const invalidate = useInvalidateUsers();
	return useMutation({
		mutationFn: ({ userId, role }: { userId: string; role: PlatformRole }) =>
			AdminService.setRole(userId, role),
		onSuccess: invalidate,
	});
}

export function useBanUser() {
	const invalidate = useInvalidateUsers();
	return useMutation({
		mutationFn: ({ userId, reason }: { userId: string; reason?: string }) =>
			AdminService.banUser(userId, reason),
		onSuccess: invalidate,
	});
}

export function useUnbanUser() {
	const invalidate = useInvalidateUsers();
	return useMutation({
		mutationFn: (userId: string) => AdminService.unbanUser(userId),
		onSuccess: invalidate,
	});
}

export function useDeleteUser() {
	const invalidate = useInvalidateUsers();
	return useMutation({
		mutationFn: (userId: string) => AdminService.deleteUser(userId),
		onSuccess: invalidate,
	});
}
