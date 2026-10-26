import { z } from "zod";

export const apiMonitorViewFilters = z.object({
  search: z.string().max(100).default(""),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).transform(tags => [...new Set(tags)]).default([]),
  tagMode: z.enum(["any", "all"]).default("any"),
  health: z.enum(["all", "up", "down", "degraded", "pending"]).default("all"),
  sort: z.enum(["status", "name", "response", "uptime"]).default("status"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
  group: z.enum(["none", "tag", "environment"]).default("none"),
}).strict();
export type MonitorViewFilters = z.infer<typeof apiMonitorViewFilters>;
export const apiSaveMonitorView = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(80),
  filters: apiMonitorViewFilters,
  pinned: z.boolean().optional(), isDefault: z.boolean().optional(),
}).strict();

