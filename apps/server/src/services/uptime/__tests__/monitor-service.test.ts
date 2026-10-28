import { beforeEach, describe, expect, it } from "vitest";
import {
	createTestChannel,
	createTestMonitor,
	createTestUser,
	useCleanDatabase,
} from "../../../../test/db";
import {
	deleteUptimeMonitor,
	findUptimeMonitorById,
	updateUptimeMonitor,
} from "../monitor-service";

useCleanDatabase();

let userId: string;

beforeEach(async () => {
	const u = await createTestUser();
	userId = u.id;
});

describe("updateUptimeMonitor", () => {
	it("throws NOT_FOUND for a missing monitor", async () => {
		await expect(
			updateUptimeMonitor(
				{ uptimeMonitorId: "missing", name: "x" },
				userId,
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("updates provided fields and ignores undefined ones", async () => {
		const m = await createTestMonitor(userId, { name: "Before" });
		const updated = await updateUptimeMonitor(
			{
				uptimeMonitorId: m.uptimeMonitorId,
				name: "After",
				url: undefined,
			},
			userId,
		);
		expect(updated.name).toBe("After");
		expect(updated.url).toBe(m.url);
	});

	it("makes the next check due immediately when the interval changes", async () => {
		const m = await createTestMonitor(userId, {
			interval: 300,
			nextCheckAt: "2000-01-01T00:00:00.000Z",
		});
		const before = Date.now();
		const updated = await updateUptimeMonitor(
			{
				uptimeMonitorId: m.uptimeMonitorId,
				interval: 600,
			},
			userId,
		);
		expect(updated.interval).toBe(600);
    const next = Date.parse(updated.nextCheckAt!);
    expect(next).toBeGreaterThanOrEqual(before);
    expect(next).toBeLessThanOrEqual(Date.now());
  });

  it("checks an active changed target immediately and keeps a paused target unscheduled", async () => {
    for (const active of [true, false]) {
      const m = await createTestMonitor(userId, { active, nextCheckAt: "2000-01-01T00:00:00.000Z" });
      const before = Date.now();
      const updated = await updateUptimeMonitor({ uptimeMonitorId: m.uptimeMonitorId, url: "https://changed.example.com/" }, userId);
      expect(updated.url).toBe("https://changed.example.com/");
      if (active) {
        expect(Date.parse(updated.nextCheckAt!)).toBeGreaterThanOrEqual(before);
        expect(Date.parse(updated.nextCheckAt!)).toBeLessThanOrEqual(Date.now());
      } else expect(updated.nextCheckAt).toBe(m.nextCheckAt);
    }
  });
  it("makes the next check due immediately when resuming a paused monitor", async () => {
    const m = await createTestMonitor(userId, { active: false, nextCheckAt: "2000-01-01T00:00:00.000Z" });
    const before = Date.now();
    const updated = await updateUptimeMonitor({ uptimeMonitorId: m.uptimeMonitorId, active: true }, userId);
    expect(updated.active).toBe(true);
    expect(Date.parse(updated.nextCheckAt!)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(updated.nextCheckAt!)).toBeLessThanOrEqual(Date.now());
  });

	it("leaves nextCheckAt untouched when the interval is unchanged", async () => {
		const m = await createTestMonitor(userId, {
			interval: 300,
			nextCheckAt: "2000-01-01T00:00:00.000Z",
		});
		const updated = await updateUptimeMonitor(
			{
				uptimeMonitorId: m.uptimeMonitorId,
				interval: 300,
			},
			userId,
		);
		expect(updated.nextCheckAt).toBe("2000-01-01T00:00:00.000Z");
	});

	it("cannot update another user's monitor", async () => {
		const m = await createTestMonitor(userId, { name: "Owner value" });
		const other = await createTestUser();
		await expect(
			updateUptimeMonitor(
				{ uptimeMonitorId: m.uptimeMonitorId, name: "Attacker value" },
				other.id,
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		const unchanged = await findUptimeMonitorById(m.uptimeMonitorId, userId);
		expect(unchanged.name).toBe("Owner value");
	});
});

describe("findUptimeMonitorById", () => {
	it("returns the monitor with relations", async () => {
		const m = await createTestMonitor(userId);
		await createTestChannel(m.uptimeMonitorId, {
			webhookUrl: "https://hooks.example.com/private/path",
			webhookHeaders: { Authorization: "Bearer private" },
		});
		const other = await createTestUser();
		await createTestChannel(m.uptimeMonitorId, {
			userId: other.id,
			webhookUrl: "https://hooks.example.com/other-secret",
		});
		const found = await findUptimeMonitorById(m.uptimeMonitorId, userId);
		expect(found.uptimeMonitorId).toBe(m.uptimeMonitorId);
		expect(found.notificationChannels).toHaveLength(1);
		expect(found.notificationChannels[0]).toMatchObject({
			hasWebhookUrl: true,
			hasWebhookHeaders: true,
			webhookHeaderNames: ["Authorization"],
		});
		expect(found.notificationChannels[0]).not.toHaveProperty("webhookUrl");
		expect(found.notificationChannels[0]).not.toHaveProperty("webhookHeaders");
		expect(found.notificationChannels[0]).not.toHaveProperty("secretVersion");
		expect(Array.isArray(found.incidents)).toBe(true);
	});

	it("throws NOT_FOUND when absent", async () => {
		await expect(findUptimeMonitorById("missing", userId)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("throws NOT_FOUND when the requested monitor belongs to another user", async () => {
		const m = await createTestMonitor(userId);
		const other = await createTestUser();
		await expect(
			findUptimeMonitorById(m.uptimeMonitorId, other.id),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("deleteUptimeMonitor", () => {
	it("throws NOT_FOUND for a missing monitor", async () => {
		await expect(deleteUptimeMonitor("missing", userId)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("deletes an existing monitor", async () => {
		const m = await createTestMonitor(userId);
		await deleteUptimeMonitor(m.uptimeMonitorId, userId);
		await expect(
			findUptimeMonitorById(m.uptimeMonitorId, userId),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("cannot delete another user's monitor", async () => {
		const m = await createTestMonitor(userId);
		const other = await createTestUser();
		await expect(
			deleteUptimeMonitor(m.uptimeMonitorId, other.id),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(
			(await findUptimeMonitorById(m.uptimeMonitorId, userId)).uptimeMonitorId,
		).toBe(m.uptimeMonitorId);
	});
});
