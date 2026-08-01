CREATE TYPE "public"."uptimeNotificationEvent" AS ENUM('down', 'recovery', 'tls_expiry');--> statement-breakpoint
CREATE TYPE "public"."uptimeNotificationOutcome" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uptime_notification_log" (
	"notificationLogId" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"uptimeMonitorId" text NOT NULL,
	"channelId" text,
	"channelType" "uptimeNotificationChannelType" NOT NULL,
	"target" text NOT NULL,
	"event" "uptimeNotificationEvent" NOT NULL,
	"statusChangeId" text,
	"outcome" "uptimeNotificationOutcome" NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"providerMessageId" text,
	"error" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_notification_log" ADD CONSTRAINT "uptime_notification_log_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_notification_log" ADD CONSTRAINT "uptime_notification_log_uptimeMonitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("uptimeMonitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_notification_log" ADD CONSTRAINT "uptime_notification_log_channelId_uptime_notification_channel_channelId_fk" FOREIGN KEY ("channelId") REFERENCES "public"."uptime_notification_channel"("channelId") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_notification_log_user_created_idx" ON "uptime_notification_log" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_notification_log_monitor_created_idx" ON "uptime_notification_log" USING btree ("uptimeMonitorId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_notification_log_created_idx" ON "uptime_notification_log" USING btree ("createdAt");