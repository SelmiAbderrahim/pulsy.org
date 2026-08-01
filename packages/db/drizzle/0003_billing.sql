CREATE TYPE "public"."billingInterval" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."organizationMemberRole" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."paymentProvider" AS ENUM('polar');--> statement-breakpoint
CREATE TYPE "public"."subscriptionStatus" AS ENUM('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'paused');--> statement-breakpoint
CREATE TYPE "public"."webhookStatus" AS ENUM('pending', 'processed', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer" (
	"customerId" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"provider" "paymentProvider" NOT NULL,
	"providerCustomerId" text NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization" (
	"organizationId" text PRIMARY KEY NOT NULL,
	"ownerUserId" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"createdAt" text NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_member" (
	"memberId" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"role" "organizationMemberRole" DEFAULT 'member' NOT NULL,
	"invitedAt" text,
	"joinedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_tier" (
	"tierId" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"priceCents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"interval" "billingInterval",
	"maxMonitors" integer DEFAULT 0 NOT NULL,
	"minIntervalSeconds" integer DEFAULT 300 NOT NULL,
	"retentionDays" integer DEFAULT 30 NOT NULL,
	"maxNotificationChannels" integer DEFAULT 1 NOT NULL,
	"maxTeamSeats" integer DEFAULT 1 NOT NULL,
	"allowPublicStatusPages" boolean DEFAULT false NOT NULL,
	"allowApiAccess" boolean DEFAULT false NOT NULL,
	"polarProductId" text,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	CONSTRAINT "pricing_tier_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription" (
	"subscriptionId" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"organizationId" text,
	"plan" text NOT NULL,
	"status" "subscriptionStatus" NOT NULL,
	"provider" "paymentProvider" NOT NULL,
	"providerSubscriptionId" text NOT NULL,
	"currentPeriodStart" text,
	"currentPeriodEnd" text,
	"cancelAtPeriodEnd" boolean DEFAULT false NOT NULL,
	"trialEndsAt" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	CONSTRAINT "subscription_providerSubscriptionId_unique" UNIQUE("providerSubscriptionId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_event" (
	"webhookEventId" text PRIMARY KEY NOT NULL,
	"provider" "paymentProvider" NOT NULL,
	"eventId" text NOT NULL,
	"eventType" text NOT NULL,
	"payload" jsonb NOT NULL,
	"headers" jsonb NOT NULL,
	"status" "webhookStatus" DEFAULT 'pending' NOT NULL,
	"processedAt" text,
	"retryCount" integer DEFAULT 0 NOT NULL,
	"error" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer" ADD CONSTRAINT "customer_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization" ADD CONSTRAINT "organization_ownerUserId_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_member" ADD CONSTRAINT "organization_member_organizationId_organization_organizationId_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("organizationId") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_member" ADD CONSTRAINT "organization_member_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription" ADD CONSTRAINT "subscription_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription" ADD CONSTRAINT "subscription_organizationId_organization_organizationId_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("organizationId") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_user_provider_uq" ON "customer" USING btree ("userId","provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_provider_customer_uq" ON "customer" USING btree ("provider","providerCustomerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_owner_idx" ON "organization" USING btree ("ownerUserId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_member_org_user_uq" ON "organization_member" USING btree ("organizationId","userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_member_user_idx" ON "organization_member" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_user_idx" ON "subscription" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_organization_idx" ON "subscription" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_status_idx" ON "subscription" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_one_active_per_user_uq" ON "subscription" USING btree ("userId") WHERE "organizationId" IS NULL AND "status" IN ('active','trialing','past_due');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_one_active_per_org_uq" ON "subscription" USING btree ("organizationId") WHERE "organizationId" IS NOT NULL AND "status" IN ('active','trialing','past_due');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_event_provider_event_uq" ON "webhook_event" USING btree ("provider","eventId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_event_status_idx" ON "webhook_event" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_event_created_idx" ON "webhook_event" USING btree ("createdAt");