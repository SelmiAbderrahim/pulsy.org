CREATE TYPE "public"."planInvitationGrantDuration" AS ENUM('one_month', 'one_year');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_invitation" (
	"planInvitationId" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"plan" text NOT NULL,
	"grantDuration" "planInvitationGrantDuration" NOT NULL,
	"label" text,
	"expiresAt" text NOT NULL,
	"revokedAt" text,
	"claimedAt" text,
	"claimedByUserId" text,
	"createdByUserId" text,
	"createdAt" text NOT NULL,
	CONSTRAINT "plan_invitation_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_invitation" ADD CONSTRAINT "plan_invitation_claimedByUserId_user_id_fk" FOREIGN KEY ("claimedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_invitation" ADD CONSTRAINT "plan_invitation_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_invitation_claimed_by_idx" ON "plan_invitation" USING btree ("claimedByUserId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_invitation_created_at_idx" ON "plan_invitation" USING btree ("createdAt");