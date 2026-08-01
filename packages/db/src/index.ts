export {
	db,
	schema,
	closeDb,
	type Database,
	type DbTransaction,
	type DbExecutor,
} from "./client";
export * from "./schema/index";

// Inferred row types for convenience across the server.
import type {
	uptimeMonitor,
	uptimeStatusChange,
	uptimeCheckLog,
	uptimeEmailProvider,
	uptimeNotificationChannel,
	uptimeNotificationLog,
	uptimeIncident,
	uptimeShareLink,
	uptimeSlaReportSubscription,
	uptimeStatusPage,
	uptimeStatusPageMonitor,
	user,
	session,
} from "./schema/index";

export type UptimeMonitorRow = typeof uptimeMonitor.$inferSelect;
export type UptimeMonitorInsert = typeof uptimeMonitor.$inferInsert;
export type UptimeStatusChangeRow = typeof uptimeStatusChange.$inferSelect;
export type UptimeCheckLogRow = typeof uptimeCheckLog.$inferSelect;
export type UptimeEmailProviderRow = typeof uptimeEmailProvider.$inferSelect;
export type UptimeNotificationChannelRow =
	typeof uptimeNotificationChannel.$inferSelect;
export type UptimeNotificationLogRow =
	typeof uptimeNotificationLog.$inferSelect;
export type UptimeNotificationLogInsert =
	typeof uptimeNotificationLog.$inferInsert;
export type UptimeIncidentRow = typeof uptimeIncident.$inferSelect;
export type UptimeShareLinkRow = typeof uptimeShareLink.$inferSelect;
export type UptimeShareLinkInsert = typeof uptimeShareLink.$inferInsert;
export type UptimeSlaReportSubscriptionRow =
	typeof uptimeSlaReportSubscription.$inferSelect;
export type UptimeSlaReportSubscriptionInsert =
	typeof uptimeSlaReportSubscription.$inferInsert;
export type UptimeStatusPageRow = typeof uptimeStatusPage.$inferSelect;
export type UptimeStatusPageInsert = typeof uptimeStatusPage.$inferInsert;
export type UptimeStatusPageMonitorRow =
	typeof uptimeStatusPageMonitor.$inferSelect;
export type UptimeStatusPageMonitorInsert =
	typeof uptimeStatusPageMonitor.$inferInsert;
export type UserRow = typeof user.$inferSelect;
export type SessionRow = typeof session.$inferSelect;
