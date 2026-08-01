ALTER TABLE "uptime_notification_channel" ALTER COLUMN "uptimeMonitorId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "uptime_notification_channel" ADD COLUMN "userId" text;--> statement-breakpoint
UPDATE "uptime_notification_channel" c
 SET "userId" = m."userId"
 FROM "uptime_monitor" m
 WHERE c."uptimeMonitorId" = m."uptimeMonitorId";--> statement-breakpoint
ALTER TABLE "uptime_notification_channel" ALTER COLUMN "userId" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_notification_channel" ADD CONSTRAINT "uptime_notification_channel_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_notification_channel_user_idx" ON "uptime_notification_channel" USING btree ("userId");