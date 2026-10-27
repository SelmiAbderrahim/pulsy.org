import { isSessionClientActive } from "@/lib/session-query-client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@pulsy/server/trpc";
type Outputs = inferRouterOutputs<AppRouter>["uptimeMonitor"]["incidentWorkspace"];
type Inputs = inferRouterInputs<AppRouter>["uptimeMonitor"]["incidentWorkspace"];
export type IncidentWorkspacePage = Outputs["list"];
export type IncidentResponseDetail = Outputs["one"];
export type IncidentWorkspaceFilters = Omit<Inputs["list"], "limit" | "cursor">;
export type IncidentCursor = NonNullable<Inputs["list"]["cursor"]>;
