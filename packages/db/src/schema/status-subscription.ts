import { boolean, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { user } from "./auth";
import { uptimeEmailProvider, uptimeStatusPage } from "./uptime-monitor";
import { uptimeStatusAnnouncement } from "./status-communication";
const id = z.string().min(1).max(64);
export const apiStatusSubscriptionConfig = z.object({ statusPageId: id, enabled: z.boolean(), providerId: id.nullable(), messagesPerMinute: z.number().int().min(1).max(60), confirmChange: z.boolean() }).strict();
export const apiStatusSubscriptionRequest = z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()), componentIds: z.array(id).max(100).refine(values => new Set(values).size === values.length), language: z.enum(["en", "ar", "fr", "de", "es"]).default("en") }).strict();
export const apiStatusSubscriptionRedeem = z.object({ action: z.enum(["confirm", "unsubscribe"]), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const uptimeStatusSubscriptionConfig = pgTable("uptime_status_subscription_config", {
  statusPageId: text("statusPageId").primaryKey().references(() => uptimeStatusPage.statusPageId, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  providerId: text("providerId").references(() => uptimeEmailProvider.emailProviderId, { onDelete: "set null" }),
  messagesPerMinute: integer("messagesPerMinute").notNull().default(30), version: integer("version").notNull().default(1),
}, table => [index("uptime_status_subscription_config_owner_idx").on(table.userId, table.providerId)]);
export const uptimeStatusSubscriber = pgTable("uptime_status_subscriber", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  statusPageId: text("statusPageId").notNull().references(() => uptimeStatusPage.statusPageId, { onDelete: "cascade" }),
  emailHash: text("emailHash").notNull(), emailCipher: text("emailCipher").notNull(),
  state: text("state").$type<"pending" | "confirmed" | "unsubscribed">().notNull().default("pending"),
  componentIds: text("componentIds").array().notNull().default([]), language: text("language").$type<"en" | "ar" | "fr" | "de" | "es">().notNull().default("en"),
  confirmedVersion: integer("confirmedVersion").notNull().default(0), confirmedAt: text("confirmedAt"),
  pendingVersion: integer("pendingVersion").notNull().default(0), pendingComponents: text("pendingComponents").array(), pendingLanguage: text("pendingLanguage").$type<"en" | "ar" | "fr" | "de" | "es">(),
  confirmHash: text("confirmHash"), confirmExpiresAt: text("confirmExpiresAt"), requestedAt: text("requestedAt").notNull(),
  unsubscribeHash: text("unsubscribeHash"), unsubscribeCipher: text("unsubscribeCipher"), createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [uniqueIndex("uptime_status_subscriber_email_idx").on(table.statusPageId, table.emailHash), index("uptime_status_subscriber_scope_idx").on(table.userId, table.statusPageId, table.state, table.id), index("uptime_status_subscriber_confirm_idx").on(table.statusPageId, table.confirmHash), index("uptime_status_subscriber_unsubscribe_idx").on(table.statusPageId, table.unsubscribeHash)]);
export const uptimeStatusMailJob = pgTable("uptime_status_mail_job", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()), userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  statusPageId: text("statusPageId").notNull().references(() => uptimeStatusPage.statusPageId, { onDelete: "cascade" }),
  providerId: text("providerId").references(() => uptimeEmailProvider.emailProviderId, { onDelete: "set null" }), configVersion: integer("configVersion").notNull(),
  kind: text("kind").$type<"confirmation" | "fanout" | "update">().notNull(),
  subscriberId: text("subscriberId").references(() => uptimeStatusSubscriber.id, { onDelete: "cascade" }), subscriberVersion: integer("subscriberVersion"),
  announcementId: text("announcementId").references(() => uptimeStatusAnnouncement.id, { onDelete: "cascade" }),
  dedupKey: text("dedupKey").notNull(), payloadCipher: text("payloadCipher"), cursor: text("cursor"),
  state: text("state").$type<"pending" | "processing" | "done" | "failed" | "cancelled">().notNull().default("pending"), dueAt: text("dueAt").notNull(), leaseUntil: text("leaseUntil"), attempts: integer("attempts").notNull().default(0),
  failure: text("failure").$type<"provider_unavailable" | "provider_rejected" | "provider_temporary" | "delivery_failed" | "delivery_uncertain">(), deliveredAt: text("deliveredAt"), createdAt: text("createdAt").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [uniqueIndex("uptime_status_mail_job_dedup_idx").on(table.userId, table.dedupKey), index("uptime_status_mail_job_due_idx").on(table.state, table.dueAt, table.leaseUntil), index("uptime_status_mail_job_page_idx").on(table.userId, table.statusPageId, table.state)]);
export const uptimeStatusMailGate = pgTable("uptime_status_mail_gate", {
  providerId: text("providerId").primaryKey().references(() => uptimeEmailProvider.emailProviderId, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }), nextSendAt: text("nextSendAt").notNull(),
}, table => [index("uptime_status_mail_gate_owner_idx").on(table.userId)]);
