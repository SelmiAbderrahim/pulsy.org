import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, uptimeIncident, uptimeIncidentEvent, uptimeMonitor, uptimeStatusChange } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { createTestUser, useCleanDatabase } from "../../../../test/db";
import { authedCaller } from "../../../../test/trpc-caller";
import { receiveHeartbeat, scanHeartbeatDeadlines } from "../heartbeat-service";
import { resumeSuppressedNotifications } from "../maintenance-service";

// Heartbeat timeline: expectedAt (ping due, Late) -> graceEndsAt = expectedAt + grace
// (Down) = incident.startedAt. Every surface must read the same instants, and
// notifiedAt (first delivered outage alert) is a separate field.
useCleanDatabase();
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

const START = Date.parse("2026-10-10T12:00:00Z");
const iso = (seconds: number) => new Date(START + seconds * 1000).toISOString();
const clock = (seconds: number) => vi.setSystemTime(START + seconds * 1000);
const EXPECTED = iso(300), GRACE_ENDS = iso(360);

async function sink(run: (url: string, bodies: Array<Record<string, unknown>>) => Promise<void>) {
	const bodies: Array<Record<string, unknown>> = [];
	const server = createServer(async (request, response) => {
		let body = ""; for await (const chunk of request) body += String(chunk);
		bodies.push(JSON.parse(body)); response.writeHead(200); response.end("ok");
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); if (!address || typeof address === "string") throw new Error("sink address missing");
	vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
	try { await run(`http://127.0.0.1:${address.port}/alerts`, bodies); }
	finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function setup(url?: string) {
	vi.useFakeTimers({ toFake: ["Date"] }); clock(0);
	const owner = await createTestUser(); const caller = authedCaller(owner);
	const job = await caller.uptimeMonitor.heartbeat.create({ name: "Backup", interval: 300, graceSeconds: 60 });
	const id = job.monitor.uptimeMonitorId;
	if (url) await caller.uptimeMonitor.channel.create({ uptimeMonitorId: id, channelType: "webhook", webhookUrl: url, notifyOnDegraded: true });
	return { caller, job, id };
}

describe("heartbeat timeline with a fixture clock", () => {
	it("before due: nothing is Late, nothing is Down, no incident", async () => {
		const { caller, id } = await setup();
		clock(299); await scanHeartbeatDeadlines();
		expect((await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: id })).status).toBe("pending");
		expect(await db.select().from(uptimeIncident)).toHaveLength(0);
	});

	it("within grace: Late from expectedAt, still no measured incident", async () => {
		const { caller, id } = await setup();
		clock(330); await scanHeartbeatDeadlines();
		expect((await caller.uptimeMonitor.monitor.one({ uptimeMonitorId: id })).status).toBe("degraded");
		expect(await db.select().from(uptimeIncident)).toHaveLength(0);
		const [late] = await db.select().from(uptimeStatusChange).where(eq(uptimeStatusChange.statusAfter, "degraded"));
		expect(late?.createdAt).toBe(EXPECTED);
	});

	it("a delayed scan after grace yields one incident whose start is graceEndsAt on every surface, with expectedAt and notifiedAt kept apart", async () => sink(async (url, bodies) => {
		const { caller, id } = await setup(url);
		clock(300); await scanHeartbeatDeadlines();
		clock(400); await scanHeartbeatDeadlines(); await resumeSuppressedNotifications();
		const incidents = await db.select().from(uptimeIncident);
		expect(incidents).toHaveLength(1);
		const [incident] = incidents;
		expect(incident?.startedAt).toBe(GRACE_ENDS);
		expect(incident?.expectedAt).toBe(EXPECTED);
		const [down] = await db.select().from(uptimeStatusChange).where(eq(uptimeStatusChange.statusAfter, "down"));
		const [event] = await db.select().from(uptimeIncidentEvent).where(eq(uptimeIncidentEvent.kind, "check"));
		expect(down?.createdAt).toBe(GRACE_ENDS);
		expect(event?.createdAt).toBe(GRACE_ENDS);
		// The first delivered outage alert is recorded in its own field.
		expect(bodies.some(body => body.event === "monitor.down")).toBe(true);
		expect(incident?.notifiedAt).toBeTruthy();
		expect(incident?.notifiedAt).not.toBe(incident?.startedAt);
		// Router surfaces read the same instants.
		const workspace = await caller.uptimeMonitor.incidentWorkspace.one({ incidentId: incident!.incidentId });
		expect(workspace.incident).toMatchObject({ startedAt: GRACE_ENDS, expectedAt: EXPECTED, notifiedAt: incident?.notifiedAt });
		const list = await caller.uptimeMonitor.incident.list({ uptimeMonitorId: id });
		const rows = (Array.isArray(list) ? list : (list as { data: unknown[] }).data) as Array<{ startedAt: string }>;
		expect(rows.map(row => row.startedAt)).toEqual([GRACE_ENDS]);
		// The alert text carries the same incident start, not the scan time.
		const alert = JSON.stringify(bodies.find(body => body.event === "monitor.down"));
		expect(alert).not.toContain(iso(400));
	}));

	it("repeated misses never open a second incident or move the start", async () => {
		const { id } = await setup();
		for (const seconds of [400, 659, 660, 961]) { clock(seconds); await scanHeartbeatDeadlines(); }
		const incidents = await db.select().from(uptimeIncident).where(eq(uptimeIncident.uptimeMonitorId, id));
		expect(incidents).toHaveLength(1);
		expect(incidents[0]?.startedAt).toBe(GRACE_ENDS);
		expect(incidents[0]?.status).toBe("ongoing");
	});

	it("changing the interval mid-incident keeps the same incident and the Down state until a real success", async () => {
		const { caller, job, id } = await setup();
		clock(400); await scanHeartbeatDeadlines();
		clock(420); await caller.uptimeMonitor.heartbeat.update({ monitorId: id, name: "Backup", interval: 900, graceSeconds: 120 });
		clock(1000); await scanHeartbeatDeadlines();
		const incidents = await db.select().from(uptimeIncident);
		expect(incidents).toHaveLength(1);
		expect(incidents[0]).toMatchObject({ startedAt: GRACE_ENDS, expectedAt: EXPECTED, status: "ongoing" });
		expect((await db.select().from(uptimeMonitor).where(eq(uptimeMonitor.uptimeMonitorId, id)))[0]?.status).toBe("down");
		clock(1010); await receiveHeartbeat(job.token, "success", {});
		const [resolved] = await db.select().from(uptimeIncident);
		expect(resolved).toMatchObject({ status: "resolved", startedAt: GRACE_ENDS });
		expect(resolved?.resolvedAt).toBe(iso(1010));
	});

	it("recovery resolves at the success time and the next miss opens a fresh incident at its own grace end", async () => {
		const { job } = await setup();
		clock(400); await scanHeartbeatDeadlines();
		clock(401); await receiveHeartbeat(job.token, "success", {});
		clock(1000); await scanHeartbeatDeadlines();
		const incidents = (await db.select().from(uptimeIncident)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
		expect(incidents.map(row => row.status)).toEqual(["resolved", "ongoing"]);
		expect(incidents[0]?.startedAt).toBe(GRACE_ENDS);
		// success at +401 -> next expected +701, grace ends +761
		expect(incidents[1]?.startedAt).toBe(iso(761));
		expect(incidents[1]?.expectedAt).toBe(iso(701));
	});
});
