import { index, pgTable, text } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { user } from "./auth";
import { uptimeStatusPage } from "./uptime-monitor";
import { uptimeMaintenance } from "./maintenance";
export * from "./validation-status-communication";

export const uptimeStatusAnnouncement = pgTable("uptime_status_announcement", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  statusPageId: text("statusPageId").notNull().references(() => uptimeStatusPage.statusPageId, { onDelete: "cascade" }),
  previousId: text("previousId"),
  title: text("title").notNull(), text: text("text").notNull(), stage: text("stage").$type<"investigating" | "identified" | "monitoring" | "resolved">().notNull(),
  componentIds: text("componentIds").array().notNull(), timezone: text("timezone").notNull().default("UTC"),
  maintenanceId: text("maintenanceId").references(() => uptimeMaintenance.id, { onDelete: "set null" }),
  kind: text("kind").$type<"incident" | "maintenance">().notNull().default("incident"), startsAt: text("startsAt"), endsAt: text("endsAt"),
  publishedAt: text("publishedAt"), createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()), updatedAt: text("updatedAt").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [index("uptime_status_announcement_page_idx").on(table.userId, table.statusPageId, table.publishedAt), index("uptime_status_announcement_created_idx").on(table.createdAt)]);
