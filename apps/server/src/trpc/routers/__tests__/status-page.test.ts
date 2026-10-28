import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, uptimeCheckLog, uptimeIncident } from "@pulsy/db";
import {
	createTestMonitor,
	createTestStatusPage,
	createTestStatusPageMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";
import { authedCaller, publicCaller } from "../../../../test/trpc-caller";

// ---------------------------------------------------------------------------
// Domain verification resolves a user hostname over `dns/promises` (no HTTP →
// no SSRF surface). Mock the resolver so tests are deterministic and offline.
// ---------------------------------------------------------------------------

const { resolveTxt } = vi.hoisted(() => ({ resolveTxt: vi.fn() }));

vi.mock("node:dns/promises", () => ({
	// uptime.ts instantiates a dedicated `new Resolver()` at module scope, so the
	// mock must export the class (not just the free resolveTxt) or the module
	// fails to load.
	Resolver: class {
		setServers() {}
		resolveTxt(...args: unknown[]) {
			return resolveTxt(...args);
		}
	},
	resolveTxt: (...args: unknown[]) => resolveTxt(...args),
}));

useCleanDatabase();

let owner: Awaited<ReturnType<typeof createTestUser>>;
let attacker: Awaited<ReturnType<typeof createTestUser>>;

beforeEach(async () => {
	owner = await createTestUser({ email: "owner@pulsy.test" });
	attacker = await createTestUser({ email: "attacker@pulsy.test" });
	resolveTxt.mockReset();
	resolveTxt.mockResolvedValue([]);
});

function ownerCaller() {
	return authedCaller({ id: owner.id, email: owner.email });
}
function attackerCaller() {
	return authedCaller({ id: attacker.id, email: attacker.email });
}

// ---------------------------------------------------------------------------
// Management — list / one
// ---------------------------------------------------------------------------

describe("uptimeMonitor.statusPage.list", () => {
	it("returns only the caller's pages", async () => {
		await createTestStatusPage(owner.id, { slug: "mine" });
		await createTestStatusPage(attacker.id, { slug: "theirs" });
		const pages = await ownerCaller().uptimeMonitor.statusPage.list();
		const slugs = pages.map((p) => p.slug);
		// list() also auto-provisions the caller's free "default" page, so scope
		// is asserted by presence/absence rather than an exact count.
		expect(slugs).toContain("mine");
		expect(slugs).not.toContain("theirs");
	});

	it("requires authentication", async () => {
		await expect(
			publicCaller().uptimeMonitor.statusPage.list(),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

describe("uptimeMonitor.statusPage.one", () => {
	it("returns the page with its monitor ids in sort order", async () => {
		const page = await createTestStatusPage(owner.id);
		const m1 = await createTestMonitor(owner.id, { name: "A" });
		const m2 = await createTestMonitor(owner.id, { name: "B" });
		const foreign = await createTestMonitor(attacker.id, { name: "Foreign" });
		await createTestStatusPageMonitor(page.statusPageId, m2.uptimeMonitorId, {
			sortOrder: 0,
		});
		await createTestStatusPageMonitor(page.statusPageId, m1.uptimeMonitorId, {
			sortOrder: 1,
		});
		// Defense in depth for legacy/manually-corrupted link rows: the page read
		// still scopes the child monitor itself to the authenticated owner.
		await createTestStatusPageMonitor(page.statusPageId, foreign.uptimeMonitorId, {
			sortOrder: 2,
		});
		const res = await ownerCaller().uptimeMonitor.statusPage.one({
			statusPageId: page.statusPageId,
		});
		expect(res.monitorIds).toEqual([m2.uptimeMonitorId, m1.uptimeMonitorId]);
	});

	it("throws NOT_FOUND for another user's page (IDOR)", async () => {
		const page = await createTestStatusPage(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.statusPage.one({
				statusPageId: page.statusPageId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("throws NOT_FOUND for a missing page", async () => {
		await expect(
			ownerCaller().uptimeMonitor.statusPage.one({ statusPageId: "nope" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ---------------------------------------------------------------------------
// Management — create / update / delete
// ---------------------------------------------------------------------------

describe("uptimeMonitor.statusPage.create", () => {
	it("creates a page scoped to the user (unpublished by default)", async () => {
		const created = await ownerCaller().uptimeMonitor.statusPage.create({
			slug: "status",
			title: "Acme Status",
		});
		expect(created.userId).toBe(owner.id);
		expect(created.slug).toBe("status");
		expect(created.isPublished).toBe(false);
	});

	it("creates a published page when requested", async () => {
		const created = await ownerCaller().uptimeMonitor.statusPage.create({
			slug: "live",
			title: "Live",
			isPublished: true,
      confirmEmptyPublication: true,
		});
		expect(created.isPublished).toBe(true);
	});

	it("rejects a slug already used by the caller", async () => {
		await ownerCaller().uptimeMonitor.statusPage.create({
			slug: "dup",
			title: "One",
		});
		await expect(
			ownerCaller().uptimeMonitor.statusPage.create({
				slug: "dup",
				title: "Two",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("allows the same slug for a different user", async () => {
		await ownerCaller().uptimeMonitor.statusPage.create({
			slug: "shared",
			title: "Owner",
		});
		const other = await attackerCaller().uptimeMonitor.statusPage.create({
			slug: "shared",
			title: "Attacker",
		});
		expect(other.slug).toBe("shared");
	});
});

describe("uptimeMonitor.statusPage.update", () => {
	it("updates title, description, and publish state", async () => {
		const page = await createTestStatusPage(owner.id, { isPublished: false });
		const updated = await ownerCaller().uptimeMonitor.statusPage.update({
			statusPageId: page.statusPageId,
			title: "Renamed",
			description: "now described",
			isPublished: true,
      confirmEmptyPublication: true,
		});
		expect(updated.title).toBe("Renamed");
		expect(updated.description).toBe("now described");
		expect(updated.isPublished).toBe(true);
	});

	it("allows keeping the page's own slug (excludes itself from the check)", async () => {
		const page = await createTestStatusPage(owner.id, { slug: "keep" });
		const updated = await ownerCaller().uptimeMonitor.statusPage.update({
			statusPageId: page.statusPageId,
			slug: "keep",
			title: "Same slug",
		});
		expect(updated.slug).toBe("keep");
	});

	it("rejects a slug already taken by another of the caller's pages", async () => {
		await createTestStatusPage(owner.id, { slug: "taken" });
		const page = await createTestStatusPage(owner.id, { slug: "other" });
		await expect(
			ownerCaller().uptimeMonitor.statusPage.update({
				statusPageId: page.statusPageId,
				slug: "taken",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("throws NOT_FOUND for another user's page", async () => {
		const page = await createTestStatusPage(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.statusPage.update({
				statusPageId: page.statusPageId,
				title: "hijack",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("uptimeMonitor.statusPage.delete", () => {
	it("deletes the caller's page", async () => {
		const page = await createTestStatusPage(owner.id);
		const res = await ownerCaller().uptimeMonitor.statusPage.delete({
			statusPageId: page.statusPageId,
		});
		expect(res.success).toBe(true);
		await expect(
			ownerCaller().uptimeMonitor.statusPage.one({
				statusPageId: page.statusPageId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("throws NOT_FOUND for another user's page", async () => {
		const page = await createTestStatusPage(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.statusPage.delete({
				statusPageId: page.statusPageId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ---------------------------------------------------------------------------
// Management — setMonitors
// ---------------------------------------------------------------------------

describe("uptimeMonitor.statusPage.setMonitors", () => {
	it("links the caller's monitors in submitted order", async () => {
		const page = await createTestStatusPage(owner.id);
		const m1 = await createTestMonitor(owner.id, { name: "A" });
		const m2 = await createTestMonitor(owner.id, { name: "B" });
		const res = await ownerCaller().uptimeMonitor.statusPage.setMonitors({
			statusPageId: page.statusPageId,
			uptimeMonitorIds: [m2.uptimeMonitorId, m1.uptimeMonitorId],
		});
		expect(res.count).toBe(2);
		const one = await ownerCaller().uptimeMonitor.statusPage.one({
			statusPageId: page.statusPageId,
		});
		expect(one.monitorIds).toEqual([m2.uptimeMonitorId, m1.uptimeMonitorId]);
	});

	it("replaces the previous set wholesale", async () => {
		const page = await createTestStatusPage(owner.id);
		const m1 = await createTestMonitor(owner.id);
		const m2 = await createTestMonitor(owner.id);
		await ownerCaller().uptimeMonitor.statusPage.setMonitors({
			statusPageId: page.statusPageId,
			uptimeMonitorIds: [m1.uptimeMonitorId],
		});
		await ownerCaller().uptimeMonitor.statusPage.setMonitors({
			statusPageId: page.statusPageId,
			uptimeMonitorIds: [m2.uptimeMonitorId],
		});
		const one = await ownerCaller().uptimeMonitor.statusPage.one({
			statusPageId: page.statusPageId,
		});
		expect(one.monitorIds).toEqual([m2.uptimeMonitorId]);
	});

	it("clears the set with an empty array", async () => {
		const page = await createTestStatusPage(owner.id);
		const m1 = await createTestMonitor(owner.id);
		await createTestStatusPageMonitor(page.statusPageId, m1.uptimeMonitorId);
		const res = await ownerCaller().uptimeMonitor.statusPage.setMonitors({
			statusPageId: page.statusPageId,
			uptimeMonitorIds: [],
		});
		expect(res.count).toBe(0);
		const one = await ownerCaller().uptimeMonitor.statusPage.one({
			statusPageId: page.statusPageId,
		});
		expect(one.monitorIds).toEqual([]);
	});

	it("rejects a foreign monitor id with NOT_FOUND and does not mutate", async () => {
		const page = await createTestStatusPage(owner.id);
		const kept = await createTestMonitor(owner.id, { name: "Kept" });
		const mine = await createTestMonitor(owner.id);
		const theirs = await createTestMonitor(attacker.id);
		await createTestStatusPageMonitor(page.statusPageId, kept.uptimeMonitorId);
		await expect(
			ownerCaller().uptimeMonitor.statusPage.setMonitors({
				statusPageId: page.statusPageId,
				uptimeMonitorIds: [mine.uptimeMonitorId, theirs.uptimeMonitorId],
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		const one = await ownerCaller().uptimeMonitor.statusPage.one({
			statusPageId: page.statusPageId,
		});
		expect(one.monitorIds).toEqual([kept.uptimeMonitorId]);
	});

	it("throws NOT_FOUND for another user's page", async () => {
		const page = await createTestStatusPage(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.statusPage.setMonitors({
				statusPageId: page.statusPageId,
				uptimeMonitorIds: [],
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ---------------------------------------------------------------------------
// Custom domains — attach / verify / detach
// ---------------------------------------------------------------------------

describe("uptimeMonitor.statusPage.attachDomain", () => {
	it("returns the TXT record and marks the page unverified", async () => {
		const page = await createTestStatusPage(owner.id);
		const res = await ownerCaller().uptimeMonitor.statusPage.attachDomain({
			statusPageId: page.statusPageId,
			customDomain: "status.example.com",
		});
		expect(res.recordType).toBe("TXT");
		expect(res.recordName).toBe("_pulsy-verify.status.example.com");
		expect(res.recordValue).toBeTruthy();
		expect(res.domainVerified).toBe(false);
		const one = await ownerCaller().uptimeMonitor.statusPage.one({
			statusPageId: page.statusPageId,
		});
		expect(one.customDomain).toBe("status.example.com");
		expect(one.domainVerified).toBe(false);
	});

	it("rejects a domain already verified by another page", async () => {
		const a = await createTestStatusPage(owner.id, { slug: "a" });
		const b = await createTestStatusPage(owner.id, { slug: "b" });
		const attached = await ownerCaller().uptimeMonitor.statusPage.attachDomain({
			statusPageId: a.statusPageId,
			customDomain: "status.example.com",
		});
    resolveTxt.mockResolvedValue([[attached.recordValue]]);
    await ownerCaller().uptimeMonitor.statusPage.verifyDomain({ statusPageId: a.statusPageId });
		await expect(
			ownerCaller().uptimeMonitor.statusPage.attachDomain({
				statusPageId: b.statusPageId,
				customDomain: "status.example.com",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("allows re-attaching the same domain to the same page", async () => {
		const page = await createTestStatusPage(owner.id);
		await ownerCaller().uptimeMonitor.statusPage.attachDomain({
			statusPageId: page.statusPageId,
			customDomain: "status.example.com",
		});
		const res = await ownerCaller().uptimeMonitor.statusPage.attachDomain({
			statusPageId: page.statusPageId,
			customDomain: "status.example.com",
		});
		expect(res.domainVerified).toBe(false);
	});

	it("throws NOT_FOUND for another user's page", async () => {
		const page = await createTestStatusPage(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.statusPage.attachDomain({
				statusPageId: page.statusPageId,
				customDomain: "status.example.com",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("uptimeMonitor.statusPage.verifyDomain", () => {
	async function attach(statusPageId: string): Promise<string> {
		const res = await ownerCaller().uptimeMonitor.statusPage.attachDomain({
			statusPageId,
			customDomain: "status.example.com",
		});
		return res.recordValue;
	}

	it("rejects when no domain is attached", async () => {
		const page = await createTestStatusPage(owner.id);
		await expect(
			ownerCaller().uptimeMonitor.statusPage.verifyDomain({
				statusPageId: page.statusPageId,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("verifies when a matching TXT record is found", async () => {
		const page = await createTestStatusPage(owner.id);
		const token = await attach(page.statusPageId);
		resolveTxt.mockResolvedValue([[token]]);
		const res = await ownerCaller().uptimeMonitor.statusPage.verifyDomain({
			statusPageId: page.statusPageId,
		});
		expect(res.domainVerified).toBe(true);
		expect(res.domainVerifiedAt).toBeTruthy();
		expect(resolveTxt).toHaveBeenCalledWith("_pulsy-verify.status.example.com");
	});

	it("verifies when the TXT value is split across chunks", async () => {
		const page = await createTestStatusPage(owner.id);
		const token = await attach(page.statusPageId);
		const mid = Math.floor(token.length / 2);
		resolveTxt.mockResolvedValue([[token.slice(0, mid), token.slice(mid)]]);
		const res = await ownerCaller().uptimeMonitor.statusPage.verifyDomain({
			statusPageId: page.statusPageId,
		});
		expect(res.domainVerified).toBe(true);
	});

	it("rejects when the TXT record is missing (resolution fails)", async () => {
		const page = await createTestStatusPage(owner.id);
		await attach(page.statusPageId);
		resolveTxt.mockRejectedValue(new Error("ENOTFOUND"));
		await expect(
			ownerCaller().uptimeMonitor.statusPage.verifyDomain({
				statusPageId: page.statusPageId,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("rejects when the TXT record does not match", async () => {
		const page = await createTestStatusPage(owner.id);
		await attach(page.statusPageId);
		resolveTxt.mockResolvedValue([["some-other-value"]]);
		await expect(
			ownerCaller().uptimeMonitor.statusPage.verifyDomain({
				statusPageId: page.statusPageId,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("is idempotent — a verified page short-circuits without re-resolving", async () => {
		const page = await createTestStatusPage(owner.id);
		const token = await attach(page.statusPageId);
		resolveTxt.mockResolvedValue([[token]]);
		await ownerCaller().uptimeMonitor.statusPage.verifyDomain({
			statusPageId: page.statusPageId,
		});
		resolveTxt.mockClear();
		const res = await ownerCaller().uptimeMonitor.statusPage.verifyDomain({
			statusPageId: page.statusPageId,
		});
		expect(res.domainVerified).toBe(true);
		expect(resolveTxt).not.toHaveBeenCalled();
	});

	it("throws NOT_FOUND for another user's page", async () => {
		const page = await createTestStatusPage(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.statusPage.verifyDomain({
				statusPageId: page.statusPageId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("uptimeMonitor.statusPage.detachDomain", () => {
	it("clears the domain fields", async () => {
		const page = await createTestStatusPage(owner.id);
		await ownerCaller().uptimeMonitor.statusPage.attachDomain({
			statusPageId: page.statusPageId,
			customDomain: "status.example.com",
		});
		const res = await ownerCaller().uptimeMonitor.statusPage.detachDomain({
			statusPageId: page.statusPageId,
		});
		expect(res.success).toBe(true);
		const one = await ownerCaller().uptimeMonitor.statusPage.one({
			statusPageId: page.statusPageId,
		});
		expect(one.customDomain).toBeNull();
		expect(one.domainVerified).toBe(false);
	});

	it("throws NOT_FOUND for another user's page", async () => {
		const page = await createTestStatusPage(owner.id);
		await expect(
			attackerCaller().uptimeMonitor.statusPage.detachDomain({
				statusPageId: page.statusPageId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ---------------------------------------------------------------------------
// Public resolve — by slug
// ---------------------------------------------------------------------------

describe("uptimeMonitor.public.statusPageBySlug", () => {
	it("returns a published page's sanitized aggregate", async () => {
		const page = await createTestStatusPage(owner.id, {
			slug: "api",
			title: "API Status",
			description: "desc",
			logoUrl: "https://cdn.example.com/logo.png",
			isPublished: true,
		});
		const mon = await createTestMonitor(owner.id, {
			name: "API",
			status: "up",
			uptimePercentage: 99.9,
		});
		await createTestStatusPageMonitor(page.statusPageId, mon.uptimeMonitorId);

		const res = await publicCaller().uptimeMonitor.public.statusPageBySlug({
			userId: owner.id,
			slug: "api",
		});
		expect(res.title).toBe("API Status");
		expect(res.description).toBe("desc");
		expect(res.logoUrl).toBe("https://cdn.example.com/logo.png");
		expect(res.monitors).toHaveLength(1);
		expect(res.monitors[0]).not.toHaveProperty("url");
    expect(Object.keys(res.monitors[0]!).sort()).toEqual(["componentId", "description", "group", "lastCheckedAt", "maintenance", "monitorType", "name", "responseTime", "slowPercentage", "status", "uptimePercentage"]);
		expect(res.overallStatus).toBe("operational");
	});

	it("returns NOT_FOUND for an unpublished page", async () => {
		await createTestStatusPage(owner.id, { slug: "draft", isPublished: false });
		await expect(
			publicCaller().uptimeMonitor.public.statusPageBySlug({
				userId: owner.id,
				slug: "draft",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("returns NOT_FOUND for a missing slug", async () => {
		await expect(
			publicCaller().uptimeMonitor.public.statusPageBySlug({
				userId: owner.id,
				slug: "ghost",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ---------------------------------------------------------------------------
// Public resolve — by verified custom domain
// ---------------------------------------------------------------------------

describe("uptimeMonitor.public.statusPageByDomain", () => {
	it("returns a verified + published page", async () => {
		const page = await createTestStatusPage(owner.id, {
			slug: "d",
			isPublished: true,
			customDomain: "status.acme.com",
			domainVerified: true,
			domainVerifyToken: "tok",
		});
		const mon = await createTestMonitor(owner.id, { status: "degraded" });
		await createTestStatusPageMonitor(page.statusPageId, mon.uptimeMonitorId);

		const res = await publicCaller().uptimeMonitor.public.statusPageByDomain({
			host: "status.acme.com",
		});
		expect(res.monitors).toHaveLength(1);
		expect(res.overallStatus).toBe("degraded");
		expect(res.monitors[0]).not.toHaveProperty("url");
    expect(Object.keys(res.monitors[0]!).sort()).toEqual(["componentId", "description", "group", "lastCheckedAt", "maintenance", "monitorType", "name", "responseTime", "slowPercentage", "status", "uptimePercentage"]);
	});

	it("returns NOT_FOUND when the domain is attached but unverified", async () => {
		await createTestStatusPage(owner.id, {
			slug: "u",
			isPublished: true,
			customDomain: "unverified.acme.com",
			domainVerified: false,
			domainVerifyToken: "tok",
		});
		await expect(
			publicCaller().uptimeMonitor.public.statusPageByDomain({
				host: "unverified.acme.com",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("returns NOT_FOUND when verified but unpublished", async () => {
		await createTestStatusPage(owner.id, {
			slug: "h",
			isPublished: false,
			customDomain: "hidden.acme.com",
			domainVerified: true,
			domainVerifyToken: "tok",
		});
		await expect(
			publicCaller().uptimeMonitor.public.statusPageByDomain({
				host: "hidden.acme.com",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("returns NOT_FOUND for an unknown host", async () => {
		await expect(
			publicCaller().uptimeMonitor.public.statusPageByDomain({
				host: "nobody.example.com",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// ---------------------------------------------------------------------------
// Public resolve — legacy per-user delegation + aggregate edge cases
// ---------------------------------------------------------------------------

describe("uptimeMonitor.public.status (legacy default-page delegation)", () => {
  it("returns NOT_FOUND when the user has no default page", async () => {
    await expect(publicCaller().uptimeMonitor.public.status({ userId: owner.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

	it("treats an unpublished default page as absent without exposing its data", async () => {
		const page = await createTestStatusPage(owner.id, {
			slug: "default",
			title: "Private status",
			description: "Internal-only description",
			logoUrl: "https://private.example/logo.svg",
			isPublished: false,
		});
		const monitor = await createTestMonitor(owner.id, {
			name: "Private monitor",
			status: "down",
		});
		await createTestStatusPageMonitor(
			page.statusPageId,
			monitor.uptimeMonitorId,
		);
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: monitor.uptimeMonitorId,
			status: "ongoing",
			startedAt: new Date().toISOString(),
			cause: "Private incident detail",
		});

    await expect(publicCaller().uptimeMonitor.public.status({ userId: owner.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

	it("delegates to the user's default page and drops inactive monitors", async () => {
		const page = await createTestStatusPage(owner.id, {
			slug: "default",
			title: "Default",
		});
		const active = await createTestMonitor(owner.id, {
			name: "Active",
			status: "down",
		});
		const inactive = await createTestMonitor(owner.id, {
			name: "Inactive",
			status: "up",
			active: false,
		});
		await createTestStatusPageMonitor(page.statusPageId, active.uptimeMonitorId);
		await createTestStatusPageMonitor(
			page.statusPageId,
			inactive.uptimeMonitorId,
		);

		const res = await publicCaller().uptimeMonitor.public.status({
			userId: owner.id,
		});
		expect(res.title).toBe("Default");
		expect(res.monitors).toHaveLength(1);
		expect(res.overallStatus).toBe("outage");
	});

	it("includes only the last-7-day incidents for the page's monitors", async () => {
		const page = await createTestStatusPage(owner.id, { slug: "default" });
		const mon = await createTestMonitor(owner.id, { name: "Mon", status: "up" });
		await createTestStatusPageMonitor(page.statusPageId, mon.uptimeMonitorId);
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: mon.uptimeMonitorId,
			status: "resolved",
			startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
			resolvedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
			durationSeconds: 86_400,
		});
		await db.insert(uptimeIncident).values({
			uptimeMonitorId: mon.uptimeMonitorId,
			status: "resolved",
			startedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
		});

		const res = await publicCaller().uptimeMonitor.public.status({
			userId: owner.id,
		});
		expect(res.recentIncidents).toHaveLength(1);
		expect(res.recentIncidents[0]?.monitorName).toBe("Mon");
		expect(res.recentIncidents[0]?.durationSeconds).toBe(86_400);
	});
});

  it("requires explicit confirmation for creating or publishing an empty page", async () => {
    const api = ownerCaller().uptimeMonitor.statusPage;
    await expect(api.create({ slug: "empty", title: "Empty", isPublished: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const page = await api.create({ slug: "empty", title: "Empty" });
    await expect(api.update({ statusPageId: page.statusPageId, isPublished: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(attackerCaller().uptimeMonitor.statusPage.update({ statusPageId: page.statusPageId, isPublished: true, confirmEmptyPublication: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await api.one({ statusPageId: page.statusPageId })).isPublished).toBe(false);
    expect((await api.update({ statusPageId: page.statusPageId, isPublished: true, confirmEmptyPublication: true })).isPublished).toBe(true);
  });

	it("an unverified claim cannot squat a domain: the real owner can still attach and verify it", async () => {
		const squatPage = await createTestStatusPage(attacker.id, { slug: "squat" });
		const ownerPage = await createTestStatusPage(owner.id, { slug: "real" });
		const squat = await attackerCaller().uptimeMonitor.statusPage.attachDomain({ statusPageId: squatPage.statusPageId, customDomain: "status.example.com" });
		// No CONFLICT, and nothing tells the owner whether anyone else has claimed the name.
		const real = await ownerCaller().uptimeMonitor.statusPage.attachDomain({ statusPageId: ownerPage.statusPageId, customDomain: "status.example.com" });
		resolveTxt.mockResolvedValue([[real.recordValue]]);
		const verified = await ownerCaller().uptimeMonitor.statusPage.verifyDomain({ statusPageId: ownerPage.statusPageId });
		expect(verified.domainVerified).toBe(true);
		// The squatter's token does not match DNS, and even a matching one loses to the verified owner.
		resolveTxt.mockResolvedValue([[squat.recordValue]]);
		await expect(attackerCaller().uptimeMonitor.statusPage.verifyDomain({ statusPageId: squatPage.statusPageId })).rejects.toMatchObject({ code: "CONFLICT" });
		const again = await attackerCaller().uptimeMonitor.statusPage.one({ statusPageId: squatPage.statusPageId });
		expect(again.domainVerified).toBe(false);
	});


	it("shows rolling check success from recorded checks (the stored monitor column is never written), neutral when none", async () => {
		const page = await createTestStatusPage(owner.id, { slug: "ratio", title: "Ratio", isPublished: true });
		const checked = await createTestMonitor(owner.id, { name: "Checked", status: "up", uptimePercentage: 12.3 });
		const fresh = await createTestMonitor(owner.id, { name: "Fresh", status: "pending" });
		await createTestStatusPageMonitor(page.statusPageId, checked.uptimeMonitorId);
		await createTestStatusPageMonitor(page.statusPageId, fresh.uptimeMonitorId);
		await db.insert(uptimeCheckLog).values([
			{ uptimeMonitorId: checked.uptimeMonitorId, status: "up", httpStatus: 200, responseTime: 5 },
			{ uptimeMonitorId: checked.uptimeMonitorId, status: "down", httpStatus: null, responseTime: null },
		]);
		const res = await publicCaller().uptimeMonitor.public.statusPageBySlug({ userId: owner.id, slug: "ratio" });
		const byName = new Map(res.monitors.map((m) => [m.name, m.uptimePercentage]));
		expect(byName.get("Checked")).toBe(50);
		expect(byName.get("Fresh")).toBeNull();
	});

	it("reports 100 HTTP-200 checks of which 60 are degraded as 100% available and 60% slow, never 0%", async () => {
		const page = await createTestStatusPage(owner.id, { slug: "slow", title: "Slow", isPublished: true });
		const slow = await createTestMonitor(owner.id, { name: "Slow upstream", status: "degraded" });
		await createTestStatusPageMonitor(page.statusPageId, slow.uptimeMonitorId);
		await db.insert(uptimeCheckLog).values(Array.from({ length: 100 }, (_, i) => ({
			uptimeMonitorId: slow.uptimeMonitorId, status: i < 60 ? "degraded" as const : "up" as const, httpStatus: 200, responseTime: i < 60 ? 4000 : 80,
		})));
		const res = await publicCaller().uptimeMonitor.public.statusPageBySlug({ userId: owner.id, slug: "slow" });
		expect(res.monitors[0]).toMatchObject({ uptimePercentage: 100, slowPercentage: 60, status: "degraded" });
		expect(res.overallStatus).toBe("degraded");
	});

	it.each([
		[0, "operational"],
		[1, "partial"],
		[2, "partial"],
		[3, "partial"],
		[5, "outage"],
	] as const)("publishes %i of 5 down components as overall status %s", async (down, expected) => {
		const slug = `overall-${down}`;
		const page = await createTestStatusPage(owner.id, { slug, title: "Overall", isPublished: true });
		for (let index = 0; index < 5; index++) {
			const monitor = await createTestMonitor(owner.id, { name: `Component ${index}`, status: index < down ? "down" : "up" });
			await createTestStatusPageMonitor(page.statusPageId, monitor.uptimeMonitorId);
		}
		const res = await publicCaller().uptimeMonitor.public.statusPageBySlug({ userId: owner.id, slug });
		expect(res.overallStatus).toBe(expected);
		expect(res.monitors.filter((m) => m.status === "down")).toHaveLength(down);
	});

	it("isolates exact page monitors/incidents across accounts and matches domains", async () => {
		for (const account of [owner, attacker]) {
			for (const slug of ["default", "second"]) {
				const mon = await createTestMonitor(account.id, { name: `${account.id}-${slug}` });
				const page = await createTestStatusPage(account.id, {
					slug, title: `${account.id} ${slug}`, isPublished: true,
					customDomain: `${account.id === owner.id ? "owner" : "attacker"}-${slug}.fixtures.invalid`, domainVerified: true,
				});
				await createTestStatusPageMonitor(page.statusPageId, mon.uptimeMonitorId);
				await db.insert(uptimeIncident).values({ uptimeMonitorId: mon.uptimeMonitorId,
					status: "ongoing", startedAt: new Date().toISOString(), cause: "Private internal cause" });
			}
		}
		for (const account of [owner, attacker]) {
			for (const slug of ["default", "second"]) {
				const canonical = await publicCaller().uptimeMonitor.public.statusPageBySlug({ userId: account.id, slug });
				const domain = await publicCaller().uptimeMonitor.public.statusPageByDomain({ host: `${account.id === owner.id ? "owner" : "attacker"}-${slug}.fixtures.invalid` });
				expect(domain).toEqual({ ...canonical, asOf: domain.asOf });
        expect(Date.parse(domain.asOf)).toBeGreaterThanOrEqual(Date.parse(canonical.asOf));
				expect(canonical.title).toBe(`${account.id} ${slug}`);
				expect(canonical.monitors.map(m => m.name)).toEqual([`${account.id}-${slug}`]);
				expect(canonical.recentIncidents.map(i => i.monitorName)).toEqual([`${account.id}-${slug}`]);
				expect(JSON.stringify(canonical)).not.toContain("Private internal cause");
			}
		}
	});

	it("drops foreign-owner monitor links even if a corrupted membership exists", async () => {
		const page = await createTestStatusPage(owner.id, { slug: "isolation" });
		const own = await createTestMonitor(owner.id, { name: "Own" });
		const foreign = await createTestMonitor(attacker.id, { name: "Foreign private" });
		await createTestStatusPageMonitor(page.statusPageId, own.uptimeMonitorId);
		await createTestStatusPageMonitor(page.statusPageId, foreign.uptimeMonitorId);
		await db.insert(uptimeIncident).values({ uptimeMonitorId: foreign.uptimeMonitorId,
			status: "ongoing", startedAt: new Date().toISOString() });
		const result = await publicCaller().uptimeMonitor.public.statusPageBySlug({ userId: owner.id, slug: "isolation" });
		expect(result.monitors.map(m => m.name)).toEqual(["Own"]);
		expect(result.recentIncidents).toEqual([]);
	});

	it("returns NOT_FOUND for an unpublished page", async () => {
		await createTestStatusPage(owner.id, { slug: "draft", isPublished: false });
		await expect(
			publicCaller().uptimeMonitor.public.statusPageBySlug({
				userId: owner.id,
				slug: "draft",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
