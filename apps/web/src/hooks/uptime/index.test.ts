import { describe, expect, it } from "vitest";
import * as uptimeHooks from "./index";

describe("hooks/uptime barrel", () => {
	it("re-exports every public uptime hook", () => {
		const names = [
			"useBulkUptimeActions",
			"useIncidentSearch",
			"useCreateUptimeEmailProvider",
			"useDeleteUptimeEmailProvider",
			"useTestUptimeEmailProvider",
			"useUpdateUptimeEmailProvider",
			"useUptimeEmailProviders",
			"useCheckNow",
			"useCreateUptimeMonitor",
			"useCreateUptimeMonitorsBulk",
			"useDeleteUptimeMonitor",
			"useToggleUptimeMonitor",
			"useUpdateUptimeMonitor",
			"useUptimeMonitor",
			"useUptimeMonitors",
			"useCreateUptimeNotificationChannel",
			"useDeleteUptimeNotificationChannel",
			"useTestUptimeNotificationChannel",
			"useUpdateUptimeNotificationChannel",
			"useUptimeNotificationChannels",
			"useCloneSharedMonitors",
			"useCreateUptimeShareLink",
			"useResolveShareLink",
			"useRevokeUptimeShareLink",
			"useUptimeShareLinks",
			"useUptimeCheckLogs",
			"useUptimeDashboardSummary",
			"useUptimeIncident",
			"useUptimeIncidents",
			"useUptimeMonitorStats",
			"useUptimeNotificationLogs",
			"useUptimeStatusChanges",
		] as const;
		for (const name of names) {
			expect(typeof (uptimeHooks as Record<string, unknown>)[name]).toBe(
				"function",
			);
		}
	});
});
