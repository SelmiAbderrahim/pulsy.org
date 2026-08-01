/**
 * Uptime React Query key factory.
 *
 * Single source of truth for uptime-related query keys. Always use this
 * factory; never build ad-hoc keys.
 *
 * @module hooks/uptime/queryKeys
 */

export const uptimeKeys = {
	/** All uptime-related queries */
	all: () => ["uptime"] as const,

	/** Monitor queries */
	monitors: {
		all: () => [...uptimeKeys.all(), "monitors"] as const,
		lists: () => [...uptimeKeys.monitors.all(), "list"] as const,
		details: () => [...uptimeKeys.monitors.all(), "detail"] as const,
		detail: (id: string) => [...uptimeKeys.monitors.details(), id] as const,
	},

	/** Status change queries */
	statusChanges: {
		all: () => [...uptimeKeys.all(), "statusChanges"] as const,
		list: (monitorId: string) =>
			[...uptimeKeys.statusChanges.all(), monitorId] as const,
	},

	/** Check log queries */
	checkLogs: {
		all: () => [...uptimeKeys.all(), "checkLogs"] as const,
		list: (monitorId: string) =>
			[...uptimeKeys.checkLogs.all(), "list", monitorId] as const,
		stats: (monitorId: string) =>
			[...uptimeKeys.checkLogs.all(), "stats", monitorId] as const,
	},

	/** Notification delivery-log queries */
	notificationLogs: {
		all: () => [...uptimeKeys.all(), "notificationLogs"] as const,
		list: (monitorId: string | undefined, offset: number) =>
			[
				...uptimeKeys.notificationLogs.all(),
				"list",
				monitorId ?? "all",
				offset,
			] as const,
	},

	/** Incident queries */
	incidents: {
		all: () => [...uptimeKeys.all(), "incidents"] as const,
		list: (monitorId: string) =>
			[...uptimeKeys.incidents.all(), "list", monitorId] as const,
		detail: (id: string) =>
			[...uptimeKeys.incidents.all(), "detail", id] as const,
		search: (query: string) =>
			[...uptimeKeys.incidents.all(), "search", query] as const,
	},

	/** Email provider queries */
	emailProviders: {
		all: () => [...uptimeKeys.all(), "emailProviders"] as const,
		lists: () => [...uptimeKeys.emailProviders.all(), "list"] as const,
		detail: (id: string) =>
			[...uptimeKeys.emailProviders.all(), "detail", id] as const,
	},

	/** Notification channel queries */
	channels: {
		all: () => [...uptimeKeys.all(), "channels"] as const,
		list: (monitorId: string) =>
			[...uptimeKeys.channels.all(), "list", monitorId] as const,
		defaults: () => [...uptimeKeys.channels.all(), "defaults"] as const,
	},

	/** Share link queries */
	shareLinks: {
		all: () => [...uptimeKeys.all(), "shareLinks"] as const,
		lists: () => [...uptimeKeys.shareLinks.all(), "list"] as const,
		resolve: (token: string) =>
			[...uptimeKeys.shareLinks.all(), "resolve", token] as const,
	},

	/** SLA report queries */
	slaReports: {
		all: () => [...uptimeKeys.all(), "slaReports"] as const,
		detail: (monitorId: string, days: number) =>
			[...uptimeKeys.slaReports.all(), "detail", monitorId, days] as const,
		subscriptions: () =>
			[...uptimeKeys.slaReports.all(), "subscriptions"] as const,
	},

	/** API key queries */
	apiKeys: {
		all: () => [...uptimeKeys.all(), "apiKeys"] as const,
		lists: () => [...uptimeKeys.apiKeys.all(), "list"] as const,
	},

	/** Dashboard queries */
	dashboard: {
		all: () => [...uptimeKeys.all(), "dashboard"] as const,
		summary: () => [...uptimeKeys.dashboard.all(), "summary"] as const,
	},

	/** Status page management queries */
	statusPages: {
		all: () => [...uptimeKeys.all(), "statusPages"] as const,
		lists: () => [...uptimeKeys.statusPages.all(), "list"] as const,
		detail: (id: string) =>
			[...uptimeKeys.statusPages.all(), "detail", id] as const,
		domainStatus: (id: string) =>
			[...uptimeKeys.statusPages.all(), "domainStatus", id] as const,
	},

	/** Public status page queries */
	public: {
		all: () => [...uptimeKeys.all(), "public"] as const,
		status: (userId: string) =>
			[...uptimeKeys.public.all(), "status", userId] as const,
		bySlug: (userId: string, slug: string) =>
			[...uptimeKeys.public.all(), "bySlug", userId, slug] as const,
		byDomain: (host: string) =>
			[...uptimeKeys.public.all(), "byDomain", host] as const,
	},
} as const;
