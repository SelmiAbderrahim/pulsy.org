CREATE TYPE "public"."uptimeCheckStatus" AS ENUM('up', 'down', 'degraded');--> statement-breakpoint
CREATE TYPE "public"."uptimeEmailProviderType" AS ENUM('resend', 'sendgrid', 'smtp');--> statement-breakpoint
CREATE TYPE "public"."uptimeIncidentStatus" AS ENUM('ongoing', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."uptimeMonitorMethod" AS ENUM('GET', 'HEAD', 'POST');--> statement-breakpoint
CREATE TYPE "public"."uptimeMonitorStatus" AS ENUM('up', 'down', 'degraded', 'pending');--> statement-breakpoint
CREATE TYPE "public"."uptimeNotificationChannelType" AS ENUM('email', 'webhook', 'slack', 'discord', 'telegram');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uptime_check_log" (
	"checkLogId" text PRIMARY KEY NOT NULL,
	"uptimeMonitorId" text NOT NULL,
	"httpStatus" integer,
	"responseTime" integer,
	"status" "uptimeCheckStatus" NOT NULL,
	"errorMessage" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uptime_email_provider" (
	"emailProviderId" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"providerType" "uptimeEmailProviderType" NOT NULL,
	"apiKey" text,
	"smtpHost" text,
	"smtpPort" integer,
	"smtpUsername" text,
	"smtpPassword" text,
	"smtpSecure" boolean DEFAULT true,
	"fromAddress" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"userId" text NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uptime_incident" (
	"incidentId" text PRIMARY KEY NOT NULL,
	"uptimeMonitorId" text NOT NULL,
	"status" "uptimeIncidentStatus" DEFAULT 'ongoing' NOT NULL,
	"startedAt" text NOT NULL,
	"resolvedAt" text,
	"durationSeconds" integer,
	"cause" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uptime_monitor" (
	"uptimeMonitorId" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"method" "uptimeMonitorMethod" DEFAULT 'GET' NOT NULL,
	"expectedStatus" integer DEFAULT 200 NOT NULL,
	"timeout" integer DEFAULT 10000 NOT NULL,
	"interval" integer DEFAULT 300 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"status" "uptimeMonitorStatus" DEFAULT 'pending' NOT NULL,
	"httpStatus" integer,
	"responseTime" integer,
	"lastCheckedAt" text,
	"nextCheckAt" text,
	"tlsExpiresAt" text,
	"tlsExpiresInDays" integer,
	"consecutiveFailures" integer DEFAULT 0 NOT NULL,
	"failureThreshold" integer DEFAULT 3 NOT NULL,
	"uptimePercentage" real,
	"tags" text[] DEFAULT '{}',
	"isPublic" boolean DEFAULT false NOT NULL,
	"statusPageTitle" text,
	"statusPageDescription" text,
	"userId" text NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uptime_notification_channel" (
	"channelId" text PRIMARY KEY NOT NULL,
	"uptimeMonitorId" text NOT NULL,
	"channelType" "uptimeNotificationChannelType" NOT NULL,
	"emailProviderId" text,
	"recipientAddresses" text[],
	"webhookUrl" text,
	"webhookHeaders" jsonb,
	"notifyOnDown" boolean DEFAULT true NOT NULL,
	"notifyOnRecovery" boolean DEFAULT true NOT NULL,
	"notifyOnTlsExpiry" boolean DEFAULT false NOT NULL,
	"tlsExpiryThresholdDays" integer DEFAULT 14 NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uptime_status_change" (
	"statusChangeId" text PRIMARY KEY NOT NULL,
	"uptimeMonitorId" text NOT NULL,
	"statusBefore" "uptimeMonitorStatus" NOT NULL,
	"statusAfter" "uptimeMonitorStatus" NOT NULL,
	"httpStatus" integer,
	"responseTime" integer,
	"reason" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_check_log" ADD CONSTRAINT "uptime_check_log_uptimeMonitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("uptimeMonitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_email_provider" ADD CONSTRAINT "uptime_email_provider_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_incident" ADD CONSTRAINT "uptime_incident_uptimeMonitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("uptimeMonitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_monitor" ADD CONSTRAINT "uptime_monitor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_notification_channel" ADD CONSTRAINT "uptime_notification_channel_uptimeMonitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("uptimeMonitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_notification_channel" ADD CONSTRAINT "uptime_notification_channel_emailProviderId_uptime_email_provider_emailProviderId_fk" FOREIGN KEY ("emailProviderId") REFERENCES "public"."uptime_email_provider"("emailProviderId") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uptime_status_change" ADD CONSTRAINT "uptime_status_change_uptimeMonitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("uptimeMonitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_check_log_monitor_created_idx" ON "uptime_check_log" USING btree ("uptimeMonitorId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_check_log_created_idx" ON "uptime_check_log" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_incident_monitor_status_idx" ON "uptime_incident" USING btree ("uptimeMonitorId","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_incident_started_idx" ON "uptime_incident" USING btree ("startedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_monitor_user_idx" ON "uptime_monitor" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_monitor_active_idx" ON "uptime_monitor" USING btree ("active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_notification_channel_monitor_idx" ON "uptime_notification_channel" USING btree ("uptimeMonitorId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_status_change_monitor_created_idx" ON "uptime_status_change" USING btree ("uptimeMonitorId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uptime_status_change_created_idx" ON "uptime_status_change" USING btree ("createdAt");