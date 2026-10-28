import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { user } from "./auth";
import { uptimeMonitor } from "./uptime-monitor";

export const uptimeMaintenance = pgTable("uptime_maintenance", {
	id: text("id").primaryKey().$defaultFn(() => nanoid()),
	userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
	monitorIds: text("monitorIds").array().notNull(),
	kind: text("kind").$type<"maintenance" | "snooze">().notNull().default("maintenance"),
	name: text("name").notNull(),
	reason: text("reason").notNull().default(""),
	startsAt: text("startsAt").notNull(),
	endsAt: text("endsAt").notNull(),
	timezone: text("timezone").notNull().default("UTC"),
	recurrence: text("recurrence").$type<"once" | "daily" | "weekly">().notNull().default("once"),
	enabled: boolean("enabled").notNull().default(true),
	createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [index("uptime_maintenance_user_idx").on(table.userId), index("uptime_maintenance_active_idx").on(table.userId, table.enabled, table.endsAt)]);

export interface DeferredAlertSnapshot {
	statusChangeId: string; uptimeMonitorId: string; statusBefore: string; statusAfter: string;
	httpStatus: number | null; responseTime: number | null; reason: string | null; createdAt: string;
	/** Internal exact webhook bytes, committed before first transport. Never credentials. */
	webhookBodies?: Record<string, string>;
}

export const uptimeDeferredAlert = pgTable("uptime_deferred_alert", {
	id: text("id").primaryKey().$defaultFn(() => nanoid()),
	userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
	monitorId: text("monitorId").notNull().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
	statusChangeId: text("statusChangeId").notNull(),
  sourceOutageId: text("sourceOutageId"),
  policyReason: text("policyReason").$type<"maintenance" | "cooldown" | "informational" | "unannounced" | "superseded">(),
	snapshot: jsonb("snapshot").$type<DeferredAlertSnapshot>().notNull(),
	state: text("state").$type<"pending" | "processing" | "sent" | "failed" | "cancelled">().notNull().default("pending"),
	suppressionIds: text("suppressionIds").array().notNull(),
	finishedTargets: text("finishedTargets").array().notNull().default([]),
	// Opaque destination hashes distinguish changed addresses without storing credentials.
	deliveredTargets: text("deliveredTargets").array().notNull().default([]),
	historyPruned: boolean("historyPruned").notNull().default(false),
	dueAt: text("dueAt").notNull(),
	attempts: integer("attempts").notNull().default(0),
	createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [
	uniqueIndex("uptime_deferred_alert_change_idx").on(table.statusChangeId),
	index("uptime_deferred_alert_due_idx").on(table.state, table.dueAt),
	index("uptime_deferred_alert_user_idx").on(table.userId, table.monitorId),
	index("uptime_deferred_alert_episode_idx").on(table.userId, table.monitorId, table.sourceOutageId),
	index("uptime_deferred_alert_history_idx").on(table.createdAt),
]);
