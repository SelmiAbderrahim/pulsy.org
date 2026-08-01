CREATE TYPE "public"."orderStatus" AS ENUM('paid', 'refunded', 'partially_refunded', 'pending');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_key" (
	"apiKeyId" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"keyPrefix" text NOT NULL,
	"hashedKey" text NOT NULL,
	"lastUsedAt" text,
	"expiresAt" text,
	"revokedAt" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order" (
	"orderId" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"subscriptionId" text,
	"provider" "paymentProvider" NOT NULL,
	"providerOrderId" text NOT NULL,
	"amountCents" integer DEFAULT 0 NOT NULL,
	"refundedAmountCents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" "orderStatus" NOT NULL,
	"billingReason" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_request" (
	"supportRequestId" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"planId" text NOT NULL,
	"isPriority" boolean DEFAULT false NOT NULL,
	"deliveredAt" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "bannedReason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_key" ADD CONSTRAINT "api_key_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "order" ADD CONSTRAINT "order_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_request" ADD CONSTRAINT "support_request_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_key_hashed_key_uq" ON "api_key" USING btree ("hashedKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_key_user_idx" ON "api_key" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_user_idx" ON "order" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_provider_order_uq" ON "order" USING btree ("provider","providerOrderId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_created_idx" ON "order" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_request_user_idx" ON "support_request" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_request_created_idx" ON "support_request" USING btree ("createdAt");