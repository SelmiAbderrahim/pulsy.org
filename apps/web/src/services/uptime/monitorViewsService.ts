import { trpcMutation, trpcQuery } from "@/lib/api/trpc";
import type { MonitorView, MonitorViewFilters } from "@/types/monitor-views";
export const MonitorViewsService = {
  initial: (id?:string) => trpcQuery<MonitorView|null>("uptimeMonitor", "view.initial", {id}),
  list: () => trpcQuery<MonitorView[]>("uptimeMonitor", "view.list"),
  save: (input: { id?: string; name: string; filters: MonitorViewFilters; pinned: boolean; isDefault: boolean }) => trpcMutation<MonitorView>("uptimeMonitor", "view.save", input),
  remove: (id: string) => trpcMutation("uptimeMonitor", "view.remove", { id }),
};
