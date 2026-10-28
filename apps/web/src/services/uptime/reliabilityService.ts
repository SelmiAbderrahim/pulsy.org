import { trpcMutation, trpcQuery } from "@/lib/api/trpc";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@pulsy/server/trpc";
type Inputs = inferRouterInputs<AppRouter>["uptimeMonitor"]["reliability"];
type Outputs = inferRouterOutputs<AppRouter>["uptimeMonitor"]["reliability"];
export type ReliabilityView = Outputs["read"];
export type ReliabilityConfiguration = Inputs["configure"]["configuration"];
export type ReliabilityIncidentCursor = NonNullable<Inputs["incidents"]["cursor"]>;
export type ReliabilityCursor = NonNullable<Inputs["annotations"]["cursor"]>;
export const ReliabilityService = {
  read: (monitorId: string, window: Inputs["read"]["window"]) => trpcQuery<Outputs["read"]>("uptimeMonitor", "reliability.read", { monitorId, window }),
  configure: (monitorId: string, configuration: ReliabilityConfiguration) => trpcMutation<Outputs["configure"]>("uptimeMonitor", "reliability.configure", { monitorId, configuration }),
  annotate: (monitorId: string, annotation: Inputs["annotate"]["annotation"]) => trpcMutation<Outputs["annotate"]>("uptimeMonitor", "reliability.annotate", { monitorId, annotation }),
  annotations: (monitorId: string, window: Inputs["annotations"]["window"], cursor?: ReliabilityCursor) => trpcQuery<Outputs["annotations"]>("uptimeMonitor", "reliability.annotations", { monitorId, window, cursor, limit: 25 }),
  incidents: (monitorId: string, window: Inputs["incidents"]["window"], cursor?: ReliabilityIncidentCursor) => trpcQuery<Outputs["incidents"]>("uptimeMonitor", "reliability.incidents", { monitorId, window, cursor, limit: 25 }),
  policies: (monitorId: string, beforeVersion?: number) => trpcQuery<Outputs["policies"]>("uptimeMonitor", "reliability.policies", { monitorId, beforeVersion, limit: 25 }),
};
