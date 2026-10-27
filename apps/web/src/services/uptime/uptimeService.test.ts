import { beforeEach, describe, expect, it, vi } from "vitest";
import { trpcMutation, trpcQuery } from "@/lib/api/trpc";
import { UptimeService } from "./uptimeService";

vi.mock("@/lib/api/trpc", () => ({
	trpcQuery: vi.fn(),
	trpcMutation: vi.fn(),
	SERVER_URL: "",
}));

const mockQuery = vi.mocked(trpcQuery);
const mockMutation = vi.mocked(trpcMutation);

beforeEach(() => {
	vi.clearAllMocks();
	mockQuery.mockResolvedValue(undefined as never);
	mockMutation.mockResolvedValue(undefined as never);
});

describe("UptimeService monitor CRUD", () => {
	it("listMonitors queries monitor.list", async () => {
    mockQuery.mockResolvedValueOnce([]);
		await UptimeService.listMonitors();
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "monitor.list");
	});

	it("getMonitor queries monitor.one with the id", async () => {
		await UptimeService.getMonitor("m1");
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "monitor.one", {
			uptimeMonitorId: "m1",
		});
	});

	it("createMonitor mutates monitor.create with input", async () => {
		const input = { name: "x", url: "https://x.com" } as never;
		await UptimeService.createMonitor(input);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"monitor.create",
			input,
		);
	});

	it("createMonitorsBulk wraps monitors in a { monitors } payload", async () => {
		const monitors = [{ name: "a" }, { name: "b" }] as never[];
		await UptimeService.createMonitorsBulk(monitors);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"monitor.createBulk",
			{ monitors },
		);
	});

	it("updateMonitor mutates monitor.update with input", async () => {
		const input = { uptimeMonitorId: "m1", name: "y" } as never;
		await UptimeService.updateMonitor(input);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"monitor.update",
			input,
		);
	});

	it("updateMonitorsBulk mutates monitor.updateBulk with the payload", async () => {
		const input = {
			monitorIds: ["m1", "m2"],
			patch: { timeout: 5000 },
		} as never;
    const updated = [{ uptimeMonitorId: "m1" }, { uptimeMonitorId: "m2" }];
    mockMutation.mockResolvedValueOnce({ updated, results: updated.map(row => ({ id: row.uptimeMonitorId, status: "updated" })) } as never);
    expect(await UptimeService.updateMonitorsBulk(input)).toEqual({ updated, results: updated.map(row => ({ id: row.uptimeMonitorId, status: "updated" })) });
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"monitor.updateBulk",
			input,
		);
	});

	it("deleteMonitor mutates monitor.delete with the id", async () => {
		await UptimeService.deleteMonitor("m1");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"monitor.delete",
			{ uptimeMonitorId: "m1" },
		);
	});

	it("toggleActive mutates monitor.toggleActive with the id", async () => {
		await UptimeService.toggleActive("m1");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"monitor.toggleActive",
			{ uptimeMonitorId: "m1" },
		);
	});

	it("checkNow mutates monitor.checkNow with the id", async () => {
		await UptimeService.checkNow("m1");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"monitor.checkNow",
			{ uptimeMonitorId: "m1" },
		);
	});
});

