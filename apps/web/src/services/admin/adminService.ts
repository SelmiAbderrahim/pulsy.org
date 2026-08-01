/**
 * Admin service — thin typed wrappers over the `admin.*` tRPC procedures.
 * Mirrors the uptime service-layer pattern.
 *
 * @module services/admin/adminService
 */

import { trpcMutation, trpcQuery } from "@/lib/api/trpc";
import type {
	AdminStats,
	AdminUserDetail,
	AdminUserList,
	AdminUsersListInput,
	PlatformRole,
} from "@/types/admin";

export const AdminService = {
	statsOverview(): Promise<AdminStats> {
		return trpcQuery<AdminStats>("admin", "stats.overview");
	},

	listUsers(input: AdminUsersListInput): Promise<AdminUserList> {
		return trpcQuery<AdminUserList>("admin", "users.list", input);
	},

	getUser(userId: string): Promise<AdminUserDetail> {
		return trpcQuery<AdminUserDetail>("admin", "users.one", { userId });
	},

	setRole(userId: string, role: PlatformRole): Promise<unknown> {
		return trpcMutation("admin", "users.setRole", { userId, role });
	},

	banUser(userId: string, reason?: string): Promise<unknown> {
		return trpcMutation("admin", "users.ban", { userId, reason });
	},

	unbanUser(userId: string): Promise<unknown> {
		return trpcMutation("admin", "users.unban", { userId });
	},

	deleteUser(userId: string): Promise<unknown> {
		return trpcMutation("admin", "users.delete", { userId });
	},
};
