import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, uptimeNotificationLog } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { createTestChannel, createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { mockFetch } from "../../../../test/fetch-mock";
import type { UptimeMonitor } from "../monitor-service";
import { dispatchNotifications } from "../notification-service";

// Egress policy is re-applied at SEND time (a channel saved earlier, or rewritten
// in the database, must still never reach a private/metadata destination).

useCleanDatabase();

let monitor: UptimeMonitor;
beforeEach(async () => {
	const owner = await createTestUser();
	monitor = await createTestMonitor(owner.id, { name: "Egress App", url: "https://egress.app", status: "up" });
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

const change = () => ({
	statusChangeId: "sc-egress",
	uptimeMonitorId: monitor.uptimeMonitorId,
	statusBefore: "up",
	statusAfter: "down",
	httpStatus: 503,
	responseTime: 100,
	reason: "boom",
	createdAt: new Date().toISOString(),
});
const rows = () => db.select().from(uptimeNotificationLog).where(eq(uptimeNotificationLog.uptimeMonitorId, monitor.uptimeMonitorId));

describe("notification egress at send time", () => {
	it.each(["http://127.0.0.1:8080/hook", "http://10.0.0.5/hook", "http://169.254.169.254/latest/meta-data"])(
		"never connects to %s under the strict policy and records a failed delivery",
		async target => {
			vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "false");
			const fx = mockFetch();
			try {
				await createTestChannel(monitor.uptimeMonitorId, { channelType: "webhook", webhookUrl: target, notifyOnDown: true });
				await dispatchNotifications(monitor, change(), { delaysMs: [] });
				expect(fx.calls).toHaveLength(0);
				const logged = await rows();
				expect(logged).toHaveLength(1);
				expect(logged[0]?.outcome).toBe("failed");
			} finally {
				fx.restore();
			}
		},
	);

	it("keeps the cloud metadata address blocked even when private networks are allowed", async () => {
		vi.stubEnv("MONITOR_ALLOW_PRIVATE_NETWORKS", "true");
		const fx = mockFetch();
		try {
			await createTestChannel(monitor.uptimeMonitorId, { channelType: "webhook", webhookUrl: "http://169.254.169.254/latest", notifyOnDown: true });
			await dispatchNotifications(monitor, change(), { delaysMs: [] });
			expect(fx.calls).toHaveLength(0);
			expect((await rows())[0]?.outcome).toBe("failed");
		} finally {
			fx.restore();
		}
	});
});
