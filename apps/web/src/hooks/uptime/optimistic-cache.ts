import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { UptimeMonitor, UptimeDashboardSummary } from "@/types/uptime";
import { uptimeKeys } from "./queryKeys";
import { summarizeMonitors } from "@/lib/uptime/monitor-summary";

/** Patch both list and detail caches before a mutation. The dashboard card
 * derives its counters from this list cache, so both move together. The undo function is scoped to the affected ids. */
export async function changeCachedMonitors(client: QueryClient, ids: string[], change: (row: UptimeMonitor) => UptimeMonitor | null) {
  const selected = new Set(ids);
  const listKey=uptimeKeys.monitors.lists();
  const summaryKey=uptimeKeys.dashboard.summary();
  await Promise.all([listKey,summaryKey,...ids.map(uptimeKeys.monitors.detail)].map(queryKey=>client.cancelQueries({queryKey})));
  const previous=client.getQueryData<UptimeMonitor[]>(listKey);
  const details=ids.map(id=>[id,client.getQueryData<UptimeMonitor>(uptimeKeys.monitors.detail(id))] as const);
  function updateSummary(rows: UptimeMonitor[] | undefined) {
    if(!rows) return;
    const measured=rows.filter(row=>row.responseTime !== null);
    client.setQueryData<UptimeDashboardSummary>(summaryKey, summary=>summary ? {...summary,...summarizeMonitors(rows),
      activeMonitors:rows.filter(row=>row.active).length,
      avgResponseTime:measured.length ? Math.round(measured.reduce((sum,row)=>sum+(row.responseTime??0),0)/measured.length) : null,
    } : summary);
  }
  const next=previous?.flatMap(row=>selected.has(row.uptimeMonitorId) ? (change(row) ?? []) : row);
  if(next) client.setQueryData(listKey,next);
  for(const [id,row] of details) if(row) { const next=change(row); if(next) client.setQueryData(uptimeKeys.monitors.detail(id),next); }
  updateSummary(next);
  return (restoreIds=ids) => {
    const restore=new Set(restoreIds);
    if(previous) {
      client.setQueryData<UptimeMonitor[]>(listKey, rows=>[
        ...(rows??[]).filter(row=>!restore.has(row.uptimeMonitorId)),...previous.filter(row=>restore.has(row.uptimeMonitorId)),
      ]);
      updateSummary(client.getQueryData(listKey));
    }
    for(const [id,row] of details) if(row && restore.has(id)) client.setQueryData(uptimeKeys.monitors.detail(id),row);
  };
}

/** Insert just-created monitors into the shared list snapshot before the
 * refetch lands, so Total and the list grow together. */
export function addCachedMonitors(client: QueryClient, created: UptimeMonitor[]) {
  const listKey=uptimeKeys.monitors.lists();
  const rows=client.getQueryData<UptimeMonitor[]>(listKey);
  if(!rows) return;
  const known=new Set(rows.map(row=>row.uptimeMonitorId));
  const added=created.filter(row=>!known.has(row.uptimeMonitorId)).map(row=>({overrideChannelCount:0,heartbeat:null,alertSuppression:null,...row,uptimePercentage:null,uptimeChecks:0}));
  if(!added.length) return;
  client.setQueryData<UptimeMonitor[]>(listKey,[...rows,...added]);
}

/** Cancel stale reads before hiding rows; restore only this operation's rows. */
export async function removeCachedRows<T>(client: QueryClient, key: QueryKey, matches: (row: T) => boolean) {
  await client.cancelQueries({queryKey:key});
  const previous = client.getQueryData<T[]>(key);
  client.setQueryData<T[]>(key, rows => rows?.filter(row => !matches(row)));
  return () => {
    if (!previous) return;
    client.setQueryData<T[]>(key, rows => {
      if (!rows) return previous;
      return [...rows.filter(row => !matches(row)), ...previous.filter(matches)];
    });
  };
}
