import { describe, expect, it } from "vitest";
import { uptimeKeys } from "./queryKeys";

describe("uptimeKeys factory", () => {
	it("builds the root key", () => {
		expect(uptimeKeys.all()).toEqual(["uptime"]);
	});

	it("builds monitor keys", () => {
		expect(uptimeKeys.monitors.all()).toEqual(["uptime", "monitors"]);
		expect(uptimeKeys.monitors.lists()).toEqual([
			"uptime",
			"monitors",
			"list",
		]);
		expect(uptimeKeys.monitors.details()).toEqual([
			"uptime",
			"monitors",
			"detail",
		]);
		expect(uptimeKeys.monitors.detail("m1")).toEqual([
			"uptime",
			"monitors",
			"detail",
			"m1",
		]);
	});

	it("builds status change keys", () => {
		expect(uptimeKeys.statusChanges.all()).toEqual([
			"uptime",
			"statusChanges",
		]);
		expect(uptimeKeys.statusChanges.list("m1")).toEqual([
			"uptime",
			"statusChanges",
			"m1",
		]);
	});

	it("builds check log keys", () => {
		expect(uptimeKeys.checkLogs.all()).toEqual(["uptime", "checkLogs"]);
		expect(uptimeKeys.checkLogs.list("m1")).toEqual([
			"uptime",
			"checkLogs",
			"list",
			"m1",
		]);
		expect(uptimeKeys.checkLogs.stats("m1")).toEqual([
			"uptime",
			"checkLogs",
			"stats",
			"m1",
		]);
	});

	it("builds notification-log keys, defaulting the monitor segment to 'all'", () => {
		expect(uptimeKeys.notificationLogs.all()).toEqual([
			"uptime",
			"notificationLogs",
		]);
		expect(uptimeKeys.notificationLogs.list("m1", 0)).toEqual([
			"uptime",
			"notificationLogs",
			"list",
			"m1",
			0,
		]);
		expect(uptimeKeys.notificationLogs.list(undefined, 25)).toEqual([
			"uptime",
			"notificationLogs",
			"list",
			"all",
			25,
		]);
	});

	it("builds incident keys", () => {
		expect(uptimeKeys.incidents.all()).toEqual(["uptime", "incidents"]);
		expect(uptimeKeys.incidents.list("m1")).toEqual([
			"uptime",
			"incidents",
			"list",
			"m1",
		]);
		expect(uptimeKeys.incidents.detail("i1")).toEqual([
			"uptime",
			"incidents",
			"detail",
			"i1",
		]);
		expect(uptimeKeys.incidents.search("api")).toEqual([
			"uptime",
			"incidents",
			"search",
			"api",
		]);
	});

	it("builds email provider keys", () => {
		expect(uptimeKeys.emailProviders.all()).toEqual([
			"uptime",
			"emailProviders",
		]);
		expect(uptimeKeys.emailProviders.lists()).toEqual([
			"uptime",
			"emailProviders",
			"list",
		]);
		expect(uptimeKeys.emailProviders.detail("e1")).toEqual([
			"uptime",
			"emailProviders",
			"detail",
			"e1",
		]);
	});

	it("builds channel keys", () => {
		expect(uptimeKeys.channels.all()).toEqual(["uptime", "channels"]);
		expect(uptimeKeys.channels.list("m1")).toEqual([
			"uptime",
			"channels",
			"list",
			"m1",
		]);
		expect(uptimeKeys.channels.defaults()).toEqual([
			"uptime",
			"channels",
			"defaults",
		]);
	});

	it("builds share link keys", () => {
		expect(uptimeKeys.shareLinks.all()).toEqual(["uptime", "shareLinks"]);
		expect(uptimeKeys.shareLinks.lists()).toEqual([
			"uptime",
			"shareLinks",
			"list",
		]);
		expect(uptimeKeys.shareLinks.resolve("tok1")).toEqual([
			"uptime",
			"shareLinks",
			"resolve",
			"tok1",
		]);
	});

	it("builds dashboard keys", () => {
		expect(uptimeKeys.dashboard.all()).toEqual(["uptime", "dashboard"]);
		expect(uptimeKeys.dashboard.summary()).toEqual([
			"uptime",
			"dashboard",
			"summary",
		]);
	});

	it("builds status page keys", () => {
		expect(uptimeKeys.statusPages.all()).toEqual(["uptime", "statusPages"]);
		expect(uptimeKeys.statusPages.lists()).toEqual([
			"uptime",
			"statusPages",
			"list",
		]);
		expect(uptimeKeys.statusPages.detail("p1")).toEqual([
			"uptime",
			"statusPages",
			"detail",
			"p1",
		]);
	});

	it("builds public status keys", () => {
		expect(uptimeKeys.public.all()).toEqual(["uptime", "public"]);
		expect(uptimeKeys.public.status("u1")).toEqual([
			"uptime",
			"public",
			"status",
			"u1",
		]);
		expect(uptimeKeys.public.bySlug("u1", "api")).toEqual([
			"uptime",
			"public",
			"bySlug",
			"u1",
			"api",
		]);
		expect(uptimeKeys.public.byDomain("status.acme.com")).toEqual([
			"uptime",
			"public",
			"byDomain",
			"status.acme.com",
		]);
	});
});
