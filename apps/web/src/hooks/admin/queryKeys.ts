/**
 * Admin React Query key factory. Always use this factory; never ad-hoc keys.
 *
 * @module hooks/admin/queryKeys
 */

import type { AdminUsersListInput } from "@/types/admin";

export const adminKeys = {
	all: () => ["admin"] as const,

	stats: () => [...adminKeys.all(), "stats"] as const,

	users: {
		all: () => [...adminKeys.all(), "users"] as const,
		list: (input: AdminUsersListInput) =>
			[...adminKeys.users.all(), "list", input] as const,
		detail: (userId: string) =>
			[...adminKeys.users.all(), "detail", userId] as const,
	},
} as const;