describe("UptimeService status changes & check logs", () => {
	it("listStatusChanges queries statusChange.list with limit", async () => {
		await UptimeService.listStatusChanges("m1", 10);
		expect(mockQuery).toHaveBeenCalledWith(
			"uptimeMonitor",
			"statusChange.list",
			{ uptimeMonitorId: "m1", limit: 10 },
		);
	});

	it("listStatusChanges passes undefined limit when omitted", async () => {
		await UptimeService.listStatusChanges("m1");
		expect(mockQuery).toHaveBeenCalledWith(
			"uptimeMonitor",
			"statusChange.list",
			{ uptimeMonitorId: "m1", limit: undefined },
		);
	});

	it("listCheckLogs spreads pagination options", async () => {
		await UptimeService.listCheckLogs("m1", { limit: 5, offset: 10 });
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "checkLog.list", {
			uptimeMonitorId: "m1",
			limit: 5,
			offset: 10,
		});
	});

	it("listCheckLogs works without options", async () => {
		await UptimeService.listCheckLogs("m1");
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "checkLog.list", {
			uptimeMonitorId: "m1",
		});
	});

	it("getCheckLogStats queries checkLog.stats with days", async () => {
		await UptimeService.getCheckLogStats("m1", 7);
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "checkLog.stats", {
			uptimeMonitorId: "m1",
			days: 7,
		});
	});

	it("listNotificationLogs scopes to a monitor with pagination", async () => {
		await UptimeService.listNotificationLogs({
			uptimeMonitorId: "m1",
			limit: 25,
			offset: 25,
		});
		expect(mockQuery).toHaveBeenCalledWith(
			"uptimeMonitor",
			"notificationLog.list",
			{ uptimeMonitorId: "m1", limit: 25, offset: 25 },
		);
	});

	it("listNotificationLogs works without options (account-wide history)", async () => {
		await UptimeService.listNotificationLogs();
		expect(mockQuery).toHaveBeenCalledWith(
			"uptimeMonitor",
			"notificationLog.list",
			{},
		);
	});
});

describe("UptimeService incidents", () => {
	it("listIncidents queries incident.list with limit", async () => {
		await UptimeService.listIncidents("m1", 3);
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "incident.list", {
			uptimeMonitorId: "m1",
			limit: 3,
		});
	});

	it("getIncident queries incident.one with id", async () => {
		await UptimeService.getIncident("i1");
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "incident.one", {
			incidentId: "i1",
		});
	});

	it("searchIncidents queries incident.search with the query", async () => {
		await UptimeService.searchIncidents("api");
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "incident.search", {
			query: "api",
		}, undefined);
	});

  it("passes cancellation through for superseded incident searches", async () => {
    const signal = new AbortController().signal;
    await UptimeService.searchIncidents("api", signal);
    expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "incident.search", { query: "api" }, { signal });
  });
});

describe("UptimeService email providers", () => {
	it("listEmailProviders queries emailProvider.list", async () => {
		await UptimeService.listEmailProviders();
		expect(mockQuery).toHaveBeenCalledWith(
			"uptimeMonitor",
			"emailProvider.list",
		);
	});

	it("createEmailProvider mutates emailProvider.create with input", async () => {
		const input = { provider: "resend" } as never;
		await UptimeService.createEmailProvider(input);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"emailProvider.create",
			input,
		);
	});

	it("updateEmailProvider mutates emailProvider.update with input", async () => {
		const input = { emailProviderId: "e1" } as never;
		await UptimeService.updateEmailProvider(input);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"emailProvider.update",
			input,
		);
	});

	it("deleteEmailProvider mutates emailProvider.delete with id", async () => {
		await UptimeService.deleteEmailProvider("e1");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"emailProvider.delete",
			{ emailProviderId: "e1" },
		);
	});

	it("testEmailProvider mutates emailProvider.test with id", async () => {
		await UptimeService.testEmailProvider("e1");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"emailProvider.test",
			{ emailProviderId: "e1" },
		);
	});
});

describe("UptimeService notification channels", () => {
	it("listChannels queries channel.list with monitor id", async () => {
		await UptimeService.listChannels("m1");
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "channel.list", {
			uptimeMonitorId: "m1",
		});
	});

	it("listDefaultChannels queries channel.listDefaults", async () => {
		await UptimeService.listDefaultChannels();
		expect(mockQuery).toHaveBeenCalledWith(
			"uptimeMonitor",
			"channel.listDefaults",
		);
	});

	it("createDefaultChannel mutates channel.createDefault with input", async () => {
		const input = { channelType: "webhook" as const };
		await UptimeService.createDefaultChannel(input);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"channel.createDefault",
			{ ...input, signingSecret: expect.stringMatching(/^[a-f0-9]{64}$/) },
		);
	});

	it("createChannel mutates channel.create with input", async () => {
		const input = { uptimeMonitorId: "m1", channelType: "webhook" as const };
		await UptimeService.createChannel(input);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"channel.create",
			{ ...input, signingSecret: expect.stringMatching(/^[a-f0-9]{64}$/) },
		);
	});

	it("updateChannel mutates channel.update with input", async () => {
		const input = { channelId: "c1" } as never;
		await UptimeService.updateChannel(input);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"channel.update",
			input,
		);
	});

	it("deleteChannel mutates channel.delete with id", async () => {
		await UptimeService.deleteChannel("c1");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"channel.delete",
			{ channelId: "c1" },
		);
	});

	it("testChannel mutates channel.test with id", async () => {
		await UptimeService.testChannel("c1");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"channel.test",
			{ channelId: "c1" },
		);
	});
});

