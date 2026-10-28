import { boolean, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { user } from "./auth";

import type { MonitorViewFilters } from "./monitor-view";

export const uptimeMonitorView = pgTable("uptime_monitor_view", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  filters: jsonb("filters").$type<MonitorViewFilters>().notNull(),
  pinned: boolean("pinned").notNull().default(false),
  isDefault: boolean("isDefault").notNull().default(false),
  createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updatedAt").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [index("uptime_monitor_view_owner_idx").on(table.userId, table.isDefault)]);
