import { trpcMutation, trpcQuery } from "@/lib/api/trpc";
import type { IncidentResponseDetail, IncidentWorkspaceFilters, IncidentWorkspacePage, IncidentCursor } from "@/types/incident-workspace";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@pulsy/server/trpc";
export const IncidentWorkspaceService = {
  list: (filters: IncidentWorkspaceFilters, cursor?: IncidentCursor) => trpcQuery<IncidentWorkspacePage>("uptimeMonitor", "incidentWorkspace.list", { state: filters.state, search: filters.search, monitorId: filters.monitorId, severity: filters.severity, groupId: filters.groupId, limit: 25, cursor }),
  one: (incidentId: string) => trpcQuery<IncidentResponseDetail>("uptimeMonitor", "incidentWorkspace.one", { incidentId }),
  acknowledge: (incidentId: string) => trpcMutation<{ acknowledged: boolean }>("uptimeMonitor", "incidentWorkspace.acknowledge", { incidentId }),
  unacknowledge: (incidentId: string) => trpcMutation<{ acknowledged: boolean }>("uptimeMonitor", "incidentWorkspace.unacknowledge", { incidentId }),
  note: (incidentId: string, text: string) => trpcMutation<{ saved: boolean }>("uptimeMonitor", "incidentWorkspace.note", { incidentId, text }),
  runbook: (incidentId: string, description: string, url: string, expected?: { description: string; url: string | null }) => trpcMutation<{ saved: boolean }>("uptimeMonitor", "incidentWorkspace.runbook", { incidentId, description, url: url || undefined, expected }),
  group: (name: string, incidentIds: string[]) => trpcMutation<{ id: string; name: string }>("uptimeMonitor", "incidentWorkspace.group", { name, incidentIds }),
  channels: (cursor?: string) => trpcQuery<inferRouterOutputs<AppRouter>["uptimeMonitor"]["incidentWorkspace"]["channels"]>("uptimeMonitor", "incidentWorkspace.channels", { cursor }),
  escalation: (incidentId: string, steps: { channelId: string; afterSeconds: number }[]) => trpcMutation<{ configured: boolean }>("uptimeMonitor", "incidentWorkspace.escalation", { incidentId, steps }),
  cancelEscalation: (incidentId: string) => trpcMutation<{ cancelled: boolean }>("uptimeMonitor", "incidentWorkspace.cancelEscalation", { incidentId }),
};
