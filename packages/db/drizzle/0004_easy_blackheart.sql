CREATE TABLE IF NOT EXISTS "uptime_sla_report_subscription" (
	"slaReportSubscriptionId" text PRIMARY KEY NOT NULL,
	"uptimeMonitorId" text,
	"userId" text NOT NULL,
	"recipientAddresses" text[] NOT NULL,
	"emailProviderId" text,
	"active" boolean DEFAULT true NOT NULL,
	"lastSentAt" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_sla_report_subscription" ADD CONSTRAINT "uptime_sla_report_subscription_uptimeMonitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("uptimeMonitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_sla_report_subscription" ADD CONSTRAINT "uptime_sla_report_subscription_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_sla_report_subscription" ADD CONSTRAINT "uptime_sla_report_subscription_emailProviderId_uptime_email_provider_emailProviderId_fk" FOREIGN KEY ("emailProviderId") REFERENCES "public"."uptime_email_provider"("emailProviderId") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_sla_report_subscription_user_idx" ON "uptime_sla_report_subscription" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_sla_report_subscription_active_idx" ON "uptime_sla_report_subscription" USING btree ("active");