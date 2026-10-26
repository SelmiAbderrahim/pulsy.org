import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { user } from "./auth";
import { uptimeIncident, uptimeMonitor } from "./uptime-monitor";

const id = z.string().min(1).max(64);
export const apiIncidentIdentity = z.object({ incidentId: id }).strict();
export const apiIncidentWorkspaceList = z.object({
  state: z.enum(["all", "open", "acknowledged", "resolved"]).default("open"),
  search: z.string().max(100).default(""), monitorId: id.optional(),
  severity: z.enum(["critical", "warning", "informational"]).optional(), groupId: id.optional(),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.object({ startedAt: z.string().datetime(), incidentId: id }).strict().optional(),
}).strict();
export const apiIncidentNote = apiIncidentIdentity.extend({ text: z.string().trim().min(1).max(2000) });
export const apiIncidentRunbook = apiIncidentIdentity.extend({
  description: z.string().max(2000).default(""), url: z.string().max(1000).optional(),
  expected: z.object({ description: z.string().max(2000), url: z.string().max(1000).nullable() }).strict().optional(),
});
export const apiIncidentGroup = z.object({ name: z.string().trim().min(1).max(80), incidentIds: z.array(id).min(2).max(100).refine(ids => new Set(ids).size === ids.length) }).strict();
export const apiIncidentEscalation = apiIncidentIdentity.extend({ steps: z.array(z.object({ channelId: id, afterSeconds: z.number().int().min(60).max(86400) }).strict()).min(1).max(2).refine(steps => new Set(steps.map(step => step.channelId)).size === steps.length && (steps.length === 1 || steps[1]!.afterSeconds > steps[0]!.afterSeconds)) });
export type IncidentEscalationStep = z.infer<typeof apiIncidentEscalation>["steps"][number];

export const uptimeIncidentGroup = pgTable("uptime_incident_group", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()), userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(), createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [index("uptime_incident_group_owner_idx").on(table.userId)]);
export const uptimeIncidentResponse = pgTable("uptime_incident_response", {
  incidentId: text("incidentId").primaryKey().references(() => uptimeIncident.incidentId, { onDelete: "cascade" }),
  monitorId: text("monitorId").notNull().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  acknowledgedAt: text("acknowledgedAt"), acknowledgedBy: text("acknowledgedBy").references(() => user.id, { onDelete: "set null" }),
  runbookDescription: text("runbookDescription").notNull().default(""), runbookUrl: text("runbookUrl"),
  groupId: text("groupId").references(() => uptimeIncidentGroup.id, { onDelete: "set null" }),
  escalationSteps: jsonb("escalationSteps").$type<IncidentEscalationStep[]>(), escalationDisabled: boolean("escalationDisabled").notNull().default(false),
  eventCount: integer("eventCount").notNull().default(0), updatedAt: text("updatedAt").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [index("uptime_incident_response_owner_idx").on(table.userId, table.acknowledgedAt)]);
export const uptimeIncidentEvent = pgTable("uptime_incident_event", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()), incidentId: text("incidentId").notNull().references(() => uptimeIncident.incidentId, { onDelete: "cascade" }),
  monitorId: text("monitorId").notNull().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }), userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  actorId: text("actorId").references(() => user.id, { onDelete: "set null" }),
  kind: text("kind").$type<"acknowledged" | "unacknowledged" | "note" | "runbook" | "grouped" | "escalation_configured" | "escalation_cancelled" | "check" | "alert">().notNull(), text: text("text"),
  sourceId: text("sourceId"),
  facts: jsonb("facts").$type<{ status?: string; event?: string; outcome?: string; channelType?: string; acknowledgedAt?: string }>(),
  createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [index("uptime_incident_event_timeline_idx").on(table.userId, table.incidentId, table.createdAt, table.id), uniqueIndex("uptime_incident_event_source_idx").on(table.userId, table.sourceId)]);
export const uptimeIncidentEscalation = pgTable("uptime_incident_escalation", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()), incidentId: text("incidentId").notNull().references(() => uptimeIncident.incidentId, { onDelete: "cascade" }),
  monitorId: text("monitorId").notNull().references(() => uptimeMonitor.uptimeMonitorId, { onDelete: "cascade" }), userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  channelId: text("channelId").notNull(), step: integer("step").notNull(), dueAt: text("dueAt").notNull(), leaseUntil: text("leaseUntil"), attempts: integer("attempts").notNull().default(0),
  sourceOutageId: text("sourceOutageId"),
  state: text("state").$type<"pending" | "processing" | "sent" | "failed" | "cancelled">().notNull().default("pending"),
  deliveredTargets: jsonb("deliveredTargets").$type<string[]>().notNull().default([]), finishedTargets: jsonb("finishedTargets").$type<string[]>().notNull().default([]),
}, table => [uniqueIndex("uptime_incident_escalation_step_idx").on(table.incidentId, table.step), index("uptime_incident_escalation_due_idx").on(table.state, table.dueAt, table.leaseUntil), index("uptime_incident_escalation_owner_idx").on(table.userId)]);
