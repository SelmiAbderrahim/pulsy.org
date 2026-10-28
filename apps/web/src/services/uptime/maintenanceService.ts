import { trpcMutation, trpcQuery } from "@/lib/api/trpc";
import type { MaintenanceConfig, MaintenanceOccurrence, MaintenanceWindow } from "@/types/maintenance";

export const MaintenanceService = {
  list: () => trpcQuery<MaintenanceWindow[]>("uptimeMonitor", "maintenance.list"),
  preview: (config: MaintenanceConfig) => trpcQuery<MaintenanceOccurrence[]>("uptimeMonitor", "maintenance.preview", config),
  create: (input: { config: MaintenanceConfig; monitorIds: string[] }) => trpcMutation("uptimeMonitor", "maintenance.create", input),
  update: (input: { id: string; config: MaintenanceConfig; expected: MaintenanceConfig }) => trpcMutation("uptimeMonitor", "maintenance.update", input),
  snooze: (input: { monitorIds: string[]; endsAt: string; reason: string }) => trpcMutation("uptimeMonitor", "maintenance.snooze", input),
  cancel: (id: string) => trpcMutation("uptimeMonitor", "maintenance.cancel", { id }),
  resume: (monitorIds: string[]) => trpcMutation("uptimeMonitor", "maintenance.resumeSnooze", { monitorIds }),
};
