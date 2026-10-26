import { bigint, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import type { z } from "zod";
import { user } from "./auth";
import { uptimeMonitor } from "./uptime-monitor";

import { apiServerThresholds, type ServerSample, type ServerCondition } from "./validation-server";
export * from "./validation-server";

/** Secrets never live on the generic monitor row or its public serializers. */
export const uptimeServer = pgTable("uptime_server", {
  monitorId: text("monitorId").primaryKey().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  tokenHash: text("tokenHash").notNull(), tokenCipher: text("tokenCipher").notNull(),
  locale: text("locale").$type<"en" | "ar" | "fr" | "de" | "es">().notNull().default("en"),
  thresholds: jsonb("thresholds").$type<z.infer<typeof apiServerThresholds>>().notNull(),
  excludedFilesystems: jsonb("excludedFilesystems").$type<string[]>().notNull().default([]),
  conditions: jsonb("conditions").$type<ServerCondition[]>().notNull().default([]),
  missingHealthy: integer("missingHealthy").notNull().default(0),
  lastReceivedAt: text("lastReceivedAt"), lastSampledAt: text("lastSampledAt"),
  lastBootId: text("lastBootId"), lastSequence: bigint("lastSequence", { mode: "number" }),
  nextDeadline: text("nextDeadline"),
  agent: jsonb("agent").$type<ServerSample["agent"]>(),
  rateWindowAt: text("rateWindowAt"), rateCount: integer("rateCount").notNull().default(0),
}, table => [uniqueIndex("uptime_server_token_idx").on(table.tokenHash), index("uptime_server_owner_idx").on(table.userId, table.monitorId), index("uptime_server_deadline_idx").on(table.nextDeadline)]);

export const uptimeServerMetric = pgTable("uptime_server_metric", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  monitorId: text("monitorId").notNull().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  receivedAt: text("receivedAt").notNull(),
  sample: jsonb("sample").$type<ServerSample>().notNull(),
}, table => [index("uptime_server_metric_history_idx").on(table.userId, table.monitorId, table.receivedAt), index("uptime_server_metric_retention_idx").on(table.userId, table.receivedAt)]);
