import { trpcMutation, trpcQuery } from "@/lib/api/trpc";
import type { MonitorCreationDraft, MonitorTemplate, TemplateChannelOption } from "@/types/monitor-templates";
export const MonitorTemplatesService = {
  list: () => trpcQuery<MonitorTemplate[]>("uptimeMonitor", "template.list"),
  channels: () => trpcQuery<TemplateChannelOption[]>("uptimeMonitor", "template.channels"),
  fromMonitor: (monitorId: string) => trpcQuery<MonitorCreationDraft>("uptimeMonitor", "template.fromMonitor", { monitorId }),
  save: (input: MonitorCreationDraft & { id?: string }) => trpcMutation<MonitorTemplate>("uptimeMonitor", "template.save", input),
  detachChannel: (monitorId: string, channelId: string) => trpcMutation("uptimeMonitor", "template.detachChannel", { monitorId, channelId }),
  remove: (id: string) => trpcMutation("uptimeMonitor", "template.remove", { id }),
};
