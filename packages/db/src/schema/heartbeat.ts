import { bigint, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { user } from "./auth";
import { uptimeMonitor } from "./uptime-monitor";

const id = z.string().min(1).max(64);
export const apiHeartbeatConfiguration = z.object({
  name: z.string().trim().min(1).max(200),
  interval: z.number().int().min(30).max(604800),
  graceSeconds: z.number().int().min(0).max(604800),
  active: z.boolean().default(true),
  tags: z.array(z.string().min(1).max(64)).max(50).default([]),
}).strict();
export const apiHeartbeatId = z.object({ monitorId: id }).strict();
// Deliberately no free-form log/message/URL fields.
export const apiHeartbeatReceipt = z.object({
  runId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/).optional(),
  metadata: z.object({
    environment: z.string().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/).optional(),
    version: z.string().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/).optional(),
  }).strict().optional(),
}).strict();
export type HeartbeatReceipt = z.infer<typeof apiHeartbeatReceipt>;
export const uptimeHeartbeat = pgTable("uptime_heartbeat", {
  monitorId: text("monitorId").primaryKey().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  tokenHash: text("tokenHash").notNull(),
  // Nullable for existing hash-only credentials; rotation enables owner reveal.
  tokenCipher: text("tokenCipher"),
  graceSeconds: integer("graceSeconds").notNull(),
  expectedAt: text("expectedAt").notNull(),
  nextDeadline: text("nextDeadline"),
  lastReceivedAt: text("lastReceivedAt"),
  lastSuccessAt: text("lastSuccessAt"),
  lastFailAt: text("lastFailAt"),
  currentRunId: text("currentRunId"),
  lastRunDurationMs: bigint("lastRunDurationMs", { mode: "number" }),
  rateWindowAt: text("rateWindowAt"),
  rateCount: integer("rateCount").notNull().default(0),
  lastSampleAt: text("lastSampleAt"),
  runCount: integer("runCount").notNull().default(0),
}, table => [uniqueIndex("uptime_heartbeat_token_hash_idx").on(table.tokenHash), index("uptime_heartbeat_owner_idx").on(table.userId), index("uptime_heartbeat_deadline_idx").on(table.nextDeadline)]);
export const uptimeHeartbeatRun = pgTable("uptime_heartbeat_run", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  monitorId: text("monitorId").notNull().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  runId: text("runId").notNull(),
  startedAt: text("startedAt").notNull(),
  finishedAt: text("finishedAt"),
  outcome: text("outcome").$type<"running" | "success" | "fail" | "superseded">().notNull(),
  metadata: jsonb("metadata").$type<NonNullable<HeartbeatReceipt["metadata"]>>(),
}, table => [uniqueIndex("uptime_heartbeat_run_key_idx").on(table.monitorId, table.runId), index("uptime_heartbeat_run_history_idx").on(table.userId, table.monitorId, table.startedAt)]);
