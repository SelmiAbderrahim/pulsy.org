import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, uptimeIncident } from "@pulsy/db";
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

	it("rejects a domain already used by another page", async () => {
		const a = await createTestStatusPage(owner.id, { slug: "a" });
		const b = await createTestStatusPage(owner.id, { slug: "b" });
		await ownerCaller().uptimeMonitor.statusPage.attachDomain({
			statusPageId: a.statusPageId,
			customDomain: "status.example.com",
		});
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
	it("returns an empty aggregate when the user has no default page", async () => {
		const res = await publicCaller().uptimeMonitor.public.status({
			userId: owner.id,
		});
		expect(res.title).toBeNull();
		expect(res.monitors).toHaveLength(0);
		expect(res.overallStatus).toBe("operational");
		expect(res.recentIncidents).toHaveLength(0);
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

		const res = await publicCaller().uptimeMonitor.public.status({
			userId: owner.id,
		});

		expect(res).toEqual({
			title: null,
			description: null,
			logoUrl: null,
			monitors: [],
			overallStatus: "operational",
			recentIncidents: [],
		});
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
