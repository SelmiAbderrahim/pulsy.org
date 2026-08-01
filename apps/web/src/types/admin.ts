/**
 * Admin (/superadmin) types, inferred straight from the server's `admin.*`
 * router so the client never drifts from the API shape.
 *
 * @module types/admin
 */

import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@pulsy/server/trpc";

type Outputs = inferRouterOutputs<AppRouter>["admin"];
type Inputs = inferRouterInputs<AppRouter>["admin"];

export type AdminStats = Outputs["stats"]["overview"];

export type AdminUserList = Outputs["users"]["list"];
export type AdminUserListItem = AdminUserList["items"][number];
export type AdminUserDetail = Outputs["users"]["one"];

export type AdminUsersListInput = Inputs["users"]["list"];

export type PlatformRole = "user" | "superadmin";
