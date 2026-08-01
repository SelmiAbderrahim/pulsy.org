CREATE TABLE IF NOT EXISTS "uptime_status_page" (
	"statusPageId" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"logoUrl" text,
	"isPublished" boolean DEFAULT false NOT NULL,
	"customDomain" text,
	"domainVerified" boolean DEFAULT false NOT NULL,
	"domainVerifyToken" text,
	"domainVerifiedAt" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uptime_status_page_monitor" (
	"id" text PRIMARY KEY NOT NULL,
	"statusPageId" text NOT NULL,
	"uptimeMonitorId" text NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_status_page" ADD CONSTRAINT "uptime_status_page_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_status_page_monitor" ADD CONSTRAINT "uptime_status_page_monitor_statusPageId_uptime_status_page_statusPageId_fk" FOREIGN KEY ("statusPageId") REFERENCES "public"."uptime_status_page"("statusPageId") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_status_page_monitor" ADD CONSTRAINT "uptime_status_page_monitor_uptimeMonitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("uptimeMonitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uptime_status_page_user_slug_idx" ON "uptime_status_page" USING btree ("userId","slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uptime_status_page_custom_domain_idx" ON "uptime_status_page" USING btree ("customDomain") WHERE "uptime_status_page"."customDomain" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_status_page_user_idx" ON "uptime_status_page" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uptime_status_page_monitor_unique_idx" ON "uptime_status_page_monitor" USING btree ("statusPageId","uptimeMonitorId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_status_page_monitor_page_idx" ON "uptime_status_page_monitor" USING btree ("statusPageId");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Data backfill (hand-added — drizzle-kit only emits DDL, not data migrations).
-- Migrate the legacy per-user public page onto the new status-page entity: every
-- user who already had ≥1 `isPublic` monitor gets one published `default` page
-- linking those monitors, so the legacy `/status/:userId` URL and the reconciled
-- `usage.publicStatusPageCount` keep working. Idempotent — re-running is a no-op:
-- the page insert is guarded by "no existing default page" (also protected by the
-- unique (userId, slug) index) and the link insert by "not already linked".
-- ---------------------------------------------------------------------------
INSERT INTO "uptime_status_page" ("statusPageId", "userId", "slug", "title", "isPublished", "createdAt")
SELECT gen_random_uuid()::text, u."userId", 'default',
       COALESCE(
         (SELECT m2."statusPageTitle" FROM "uptime_monitor" m2
          WHERE m2."userId" = u."userId" AND m2."isPublic" = true AND m2."statusPageTitle" IS NOT NULL
          ORDER BY m2."createdAt" ASC LIMIT 1),
         'Service Status'),
       true, now()::text
FROM (SELECT DISTINCT "userId" FROM "uptime_monitor" WHERE "isPublic" = true) u
WHERE NOT EXISTS (
  SELECT 1 FROM "uptime_status_page" sp
  WHERE sp."userId" = u."userId" AND sp."slug" = 'default'
);--> statement-breakpoint
INSERT INTO "uptime_status_page_monitor" ("id", "statusPageId", "uptimeMonitorId", "sortOrder")
SELECT gen_random_uuid()::text, sp."statusPageId", m."uptimeMonitorId", 0
FROM "uptime_monitor" m
JOIN "uptime_status_page" sp
  ON sp."userId" = m."userId" AND sp."slug" = 'default'
WHERE m."isPublic" = true
  AND NOT EXISTS (
    SELECT 1 FROM "uptime_status_page_monitor" spm
    WHERE spm."statusPageId" = sp."statusPageId" AND spm."uptimeMonitorId" = m."uptimeMonitorId"
  );