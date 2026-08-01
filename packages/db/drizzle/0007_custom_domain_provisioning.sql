ALTER TABLE "uptime_status_page" ADD COLUMN "domainProvisionStatus" text;--> statement-breakpoint
ALTER TABLE "uptime_status_page" ADD COLUMN "domainProvisionError" text;--> statement-breakpoint
ALTER TABLE "uptime_status_page" ADD COLUMN "domainProvisionedAt" text;