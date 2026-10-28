export const monitorTabs = ["overview", "incidents", "history", "alerts", "reports", "settings"] as const;
export type MonitorTab = typeof monitorTabs[number];
const aliases: Record<string, MonitorTab> = { notifications: "alerts", slaReport: "reports" };
export function canonicalMonitorTab(value: unknown): MonitorTab {
  if (typeof value === "string" && Object.hasOwn(aliases, value)) return aliases[value] ?? "overview";
  return monitorTabs.includes(value as MonitorTab) ? value as MonitorTab : "overview";
}
export function monitorTabSearch(search: Record<string, unknown>): Record<string, unknown> & { tab?: unknown } { return { ...search }; }
