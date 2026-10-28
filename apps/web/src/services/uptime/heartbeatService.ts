import { trpcMutation, trpcQuery } from "@/lib/api/trpc";
import type { HeartbeatConfiguration, HeartbeatCreated, HeartbeatRun, HeartbeatState } from "@/types/heartbeat";
import type { UptimeMonitor } from "@/types/uptime";
export const HeartbeatService = {
  create: (input: HeartbeatConfiguration) => trpcMutation<HeartbeatCreated>("uptimeMonitor", "heartbeat.create", input),
  one: (monitorId: string) => trpcQuery<HeartbeatState>("uptimeMonitor", "heartbeat.one", { monitorId }),
  runs: (monitorId: string) => trpcQuery<HeartbeatRun[]>("uptimeMonitor", "heartbeat.runs", { monitorId }),
  update: (monitorId: string, input: HeartbeatConfiguration) => trpcMutation<UptimeMonitor>("uptimeMonitor", "heartbeat.update", { monitorId, ...input }),
  rotate: (monitorId: string) => trpcMutation<{ token: string }>("uptimeMonitor", "heartbeat.rotate", { monitorId }),
  reveal: (monitorId: string) => trpcMutation<{ token: string | null }>("uptimeMonitor", "heartbeat.reveal", { monitorId }),
};
