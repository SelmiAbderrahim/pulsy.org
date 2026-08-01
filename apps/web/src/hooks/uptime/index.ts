/**
 * Uptime Hooks - Re-exports all uptime monitoring hooks
 *
 * @module hooks/uptime
 */

export { useBulkUptimeActions } from "./useBulkUptimeActions";
export { useIncidentSearch } from "./useIncidentSearch";
export {
	useCreateUptimeEmailProvider,
	useDeleteUptimeEmailProvider,
	useTestUptimeEmailProvider,
	useUpdateUptimeEmailProvider,
	useUptimeEmailProviders,
} from "./useUptimeEmailProviders";
export {
	useBulkUpdateUptimeSettings,
	useCheckNow,
	useCreateUptimeMonitor,
	useCreateUptimeMonitorsBulk,
	useDeleteUptimeMonitor,
	useToggleUptimeMonitor,
	useUpdateUptimeMonitor,
	useUptimeMonitor,
	useUptimeMonitors,
} from "./useUptimeMonitors";

export {
	useCreateUptimeDefaultChannel,
	useCreateUptimeNotificationChannel,
	useDeleteUptimeNotificationChannel,
	useTestUptimeNotificationChannel,
	useUpdateUptimeNotificationChannel,
	useUptimeDefaultChannels,
	useUptimeNotificationChannels,
} from "./useUptimeNotificationChannels";
export {
	useCloneSharedMonitors,
	useCreateUptimeShareLink,
	useResolveShareLink,
	useRevokeUptimeShareLink,
	useUptimeShareLinks,
} from "./useUptimeShareLinks";
export {
	useUptimeCheckLogs,
	useUptimeDashboardSummary,
	useUptimeIncident,
	useUptimeIncidents,
	useUptimeMonitorStats,
	useUptimeNotificationLogs,
	useUptimeStatusChanges,
} from "./useUptimeStats";
export {
	useUptimeSlaReport,
	useUptimeSlaReportSubscriptions,
	useUpsertUptimeSlaReportSubscription,
	useRemoveUptimeSlaReportSubscription,
	useSendUptimeSlaReportNow,
} from "./useUptimeSlaReport";
export {
	useStatusPages,
	useStatusPage,
	useCreateStatusPage,
	useUpdateStatusPage,
	useDeleteStatusPage,
	useSetStatusPageMonitors,
	useAttachStatusPageDomain,
	useVerifyStatusPageDomain,
	useDetachStatusPageDomain,
	useStatusPageDomainStatus,
	usePublicStatusPageBySlug,
	usePublicStatusPageByDomain,
} from "./useStatusPages";
