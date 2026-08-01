CREATE TABLE IF NOT EXISTS "uptime_share_link" (
	"shareLinkId" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"monitorIds" text[] NOT NULL,
	"expiresAt" text NOT NULL,
	"userId" text NOT NULL,
	"createdAt" text NOT NULL,
	CONSTRAINT "uptime_share_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_share_link" ADD CONSTRAINT "uptime_share_link_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_share_link_user_idx" ON "uptime_share_link" USING btree ("userId");