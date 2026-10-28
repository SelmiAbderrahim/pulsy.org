import { db, uptimeCheckLog, uptimeMonitor } from "@pulsy/db";
import { and, eq } from "drizzle-orm";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import type { HttpCheckResult } from "../checker-service";
import type { UptimeMonitor } from "../monitor-service";

interface FakeJob {
	cancel: () => void;
}

const mocks = vi.hoisted(() => ({
	jobs: {} as Record<string, FakeJob>,
	probe: vi.fn<(monitor: UptimeMonitor) => Promise<HttpCheckResult>>(),
}));

// Cron callbacks never fire: each persisted sample must come from the immediate
// first-check path, rather than accidentally passing on the next cron boundary.
vi.mock("node-schedule", () => ({
	scheduledJobs: mocks.jobs,
	scheduleJob: (name: string, _cron: string, _callback: () => void) => {
		const job = { cancel: () => { delete mocks.jobs[name]; } };
		mocks.jobs[name] = job;
		return job;
	},
	gracefulShutdown: async () => undefined,
}));
vi.mock("../monitor-probe", () => ({ performMonitorProbe: mocks.probe }));
vi.mock("../tls-checker-service", () => ({ checkTlsCertificate: async () => null }));
vi.mock("../notification-service", () => ({
	dispatchNotifications: async () => undefined,
	dispatchTlsExpiryNotifications: async () => undefined,
}));

import {
	cancelAllMonitorChecks,
	initializeAllMonitors,
	reconcileScheduledMonitors,
	setSchedulingEnabled,
	shutdownScheduler,
} from "../scheduler-service";
import { createV1Router } from "../../../api/v1/router";

useCleanDatabase();

beforeEach(() => {
	cancelAllMonitorChecks();
	setSchedulingEnabled(true);
	mocks.probe.mockReset();
	mocks.probe.mockResolvedValue({ status: "up", httpStatus: null, responseTime: 12 });
});

afterEach(async () => {
	// Drain checks before the next test's database cleanup and restore the same
	// enabled state expected by the other scheduler integration suites.
	setSchedulingEnabled(false);
	cancelAllMonitorChecks();
	await shutdownScheduler(1000);
	setSchedulingEnabled(true);
});

async function expectImmediateSample(monitorId: string) {
	await vi.waitFor(async () => {
		const rows = await db.select().from(uptimeCheckLog)
			.where(eq(uptimeCheckLog.uptimeMonitorId, monitorId));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ status: "up", httpStatus: null, responseTime: 12 });
	}, { timeout: 1500, interval: 20 });
}

describe("leader first-check scheduling", () => {
	it("checks a REST-created monitor immediately without waiting for its hourly cron", async () => {
		const owner = await createTestUser();
		const app = express();
		app.use(express.json());
		app.use("/api/v1", createV1Router({ resolve: async () => ({
			ok: true, user: { id: owner.id }, apiKeyId: "first-check-fixture", scope: "full",
		}) }));
		const server = app.listen(0);
		await new Promise<void>((resolve) => server.once("listening", resolve));
		try {
			const { port } = server.address() as AddressInfo;
			const response = await fetch(`http://127.0.0.1:${port}/api/v1/monitors`, {
				method: "POST",
				headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" },
				body: JSON.stringify({ name: "REST hourly", url: "http://127.0.0.1/first-check", interval: 3600 }),
			});
			expect(response.status).toBe(201);
			const body = await response.json() as { data: { id: string } };
			await expectImmediateSample(body.data.id);
		} finally {
			await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		}
	});

	it("checks an already due never-checked DNS monitor when the leader starts", async () => {
		const owner = await createTestUser();
		const monitor = await createTestMonitor(owner.id, {
			monitorType: "dns", url: "", interval: 3600, active: true,
			networkConfig: { type: "dns", hostname: "start.example.invalid", recordType: "A", mode: "exists", expected: [] },
			lastCheckedAt: null, nextCheckAt: new Date(Date.now() - 100).toISOString(),
		});

		await initializeAllMonitors();
		await expectImmediateSample(monitor.uptimeMonitorId);
	});

	it("checks a same-interval TCP retarget saved through another replica", async () => {
		const owner = await createTestUser();
		const monitor = await createTestMonitor(owner.id, {
			monitorType: "tcp", url: "", interval: 3600, active: true, status: "up",
			networkConfig: { type: "tcp", hostname: "old.example.invalid", port: 443 },
			lastCheckedAt: new Date(Date.now() - 60_000).toISOString(),
			nextCheckAt: new Date(Date.now() + 3_600_000).toISOString(),
		});
		await reconcileScheduledMonitors();

		// This replica receives no schedule/reschedule call from the write request.
		await db.update(uptimeMonitor).set({
			networkConfig: { type: "tcp", hostname: "new.example.invalid", port: 8443 },
			nextCheckAt: new Date(Date.now() - 100).toISOString(),
		}).where(and(eq(uptimeMonitor.userId, owner.id), eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId)));
		await reconcileScheduledMonitors();

		await expectImmediateSample(monitor.uptimeMonitorId);
		expect(mocks.probe).toHaveBeenCalledWith(expect.objectContaining({
			networkConfig: { type: "tcp", hostname: "new.example.invalid", port: 8443 },
		}));
	});

	it("immediately checks a previously checked TCP monitor resumed on another replica", async () => {
		const owner = await createTestUser();
		const monitor = await createTestMonitor(owner.id, {
			monitorType: "tcp", url: "", interval: 3600, active: false, status: "up",
			networkConfig: { type: "tcp", hostname: "resume.example.invalid", port: 443 },
			lastCheckedAt: new Date(Date.now() - 60_000).toISOString(), nextCheckAt: null,
		});
		await reconcileScheduledMonitors();

		await db.update(uptimeMonitor).set({ active: true, nextCheckAt: new Date(Date.now() - 100).toISOString() })
			.where(and(eq(uptimeMonitor.userId, owner.id), eq(uptimeMonitor.uptimeMonitorId, monitor.uptimeMonitorId)));
		await reconcileScheduledMonitors();

		await expectImmediateSample(monitor.uptimeMonitorId);
	});
});
