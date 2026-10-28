import { boolean, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { user } from "./auth";
import { uptimeMonitor, uptimeNotificationChannel } from "./uptime-monitor";

import type { MonitorTemplateConfiguration } from "./monitor-template";

export const uptimeMonitorTemplate = pgTable("uptime_monitor_template", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  configuration: jsonb("configuration").$type<MonitorTemplateConfiguration>().notNull(),
  needsRequestValues: boolean("needsRequestValues").notNull().default(false),
  createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updatedAt").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [index("uptime_monitor_template_owner_idx").on(table.userId)]);

// References reuse an existing owned channel; credentials and recipients stay there.
export const uptimeMonitorChannelBinding = pgTable("uptime_monitor_channel_binding", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  monitorId: text("monitorId").notNull().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
  channelId: text("channelId").notNull().references(() => uptimeNotificationChannel.channelId, { onDelete: "cascade" }),
}, table => [uniqueIndex("uptime_monitor_channel_binding_unique").on(table.monitorId, table.channelId), index("uptime_monitor_channel_binding_owner_idx").on(table.userId, table.monitorId)]);
