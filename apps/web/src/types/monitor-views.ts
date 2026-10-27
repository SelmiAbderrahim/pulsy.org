export interface MonitorViewFilters {
  search: string; tags: string[]; tagMode: "any" | "all";
  health: "all" | "up" | "down" | "degraded" | "pending";
  sort: "status" | "name" | "response" | "uptime"; direction: "asc" | "desc";
  density: "comfortable" | "compact"; group: "none" | "tag" | "environment";
}
export interface MonitorView { id: string; name: string; filters: MonitorViewFilters; pinned: boolean; isDefault: boolean; createdAt: string; updatedAt: string }
