import { trpcMutation, trpcQuery } from "@/lib/api/trpc";
import type { ServerConfiguration, ServerCreated, ServerMetric, ServerState } from "@/types/server-health";
import type { UptimeMonitor } from "@/types/uptime";
export const ServerHealthService = {
  create: (input: ServerConfiguration) => trpcMutation<ServerCreated>("uptimeMonitor", "server.create", input),
  one: (monitorId: string) => trpcQuery<ServerState>("uptimeMonitor", "server.one", { monitorId }),
  history: (monitorId: string, hours: number) => trpcQuery<ServerMetric[]>("uptimeMonitor", "server.history", { monitorId, from: new Date(Date.now() - hours * 3600000).toISOString(), to: new Date().toISOString(), limit: 1000 }),
  update: (monitorId: string, input: ServerConfiguration) => trpcMutation<UptimeMonitor>("uptimeMonitor", "server.update", { monitorId, ...input }),
  rotate: (monitorId: string) => trpcMutation<{ token: string }>("uptimeMonitor", "server.rotate", { monitorId }),
};
