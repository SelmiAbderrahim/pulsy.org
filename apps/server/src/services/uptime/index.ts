export {
	updateUptimeMonitor,
	findUptimeMonitorById,
	findOwnedMonitor,
	listOwnedMonitors,
	deleteUptimeMonitor,
	type UptimeMonitor,
} from "./monitor-service";

export {
	createMonitorForUser,
	createMonitorsForUser,
	runManualCheck,
} from "./monitor-operations";

export {
	performHttpCheck,
	type HttpCheckResult,
} from "./checker-service";

export {
	computeStatusTransition,
} from "./status-transition";

export {
	checkTlsCertificate,
	type TlsCertificateInfo,
} from "./tls-checker-service";

export {
	scheduleMonitorCheck,
	cancelMonitorCheck,
	rescheduleMonitorCheck,
	initializeAllMonitors,
	executeCheck,
	shutdownScheduler,
} from "./scheduler-service";

export {
	dispatchNotifications,
	dispatchTlsExpiryNotifications,
	mergeChannelsForDispatch,
	buildEmailContent,
	sendWebhookNotification,
	sendSlackNotification,
	sendDiscordNotification,
	sendTelegramNotification,
} from "./notification-service";

export {
	decryptNotificationChannelSecrets,
	encryptNotificationChannelSecrets,
	maskNotificationChannel,
	migrateLegacyNotificationChannelSecrets,
	NOTIFICATION_CHANNEL_SECRET_VERSION,
	type MaskedNotificationChannel,
} from "./notification-channel-secrets";

export {
	createEmailProvider,
	updateEmailProvider,
	deleteEmailProvider,
	findEmailProviderById,
	findEmailProvidersByUser,
	testEmailProvider,
	sendViaProvider,
	type EmailAttachment,
} from "./email-provider-service";

export {
	createIncident,
	resolveIncident,
	findIncidentsByMonitor,
	getOngoingIncident,
} from "./incident-service";

export {
	getOwnedUptimeAggregates,
	getMonitorIncidentsForWindow,
	summarizeWindowIncidents,
	getMonitorStats,
	getMonitorStatsForWindow,
	getMonitorDailyUptime,
	getMonitorIncidentSummary,
	getCheckLogs,
	type MonitorStats,
	type DailyUptimeEntry,
	type IncidentSummary,
} from "./stats-service";

export {
	cleanupOldCheckLogs,
	cleanupOldIncidents,
	cleanupOldStatusChanges,
	cleanupOldNotificationLogs,
} from "./cleanup-service";

export {
	buildSlaReportModel,
	renderSlaReportPdf,
	renderSlaReportEmailHtml,
	slaReportPdfUrl,
	processSubscription,
	runMonthlySlaReports,
	type SlaReportModel,
	type SlaReportWindow,
	type ProcessSubscriptionResult,
} from "./sla-report-service";

export * from "./scheduler-leader";
export { cancelAllMonitorChecks, setSchedulingEnabled, reconcileScheduledMonitors, withMonitorCheckSlot } from "./scheduler-service";
