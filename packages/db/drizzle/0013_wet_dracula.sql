CREATE TYPE "public"."api_key_scope" AS ENUM('read', 'full');--> statement-breakpoint
CREATE TABLE "uptime_check_day" (
	"monitorId" text NOT NULL,
	"day" text NOT NULL,
	"status" text NOT NULL,
	"checks" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_heartbeat" (
	"monitorId" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"tokenHash" text NOT NULL,
	"tokenCipher" text,
	"graceSeconds" integer NOT NULL,
	"expectedAt" text NOT NULL,
	"nextDeadline" text,
	"lastReceivedAt" text,
	"lastSuccessAt" text,
	"lastFailAt" text,
	"currentRunId" text,
	"lastRunDurationMs" bigint,
	"rateWindowAt" text,
	"rateCount" integer DEFAULT 0 NOT NULL,
	"lastSampleAt" text,
	"runCount" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_heartbeat_run" (
	"id" text PRIMARY KEY NOT NULL,
	"monitorId" text NOT NULL,
	"userId" text NOT NULL,
	"runId" text NOT NULL,
	"startedAt" text NOT NULL,
	"finishedAt" text,
	"outcome" text NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "uptime_deferred_alert" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"monitorId" text NOT NULL,
	"statusChangeId" text NOT NULL,
	"sourceOutageId" text,
	"policyReason" text,
	"snapshot" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"suppressionIds" text[] NOT NULL,
	"finishedTargets" text[] DEFAULT '{}' NOT NULL,
	"deliveredTargets" text[] DEFAULT '{}' NOT NULL,
	"historyPruned" boolean DEFAULT false NOT NULL,
	"dueAt" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_maintenance" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"monitorIds" text[] NOT NULL,
	"kind" text DEFAULT 'maintenance' NOT NULL,
	"name" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"startsAt" text NOT NULL,
	"endsAt" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"recurrence" text DEFAULT 'once' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_incident_escalation" (
	"id" text PRIMARY KEY NOT NULL,
	"incidentId" text NOT NULL,
	"monitorId" text NOT NULL,
	"userId" text NOT NULL,
	"channelId" text NOT NULL,
	"step" integer NOT NULL,
	"dueAt" text NOT NULL,
	"leaseUntil" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sourceOutageId" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"deliveredTargets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finishedTargets" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_incident_event" (
	"id" text PRIMARY KEY NOT NULL,
	"incidentId" text NOT NULL,
	"monitorId" text NOT NULL,
	"userId" text NOT NULL,
	"actorId" text,
	"kind" text NOT NULL,
	"text" text,
	"sourceId" text,
	"facts" jsonb,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_incident_group" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_incident_response" (
	"incidentId" text PRIMARY KEY NOT NULL,
	"monitorId" text NOT NULL,
	"userId" text NOT NULL,
	"acknowledgedAt" text,
	"acknowledgedBy" text,
	"runbookDescription" text DEFAULT '' NOT NULL,
	"runbookUrl" text,
	"groupId" text,
	"escalationSteps" jsonb,
	"escalationDisabled" boolean DEFAULT false NOT NULL,
	"eventCount" integer DEFAULT 0 NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_reliability_annotation" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"monitorId" text NOT NULL,
	"actorId" text NOT NULL,
	"at" text NOT NULL,
	"environment" text DEFAULT '' NOT NULL,
	"version" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"link" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_reliability_cursor" (
	"monitorId" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"checkId" text NOT NULL,
	"observation" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_reliability_day" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"monitorId" text NOT NULL,
	"day" text NOT NULL,
	"bucket" jsonb NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_reliability_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"monitorId" text NOT NULL,
	"version" integer NOT NULL,
	"availabilityTargetBps" integer,
	"latencyTargetMs" integer,
	"excludeMaintenance" boolean DEFAULT false NOT NULL,
	"createdAt" text NOT NULL,
	"firstObservedAt" text
);
--> statement-breakpoint
CREATE TABLE "uptime_server" (
	"monitorId" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"tokenHash" text NOT NULL,
	"tokenCipher" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"thresholds" jsonb NOT NULL,
	"excludedFilesystems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missingHealthy" integer DEFAULT 0 NOT NULL,
	"lastReceivedAt" text,
	"lastSampledAt" text,
	"lastBootId" text,
	"lastSequence" bigint,
	"nextDeadline" text,
	"agent" jsonb,
	"rateWindowAt" text,
	"rateCount" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_server_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"monitorId" text NOT NULL,
	"userId" text NOT NULL,
	"receivedAt" text NOT NULL,
	"sample" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_status_announcement" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"statusPageId" text NOT NULL,
	"previousId" text,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"stage" text NOT NULL,
	"componentIds" text[] NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"maintenanceId" text,
	"kind" text DEFAULT 'incident' NOT NULL,
	"startsAt" text,
	"endsAt" text,
	"publishedAt" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_status_mail_gate" (
	"providerId" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"nextSendAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_status_mail_job" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"statusPageId" text NOT NULL,
	"providerId" text,
	"configVersion" integer NOT NULL,
	"kind" text NOT NULL,
	"subscriberId" text,
	"subscriberVersion" integer,
	"announcementId" text,
	"dedupKey" text NOT NULL,
	"payloadCipher" text,
	"cursor" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"dueAt" text NOT NULL,
	"leaseUntil" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failure" text,
	"deliveredAt" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_status_subscriber" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"statusPageId" text NOT NULL,
	"emailHash" text NOT NULL,
	"emailCipher" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"componentIds" text[] DEFAULT '{}' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"confirmedVersion" integer DEFAULT 0 NOT NULL,
	"confirmedAt" text,
	"pendingVersion" integer DEFAULT 0 NOT NULL,
	"pendingComponents" text[],
	"pendingLanguage" text,
	"confirmHash" text,
	"confirmExpiresAt" text,
	"requestedAt" text NOT NULL,
	"unsubscribeHash" text,
	"unsubscribeCipher" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_status_subscription_config" (
	"statusPageId" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"providerId" text,
	"messagesPerMinute" integer DEFAULT 30 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_monitor_view" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_monitor_channel_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"monitorId" text NOT NULL,
	"channelId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_monitor_template" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"needsRequestValues" boolean DEFAULT false NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
DROP INDEX "uptime_status_page_custom_domain_idx";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "uptime_check_log" ADD COLUMN "assertionOutcomes" jsonb;--> statement-breakpoint
ALTER TABLE "uptime_check_log" ADD COLUMN "observation" jsonb;--> statement-breakpoint
ALTER TABLE "uptime_check_log" ADD COLUMN "observationEndedAt" text;--> statement-breakpoint
ALTER TABLE "uptime_incident" ADD COLUMN "severity" text;--> statement-breakpoint
ALTER TABLE "uptime_incident" ADD COLUMN "expectedAt" text;--> statement-breakpoint
ALTER TABLE "uptime_incident" ADD COLUMN "notifiedAt" text;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "externalKey" text;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "monitorType" text DEFAULT 'http' NOT NULL;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "networkConfig" jsonb;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "expectedStatuses" text;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "tlsMonitoringEnabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "requestCipher" text;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "redirectPolicy" text DEFAULT 'follow' NOT NULL;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "httpAssertions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "latencyPolicy" jsonb;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "consecutiveSlow" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "consecutiveHealthy" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "lastOperationalAlertAt" text;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "lastOperationalAlertId" text;--> statement-breakpoint
ALTER TABLE "uptime_monitor" ADD COLUMN "notificationOutageId" text;--> statement-breakpoint
ALTER TABLE "uptime_notification_channel" ADD COLUMN "signingSecretCipher" text;--> statement-breakpoint
ALTER TABLE "uptime_notification_channel" ADD COLUMN "notifyOnDegraded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "uptime_share_link" ADD COLUMN "showSharerName" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "uptime_status_page" ADD COLUMN "historyEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "uptime_status_page_monitor" ADD COLUMN "publicName" text;--> statement-breakpoint
ALTER TABLE "uptime_status_page_monitor" ADD COLUMN "publicDescription" text;--> statement-breakpoint
ALTER TABLE "uptime_status_page_monitor" ADD COLUMN "publicGroup" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "scope" "api_key_scope" DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "removedAt" text;--> statement-breakpoint
ALTER TABLE "uptime_check_day" ADD CONSTRAINT "uptime_check_day_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_heartbeat" ADD CONSTRAINT "uptime_heartbeat_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_heartbeat" ADD CONSTRAINT "uptime_heartbeat_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_heartbeat_run" ADD CONSTRAINT "uptime_heartbeat_run_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_heartbeat_run" ADD CONSTRAINT "uptime_heartbeat_run_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_deferred_alert" ADD CONSTRAINT "uptime_deferred_alert_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_deferred_alert" ADD CONSTRAINT "uptime_deferred_alert_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_maintenance" ADD CONSTRAINT "uptime_maintenance_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_incident_escalation" ADD CONSTRAINT "uptime_incident_escalation_incidentId_uptime_incident_incidentId_fk" FOREIGN KEY ("incidentId") REFERENCES "public"."uptime_incident"("incidentId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_incident_escalation" ADD CONSTRAINT "uptime_incident_escalation_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_incident_escalation" ADD CONSTRAINT "uptime_incident_escalation_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_incident_event" ADD CONSTRAINT "uptime_incident_event_incidentId_uptime_incident_incidentId_fk" FOREIGN KEY ("incidentId") REFERENCES "public"."uptime_incident"("incidentId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_incident_event" ADD CONSTRAINT "uptime_incident_event_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_incident_event" ADD CONSTRAINT "uptime_incident_event_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_incident_event" ADD CONSTRAINT "uptime_incident_event_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_incident_group" ADD CONSTRAINT "uptime_incident_group_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_incident_response" ADD CONSTRAINT "uptime_incident_response_incidentId_uptime_incident_incidentId_fk" FOREIGN KEY ("incidentId") REFERENCES "public"."uptime_incident"("incidentId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_incident_response" ADD CONSTRAINT "uptime_incident_response_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_incident_response" ADD CONSTRAINT "uptime_incident_response_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_incident_response" ADD CONSTRAINT "uptime_incident_response_acknowledgedBy_user_id_fk" FOREIGN KEY ("acknowledgedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_incident_response" ADD CONSTRAINT "uptime_incident_response_groupId_uptime_incident_group_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."uptime_incident_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_reliability_annotation" ADD CONSTRAINT "uptime_reliability_annotation_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_reliability_annotation" ADD CONSTRAINT "uptime_reliability_annotation_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_reliability_annotation" ADD CONSTRAINT "uptime_reliability_annotation_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_reliability_cursor" ADD CONSTRAINT "uptime_reliability_cursor_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_reliability_cursor" ADD CONSTRAINT "uptime_reliability_cursor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_reliability_cursor" ADD CONSTRAINT "uptime_reliability_cursor_checkId_uptime_check_log_checkLogId_fk" FOREIGN KEY ("checkId") REFERENCES "public"."uptime_check_log"("checkLogId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_reliability_day" ADD CONSTRAINT "uptime_reliability_day_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_reliability_day" ADD CONSTRAINT "uptime_reliability_day_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_reliability_policy" ADD CONSTRAINT "uptime_reliability_policy_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_reliability_policy" ADD CONSTRAINT "uptime_reliability_policy_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_server" ADD CONSTRAINT "uptime_server_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_server" ADD CONSTRAINT "uptime_server_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_server_metric" ADD CONSTRAINT "uptime_server_metric_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_server_metric" ADD CONSTRAINT "uptime_server_metric_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_announcement" ADD CONSTRAINT "uptime_status_announcement_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_announcement" ADD CONSTRAINT "uptime_status_announcement_statusPageId_uptime_status_page_statusPageId_fk" FOREIGN KEY ("statusPageId") REFERENCES "public"."uptime_status_page"("statusPageId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_announcement" ADD CONSTRAINT "uptime_status_announcement_maintenanceId_uptime_maintenance_id_fk" FOREIGN KEY ("maintenanceId") REFERENCES "public"."uptime_maintenance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_mail_gate" ADD CONSTRAINT "uptime_status_mail_gate_providerId_uptime_email_provider_emailProviderId_fk" FOREIGN KEY ("providerId") REFERENCES "public"."uptime_email_provider"("emailProviderId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_mail_gate" ADD CONSTRAINT "uptime_status_mail_gate_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_mail_job" ADD CONSTRAINT "uptime_status_mail_job_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_mail_job" ADD CONSTRAINT "uptime_status_mail_job_statusPageId_uptime_status_page_statusPageId_fk" FOREIGN KEY ("statusPageId") REFERENCES "public"."uptime_status_page"("statusPageId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_mail_job" ADD CONSTRAINT "uptime_status_mail_job_providerId_uptime_email_provider_emailProviderId_fk" FOREIGN KEY ("providerId") REFERENCES "public"."uptime_email_provider"("emailProviderId") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_mail_job" ADD CONSTRAINT "uptime_status_mail_job_subscriberId_uptime_status_subscriber_id_fk" FOREIGN KEY ("subscriberId") REFERENCES "public"."uptime_status_subscriber"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_mail_job" ADD CONSTRAINT "uptime_status_mail_job_announcementId_uptime_status_announcement_id_fk" FOREIGN KEY ("announcementId") REFERENCES "public"."uptime_status_announcement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_subscriber" ADD CONSTRAINT "uptime_status_subscriber_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_subscriber" ADD CONSTRAINT "uptime_status_subscriber_statusPageId_uptime_status_page_statusPageId_fk" FOREIGN KEY ("statusPageId") REFERENCES "public"."uptime_status_page"("statusPageId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_subscription_config" ADD CONSTRAINT "uptime_status_subscription_config_statusPageId_uptime_status_page_statusPageId_fk" FOREIGN KEY ("statusPageId") REFERENCES "public"."uptime_status_page"("statusPageId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_subscription_config" ADD CONSTRAINT "uptime_status_subscription_config_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_status_subscription_config" ADD CONSTRAINT "uptime_status_subscription_config_providerId_uptime_email_provider_emailProviderId_fk" FOREIGN KEY ("providerId") REFERENCES "public"."uptime_email_provider"("emailProviderId") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_monitor_view" ADD CONSTRAINT "uptime_monitor_view_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_monitor_channel_binding" ADD CONSTRAINT "uptime_monitor_channel_binding_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_monitor_channel_binding" ADD CONSTRAINT "uptime_monitor_channel_binding_monitorId_uptime_monitor_uptimeMonitorId_fk" FOREIGN KEY ("monitorId") REFERENCES "public"."uptime_monitor"("uptimeMonitorId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_monitor_channel_binding" ADD CONSTRAINT "uptime_monitor_channel_binding_channelId_uptime_notification_channel_channelId_fk" FOREIGN KEY ("channelId") REFERENCES "public"."uptime_notification_channel"("channelId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_monitor_template" ADD CONSTRAINT "uptime_monitor_template_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_check_day_key" ON "uptime_check_day" USING btree ("monitorId","day","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_heartbeat_token_hash_idx" ON "uptime_heartbeat" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "uptime_heartbeat_owner_idx" ON "uptime_heartbeat" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "uptime_heartbeat_deadline_idx" ON "uptime_heartbeat" USING btree ("nextDeadline");--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_heartbeat_run_key_idx" ON "uptime_heartbeat_run" USING btree ("monitorId","runId");--> statement-breakpoint
CREATE INDEX "uptime_heartbeat_run_history_idx" ON "uptime_heartbeat_run" USING btree ("userId","monitorId","startedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_deferred_alert_change_idx" ON "uptime_deferred_alert" USING btree ("statusChangeId");--> statement-breakpoint
CREATE INDEX "uptime_deferred_alert_due_idx" ON "uptime_deferred_alert" USING btree ("state","dueAt");--> statement-breakpoint
CREATE INDEX "uptime_deferred_alert_user_idx" ON "uptime_deferred_alert" USING btree ("userId","monitorId");--> statement-breakpoint
CREATE INDEX "uptime_deferred_alert_episode_idx" ON "uptime_deferred_alert" USING btree ("userId","monitorId","sourceOutageId");--> statement-breakpoint
CREATE INDEX "uptime_deferred_alert_history_idx" ON "uptime_deferred_alert" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "uptime_maintenance_user_idx" ON "uptime_maintenance" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "uptime_maintenance_active_idx" ON "uptime_maintenance" USING btree ("userId","enabled","endsAt");--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_incident_escalation_step_idx" ON "uptime_incident_escalation" USING btree ("incidentId","step");--> statement-breakpoint
CREATE INDEX "uptime_incident_escalation_due_idx" ON "uptime_incident_escalation" USING btree ("state","dueAt","leaseUntil");--> statement-breakpoint
CREATE INDEX "uptime_incident_escalation_owner_idx" ON "uptime_incident_escalation" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "uptime_incident_event_timeline_idx" ON "uptime_incident_event" USING btree ("userId","incidentId","createdAt","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_incident_event_source_idx" ON "uptime_incident_event" USING btree ("userId","sourceId");--> statement-breakpoint
CREATE INDEX "uptime_incident_group_owner_idx" ON "uptime_incident_group" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "uptime_incident_response_owner_idx" ON "uptime_incident_response" USING btree ("userId","acknowledgedAt");--> statement-breakpoint
CREATE INDEX "uptime_reliability_annotation_owner_idx" ON "uptime_reliability_annotation" USING btree ("userId","monitorId","at","id");--> statement-breakpoint
CREATE INDEX "uptime_reliability_cursor_owner_idx" ON "uptime_reliability_cursor" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_reliability_day_owner_idx" ON "uptime_reliability_day" USING btree ("userId","monitorId","day");--> statement-breakpoint
CREATE INDEX "uptime_reliability_day_retention_idx" ON "uptime_reliability_day" USING btree ("userId","day");--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_reliability_policy_owner_version_idx" ON "uptime_reliability_policy" USING btree ("userId","monitorId","version");--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_server_token_idx" ON "uptime_server" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "uptime_server_owner_idx" ON "uptime_server" USING btree ("userId","monitorId");--> statement-breakpoint
CREATE INDEX "uptime_server_deadline_idx" ON "uptime_server" USING btree ("nextDeadline");--> statement-breakpoint
CREATE INDEX "uptime_server_metric_history_idx" ON "uptime_server_metric" USING btree ("userId","monitorId","receivedAt");--> statement-breakpoint
CREATE INDEX "uptime_server_metric_retention_idx" ON "uptime_server_metric" USING btree ("userId","receivedAt");--> statement-breakpoint
CREATE INDEX "uptime_status_announcement_page_idx" ON "uptime_status_announcement" USING btree ("userId","statusPageId","publishedAt");--> statement-breakpoint
CREATE INDEX "uptime_status_announcement_created_idx" ON "uptime_status_announcement" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "uptime_status_mail_gate_owner_idx" ON "uptime_status_mail_gate" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_status_mail_job_dedup_idx" ON "uptime_status_mail_job" USING btree ("userId","dedupKey");--> statement-breakpoint
CREATE INDEX "uptime_status_mail_job_due_idx" ON "uptime_status_mail_job" USING btree ("state","dueAt","leaseUntil");--> statement-breakpoint
CREATE INDEX "uptime_status_mail_job_page_idx" ON "uptime_status_mail_job" USING btree ("userId","statusPageId","state");--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_status_subscriber_email_idx" ON "uptime_status_subscriber" USING btree ("statusPageId","emailHash");--> statement-breakpoint
CREATE INDEX "uptime_status_subscriber_scope_idx" ON "uptime_status_subscriber" USING btree ("userId","statusPageId","state","id");--> statement-breakpoint
CREATE INDEX "uptime_status_subscriber_confirm_idx" ON "uptime_status_subscriber" USING btree ("statusPageId","confirmHash");--> statement-breakpoint
CREATE INDEX "uptime_status_subscriber_unsubscribe_idx" ON "uptime_status_subscriber" USING btree ("statusPageId","unsubscribeHash");--> statement-breakpoint
CREATE INDEX "uptime_status_subscription_config_owner_idx" ON "uptime_status_subscription_config" USING btree ("userId","providerId");--> statement-breakpoint
CREATE INDEX "uptime_monitor_view_owner_idx" ON "uptime_monitor_view" USING btree ("userId","isDefault");--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_monitor_channel_binding_unique" ON "uptime_monitor_channel_binding" USING btree ("monitorId","channelId");--> statement-breakpoint
CREATE INDEX "uptime_monitor_channel_binding_owner_idx" ON "uptime_monitor_channel_binding" USING btree ("userId","monitorId");--> statement-breakpoint
CREATE INDEX "uptime_monitor_template_owner_idx" ON "uptime_monitor_template" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "uptime_check_log_monitor_created_status_idx" ON "uptime_check_log" USING btree ("uptimeMonitorId","createdAt","status");--> statement-breakpoint
LOCK TABLE "uptime_incident" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
-- Close duplicate ongoing incidents (keep the earliest per monitor, zero duration)
-- so the unique index below can be created on installs that raced into duplicates.
UPDATE "uptime_incident" i SET "status" = 'resolved', "resolvedAt" = i."startedAt", "durationSeconds" = 0
FROM (
	SELECT "incidentId", row_number() OVER (PARTITION BY "uptimeMonitorId" ORDER BY "startedAt", "incidentId") AS position
	FROM "uptime_incident" WHERE "status" = 'ongoing'
) ranked
WHERE i."incidentId" = ranked."incidentId" AND ranked.position > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_incident_one_ongoing_idx" ON "uptime_incident" USING btree ("uptimeMonitorId") WHERE "uptime_incident"."status" = 'ongoing';--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_monitor_owner_external_key_idx" ON "uptime_monitor" USING btree ("userId","externalKey");--> statement-breakpoint
CREATE UNIQUE INDEX "uptime_status_page_custom_domain_idx" ON "uptime_status_page" USING btree ("customDomain") WHERE "uptime_status_page"."customDomain" IS NOT NULL AND "uptime_status_page"."domainVerified" = true;
--> statement-breakpoint
-- Backfill and trigger installation share the migration transaction.
LOCK TABLE uptime_check_log IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO uptime_check_day ("monitorId", day, status, checks)
SELECT "uptimeMonitorId", left("createdAt", 10), status::text, count(*)::integer
FROM uptime_check_log GROUP BY "uptimeMonitorId", left("createdAt", 10), status;
--> statement-breakpoint
CREATE FUNCTION pulsy_check_day_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    DELETE FROM uptime_check_day;
    RETURN NULL;
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    UPDATE uptime_check_day d SET checks = d.checks - removed.checks
    FROM (SELECT "uptimeMonitorId" AS id, left("createdAt", 10) AS day,
                 status::text AS status, count(*)::integer AS checks
          FROM old_checks GROUP BY "uptimeMonitorId", left("createdAt", 10), status) removed
    WHERE d."monitorId" = removed.id AND d.day = removed.day AND d.status = removed.status;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO uptime_check_day ("monitorId", day, status, checks)
    SELECT "uptimeMonitorId", left("createdAt", 10), status::text, count(*)::integer
    FROM new_checks GROUP BY "uptimeMonitorId", left("createdAt", 10), status
    ORDER BY "uptimeMonitorId", left("createdAt", 10), status
    ON CONFLICT ("monitorId", day, status)
    DO UPDATE SET checks = uptime_check_day.checks + EXCLUDED.checks;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER uptime_check_day_insert AFTER INSERT ON uptime_check_log
REFERENCING NEW TABLE AS new_checks FOR EACH STATEMENT EXECUTE FUNCTION pulsy_check_day_changed();
--> statement-breakpoint
CREATE TRIGGER uptime_check_day_delete AFTER DELETE ON uptime_check_log
REFERENCING OLD TABLE AS old_checks FOR EACH STATEMENT EXECUTE FUNCTION pulsy_check_day_changed();
--> statement-breakpoint
CREATE TRIGGER uptime_check_day_update AFTER UPDATE ON uptime_check_log
REFERENCING OLD TABLE AS old_checks NEW TABLE AS new_checks FOR EACH STATEMENT EXECUTE FUNCTION pulsy_check_day_changed();
--> statement-breakpoint
CREATE TRIGGER uptime_check_day_truncate AFTER TRUNCATE ON uptime_check_log
FOR EACH STATEMENT EXECUTE FUNCTION pulsy_check_day_changed();