describe("UptimeService dashboard & public status", () => {
	it("getDashboardSummary queries dashboard.summary", async () => {
		await UptimeService.getDashboardSummary();
		expect(mockQuery).toHaveBeenCalledWith(
			"uptimeMonitor",
			"dashboard.summary",
		);
	});

	it("getPublicStatus queries public.status with userId", async () => {
		await UptimeService.getPublicStatus("u1");
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "public.status", {
			userId: "u1",
		});
	});
});

describe("UptimeService share links", () => {
	it("createShareLink mutates share.create with input", async () => {
		const input = { uptimeMonitorIds: ["m1"], expiresInDays: 7 as const };
		await UptimeService.createShareLink(input);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"share.create",
			input,
		);
	});

	it("listShareLinks queries share.list", async () => {
		await UptimeService.listShareLinks();
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "share.list");
	});

	it("revokeShareLink mutates share.revoke with the id", async () => {
		await UptimeService.revokeShareLink("s1");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"share.revoke",
			{ shareLinkId: "s1" },
		);
	});

	it("resolveShareLink queries public.sharedLink with the token", async () => {
		await UptimeService.resolveShareLink("tok123");
		expect(mockQuery).toHaveBeenCalledWith(
			"uptimeMonitor",
			"public.sharedLink",
			{ token: "tok123" },
		);
	});

	it("cloneSharedMonitors mutates share.clone with token and ids", async () => {
		await UptimeService.cloneSharedMonitors("tok123", ["m1", "m2"]);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"share.clone",
			{ token: "tok123", uptimeMonitorIds: ["m1", "m2"] },
		);
	});
});

describe("UptimeService SLA reports", () => {
	it("getSlaReport queries slaReport.data with days", async () => {
		await UptimeService.getSlaReport("m1", 30);
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "slaReport.data", {
			uptimeMonitorId: "m1",
			days: 30,
		});
	});

	it("getSlaReport omits days when not provided", async () => {
		await UptimeService.getSlaReport("m1");
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "slaReport.data", {
			uptimeMonitorId: "m1",
		});
	});

	it("slaReportPdfUrl builds the encoded download path", () => {
		expect(UptimeService.slaReportPdfUrl("m1", 30)).toBe(
			"/api/reports/sla/m1.pdf?days=30",
		);
		// Default days.
		expect(UptimeService.slaReportPdfUrl("m1")).toContain("days=30");
	});

	it("listSlaReportSubscriptions queries subscription.list", async () => {
		await UptimeService.listSlaReportSubscriptions();
		expect(mockQuery).toHaveBeenCalledWith(
			"uptimeMonitor",
			"slaReport.subscription.list",
		);
	});

	it("upsertSlaReportSubscription mutates subscription.upsert", async () => {
		const input = {
			recipientAddresses: ["a@x.test"],
			emailProviderId: "p1",
		};
		await UptimeService.upsertSlaReportSubscription(input);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"slaReport.subscription.upsert",
			input,
		);
	});

	it("removeSlaReportSubscription mutates subscription.remove", async () => {
		await UptimeService.removeSlaReportSubscription("s1");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"slaReport.subscription.remove",
			{ slaReportSubscriptionId: "s1" },
		);
	});

	it("sendSlaReportNow mutates subscription.sendNow", async () => {
		await UptimeService.sendSlaReportNow("s1");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"slaReport.subscription.sendNow",
			{ slaReportSubscriptionId: "s1" },
		);
	});
});

