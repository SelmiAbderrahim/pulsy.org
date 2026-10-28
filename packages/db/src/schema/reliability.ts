import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { user } from "./auth";
import { uptimeMonitor, uptimeCheckLog } from "./uptime-monitor";
import type { CapturedReliabilityObservation, ReliabilityBucket } from "./validation-reliability";
export const uptimeReliabilityPolicy = pgTable("uptime_reliability_policy", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  monitorId: text("monitorId").notNull().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
  version: integer("version").notNull(), availabilityTargetBps: integer("availabilityTargetBps"), latencyTargetMs: integer("latencyTargetMs"),
  excludeMaintenance: boolean("excludeMaintenance").notNull().default(false),
  createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
  firstObservedAt: text("firstObservedAt"),
}, table => [uniqueIndex("uptime_reliability_policy_owner_version_idx").on(table.userId, table.monitorId, table.version)]);
export const uptimeReliabilityCursor = pgTable("uptime_reliability_cursor", {
  monitorId: text("monitorId").primaryKey().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  checkId: text("checkId").notNull().references(() => uptimeCheckLog.checkLogId, { onDelete: "cascade" }),
  observation: jsonb("observation").$type<CapturedReliabilityObservation>().notNull(),
}, table => [index("uptime_reliability_cursor_owner_idx").on(table.userId)]);
export const uptimeReliabilityDay = pgTable("uptime_reliability_day", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  monitorId: text("monitorId").notNull().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
  day: text("day").notNull(), bucket: jsonb("bucket").$type<ReliabilityBucket>().notNull(),
  updatedAt: text("updatedAt").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [uniqueIndex("uptime_reliability_day_owner_idx").on(table.userId, table.monitorId, table.day), index("uptime_reliability_day_retention_idx").on(table.userId, table.day)]);
export const uptimeReliabilityAnnotation = pgTable("uptime_reliability_annotation", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  monitorId: text("monitorId").notNull().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
  actorId: text("actorId").notNull().references(() => user.id, { onDelete: "cascade" }),
  at: text("at").notNull(), environment: text("environment").notNull().default(""), version: text("version").notNull().default(""), text: text("text").notNull(), link: text("link"),
  createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [index("uptime_reliability_annotation_owner_idx").on(table.userId, table.monitorId, table.at, table.id)]);
