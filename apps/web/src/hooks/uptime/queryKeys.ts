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
  reliability: {
    all: () => [...uptimeKeys.all(), "reliability"] as const,
    detail: (ownerId: string | undefined, id: string, window: unknown) => [...uptimeKeys.reliability.all(), ownerId, id, window] as const,
    annotations: (ownerId: string | undefined, id: string, window: unknown, cursor: unknown) => [...uptimeKeys.reliability.all(), "annotations", ownerId, id, window, cursor] as const,
    incidents: (ownerId: string | undefined, id: string, window: unknown, cursor: unknown) => [...uptimeKeys.reliability.all(), "causes", ownerId, id, window, cursor] as const,
    policies: (ownerId: string | undefined, id: string, before?: number) => [...uptimeKeys.reliability.all(), "policies", ownerId, id, before] as const,
  },
  server: {
    detail: (id: string, ownerId?: string) => [...uptimeKeys.all(), "server", ownerId, id] as const,
    history: (id: string, hours: number, ownerId?: string) => [...uptimeKeys.all(), "serverHistory", ownerId, id, hours] as const,
  },
  heartbeat: {
    detail: (id: string, ownerId?: string) => [...uptimeKeys.all(), "heartbeat", ownerId, id] as const,
    runs: (id: string, ownerId?: string) => [...uptimeKeys.all(), "heartbeatRuns", ownerId, id] as const,
  },
  views: {
    list: (ownerId?: string) => [...uptimeKeys.all(), "personalViews", ownerId] as const,
    initials: (ownerId?: string) => [...uptimeKeys.all(), "initialView", ownerId] as const,
    initial: (ownerId?: string, id?:string) => [...uptimeKeys.all(), "initialView", ownerId, id] as const,
  },
  templates: {
    list: (ownerId?: string) => [...uptimeKeys.all(), "templates", ownerId] as const,
    channels: (ownerId?: string) => [...uptimeKeys.all(), "templateChannels", ownerId] as const,
  },
	maintenance: {
		all: () => [...uptimeKeys.all(), "maintenance"] as const,
	},

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
		list: (monitorId: string, pagination?: { limit?: number; offset?: number }) =>
			[...uptimeKeys.checkLogs.all(), "list", monitorId, ...(pagination ? [pagination] : [])] as const,
		daily: (monitorId: string, days?: number) =>
			[...uptimeKeys.checkLogs.all(), "daily", monitorId, ...(days === undefined ? [] : [days])] as const,
		stats: (monitorId: string, days?: number) =>
			[...uptimeKeys.checkLogs.all(), "stats", monitorId, ...(days === undefined ? [] : [days])] as const,
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

	/** Per-channel delivery health (account-wide) */
	channelHealth: {
		all: () => [...uptimeKeys.all(), "channelHealth"] as const,
		list: () => [...uptimeKeys.channelHealth.all(), "list"] as const,
	},

	/** Incident queries */
	incidents: {
		all: () => [...uptimeKeys.all(), "incidents"] as const,
    workspace: (ownerId: string | undefined, filters: unknown, cursor: unknown) => [...uptimeKeys.incidents.all(), "workspace", ownerId, filters, cursor] as const,
    response: (ownerId: string | undefined, incidentId: string) => [...uptimeKeys.incidents.all(), "response", ownerId, incidentId] as const,
    responseChannels: (ownerId: string | undefined, cursor?: string) => [...uptimeKeys.incidents.all(), "responseChannels", ownerId, cursor] as const,
    monitorChoices: (ownerId: string | undefined) => [...uptimeKeys.incidents.all(), "monitorChoices", ownerId] as const,
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
		details: (monitorId: string) => [...uptimeKeys.slaReports.all(), "detail", monitorId] as const,
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
    subscriptions: (ownerId: string | undefined, id: string) => [...uptimeKeys.statusPages.all(), "subscriptions", ownerId, id] as const,
    communication: (userId: string | undefined, id: string) => [...uptimeKeys.statusPages.all(), "communication", userId, id] as const,
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