describe("UptimeService status pages", () => {
	it("listStatusPages queries statusPage.list", async () => {
		await UptimeService.listStatusPages();
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "statusPage.list");
	});

	it("getStatusPage queries statusPage.one with the id", async () => {
		await UptimeService.getStatusPage("p1");
		expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "statusPage.one", {
			statusPageId: "p1",
		});
	});

	it("getStatusPageDomainStatus queries statusPage.domainStatus", async () => {
		await UptimeService.getStatusPageDomainStatus("p1");
		expect(mockQuery).toHaveBeenCalledWith(
			"uptimeMonitor",
			"statusPage.domainStatus",
			{ statusPageId: "p1" },
		);
	});

	it("createStatusPage mutates statusPage.create", async () => {
		const input = { slug: "s", title: "t" } as never;
		await UptimeService.createStatusPage(input);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"statusPage.create",
			input,
		);
	});

	it("updateStatusPage mutates statusPage.update", async () => {
		const input = { statusPageId: "p1", title: "t" } as never;
		await UptimeService.updateStatusPage(input);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"statusPage.update",
			input,
		);
	});

	it("deleteStatusPage mutates statusPage.delete", async () => {
		await UptimeService.deleteStatusPage("p1");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"statusPage.delete",
			{ statusPageId: "p1" },
		);
	});

	it("setStatusPageMonitors mutates statusPage.setMonitors", async () => {
		await UptimeService.setStatusPageMonitors("p1", ["m1", "m2"]);
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"statusPage.setMonitors",
			{ statusPageId: "p1", uptimeMonitorIds: ["m1", "m2"] },
		);
	});

	it("attachStatusPageDomain mutates statusPage.attachDomain", async () => {
		await UptimeService.attachStatusPageDomain("p1", "status.example.com");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"statusPage.attachDomain",
			{ statusPageId: "p1", customDomain: "status.example.com" },
		);
	});

	it("verifyStatusPageDomain mutates statusPage.verifyDomain", async () => {
		await UptimeService.verifyStatusPageDomain("p1");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"statusPage.verifyDomain",
			{ statusPageId: "p1" },
		);
	});

	it("detachStatusPageDomain mutates statusPage.detachDomain", async () => {
		await UptimeService.detachStatusPageDomain("p1");
		expect(mockMutation).toHaveBeenCalledWith(
			"uptimeMonitor",
			"statusPage.detachDomain",
			{ statusPageId: "p1" },
		);
	});

	it("getStatusPageBySlug queries public.statusPageBySlug", async () => {
		await UptimeService.getStatusPageBySlug("u1", "api");
		expect(mockQuery).toHaveBeenCalledWith(
			"uptimeMonitor",
			"public.statusPageBySlug",
			{ userId: "u1", slug: "api" },
		);
	});

	it("getStatusPageByDomain queries public.statusPageByDomain", async () => {
		await UptimeService.getStatusPageByDomain("status.acme.com");
		expect(mockQuery).toHaveBeenCalledWith(
			"uptimeMonitor",
			"public.statusPageByDomain",
			{ host: "status.acme.com" },
		);
	});
});


