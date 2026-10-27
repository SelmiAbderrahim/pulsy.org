export interface MaintenanceConfig {
  name: string;
  reason: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  recurrence: "once" | "daily" | "weekly";
}
export interface MaintenanceOccurrence { startsAt: string; endsAt: string }
export interface MaintenanceWindow extends MaintenanceConfig {
  id: string;
  kind: "maintenance" | "snooze";
  monitorIds: string[];
  enabled: boolean;
  occurrences: MaintenanceOccurrence[];
  suppression: { ids: string[]; until: string; maintenance: boolean } | null;
}
