import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { mockFetch } from "../../../../test/fetch-mock";
import { authedCaller } from "../../../../test/trpc-caller";
import { dispatchNotifications } from "../notification-service";

vi.mock("../scheduler-service", () => ({ scheduleMonitorCheck: vi.fn(), cancelMonitorCheck: vi.fn(), rescheduleMonitorCheck: vi.fn(), withMonitorCheckSlot: async <T,>(work: () => Promise<T>) => work() }));
useCleanDatabase();

const INSTANT = { sleep: async () => {}, delaysMs: [1, 1, 1] };

describe("webhook v1 retries keep one delivery identity", () => {
	it("reuses the delivery id, idempotency key and a valid signature on every attempt; a later transition gets a new id", async () => {
		const owner = await createTestUser();
		const monitor = await createTestMonitor(owner.id, { name: "Retry API", url: "https://retry.example.com", status: "up" });
		const secret = randomBytes(32).toString("hex");
		const channel = await authedCaller(owner).uptimeMonitor.channel.createDefault({ channelType: "webhook", webhookUrl: "https://hooks.example.com/retry", signingSecret: secret });
		expect(channel).not.toHaveProperty("signingSecret");
		expect(channel).not.toHaveProperty("signingSecretCipher");
		const change = (statusChangeId: string, statusBefore: string, statusAfter: string) => ({
			statusChangeId, uptimeMonitorId: monitor.uptimeMonitorId, statusBefore, statusAfter,
			httpStatus: statusAfter === "down" ? 503 : 200, responseTime: 100, reason: statusAfter === "down" ? "connection_refused" : null,
			createdAt: new Date().toISOString(),
		});
		let attempt = 0;
		const fx = mockFetch(() => (++attempt < 3 ? new Response("busy", { status: 503 }) : new Response("ok", { status: 200 })));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await dispatchNotifications(monitor, change("sc-down", "up", "down"), INSTANT);
			expect(fx.calls).toHaveLength(3);
			const ids = new Set(fx.calls.map(call => call.headers["X-Pulsy-Delivery"]));
			expect(ids.size).toBe(1);
			expect(new Set(fx.calls.map(call => call.body)).size).toBe(1);
			expect(new Set(fx.calls.map(call => call.headers["X-Pulsy-Signature"])).size).toBe(1);
			expect(fx.calls[0]!.headers["X-Pulsy-Delivery"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
			for (const call of fx.calls) {
				expect(call.headers["Idempotency-Key"]).toBe(call.headers["X-Pulsy-Delivery"]);
				expect(JSON.parse(call.body as string)).toMatchObject({ version: 1, event: "monitor.down", test: false, id: call.headers["X-Pulsy-Delivery"], timestamp: call.headers["X-Pulsy-Timestamp"] });
				expect(call.headers["X-Pulsy-Signature"]).toBe(`sha256=${createHmac("sha256", secret).update(call.body as string).digest("hex")}`);
			}
			await dispatchNotifications(monitor, change("sc-up", "down", "up"), INSTANT);
			expect(fx.calls).toHaveLength(4);
			expect(fx.calls[3]!.headers["X-Pulsy-Delivery"]).not.toBe(fx.calls[0]!.headers["X-Pulsy-Delivery"]);
			expect(JSON.parse(fx.calls[3]!.body as string)).toMatchObject({ event: "monitor.up", test: false });
		} finally { fx.restore(); warn.mockRestore(); }
	});
});