describe("UptimeService daily coverage and complete monitor collections", () => {
  it("requests exact daily windows with the calendar aggregate contract", async () => {
    await UptimeService.getDailyUptime("m1");
    expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "checkLog.daily", { uptimeMonitorId: "m1", days: 90 });
    await UptimeService.getDailyUptime("m2", 7);
    expect(mockQuery).toHaveBeenCalledWith("uptimeMonitor", "checkLog.daily", { uptimeMonitorId: "m2", days: 7 });
  });
  it("collects successive owner-scoped pages rather than truncating a large fleet", async () => {
    const first = Array.from({ length: 200 }, (_, id) => ({ uptimeMonitorId: `monitor-${id}` }));
    const second = Array.from({ length: 200 }, (_, id) => ({ uptimeMonitorId: `monitor-${id + 200}` }));
    const last = [{ uptimeMonitorId: "monitor-400" }];
    mockQuery.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(last);
    expect(await UptimeService.listMonitors()).toEqual([...first, ...second, ...last]);
    expect(mockQuery.mock.calls).toEqual([
      ["uptimeMonitor", "monitor.list"],
      ["uptimeMonitor", "monitor.list", { cursor: "monitor-199" }],
      ["uptimeMonitor", "monitor.list", { cursor: "monitor-399" }],
    ]);
  });
});


it("sends large membership previews in a POST body without putting selected monitor IDs in a URL", async () => {
 const ids = Array.from({ length: 1000 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
 await UptimeService.previewStatusPageMonitors("owned-page", ids);
 expect(mockMutation).toHaveBeenCalledWith("uptimeMonitor", "statusPage.setMonitorsPreviewPost", { statusPageId: "owned-page", uptimeMonitorIds: ids });
 expect(mockQuery).not.toHaveBeenCalled();
});

describe("webhook secrets stay local when server responses are masked", () => {
  it.each(["default", "monitor"] as const)("creates a %s webhook with the same local secret sent for encryption", async kind => {
    mockMutation.mockResolvedValueOnce({ channelId: "channel-1", channelType: "webhook" } as never);
    const input = { channelType: "webhook" as const, webhookUrl: "https://example.test/hook" };
    const created = kind === "default"
      ? await UptimeService.createDefaultChannel(input)
      : await UptimeService.createChannel({ ...input, uptimeMonitorId: "monitor-1" });
    expect(created.signingSecret).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(mockMutation).toHaveBeenCalledWith("uptimeMonitor", kind === "default" ? "channel.createDefault" : "channel.create", {
      ...input, ...(kind === "monitor" ? { uptimeMonitorId: "monitor-1" } : {}), signingSecret: created.signingSecret,
    });
  });

  it("rotates to fresh locally generated secrets while the server returns only an outcome", async () => {
    mockMutation.mockResolvedValue({ rotated: true } as never);
    const first = await UptimeService.rotateChannelSecret("channel-1");
    const second = await UptimeService.rotateChannelSecret("channel-1");
    expect(first.signingSecret).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(second.signingSecret).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(second.signingSecret).not.toBe(first.signingSecret);
    expect(mockMutation).toHaveBeenNthCalledWith(1, "uptimeMonitor", "channel.rotateSecret", { channelId: "channel-1", signingSecret: first.signingSecret });
    expect(mockMutation).toHaveBeenNthCalledWith(2, "uptimeMonitor", "channel.rotateSecret", { channelId: "channel-1", signingSecret: second.signingSecret });
  });

  it("does not report a new local secret when the server rejects rotation", async () => {
    mockMutation.mockRejectedValueOnce(new Error("Request rejected"));
    await expect(UptimeService.rotateChannelSecret("channel-1")).rejects.toThrow("Request rejected");
  });

  it("requires cryptographic randomness before making a secret mutation", async () => {
    const random = vi.spyOn(crypto, "getRandomValues").mockImplementation(() => { throw new Error("Randomness unavailable"); });
    try {
      await expect(UptimeService.rotateChannelSecret("channel-1")).rejects.toThrow("Randomness unavailable");
      expect(mockMutation).not.toHaveBeenCalled();
    } finally { random.mockRestore(); }
  });

  it("leaves non-webhook channels free of signing material", async () => {
    const input = { channelType: "email" as const, recipientAddresses: ["owner@example.test"] };
    mockMutation.mockResolvedValueOnce({ channelId: "channel-1", channelType: "email" } as never);
    const created = await UptimeService.createDefaultChannel(input);
    expect(created).not.toHaveProperty("signingSecret");
    expect(mockMutation).toHaveBeenCalledWith("uptimeMonitor", "channel.createDefault", input);
  });
});
