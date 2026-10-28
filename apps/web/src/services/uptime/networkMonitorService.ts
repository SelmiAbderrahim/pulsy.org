import { trpcMutation } from "@/lib/api/trpc";
import type { NetworkMonitorInput } from "@pulsy/db/validation-network";
import type { UptimeMonitor } from "@/types/uptime";
export const NetworkMonitorService = {
  create: (input: NetworkMonitorInput) => trpcMutation<UptimeMonitor>("uptimeMonitor", "network.create", input),
  update: (monitorId: string, input: NetworkMonitorInput) => trpcMutation<UptimeMonitor>("uptimeMonitor", "network.update", { ...input, monitorId }),
};
