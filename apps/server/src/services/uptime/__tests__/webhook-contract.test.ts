import { afterEach, describe, expect, it } from "vitest";
import { createTestMonitor, createTestUser, useCleanDatabase } from "../../../../test/db";
import { buildWebhookBody, webhookHeaders, webhookV1 } from "../webhook-contract";

useCleanDatabase();
const previousBase = process.env.PUBLIC_WEB_URL;
afterEach(() => { if (previousBase === undefined) delete process.env.PUBLIC_WEB_URL; else process.env.PUBLIC_WEB_URL = previousBase; });

const body = '{"version":1,"id":"00000000-0000-4000-8000-000000000000","event":"test","test":true,"timestamp":"2026-10-16T12:00:00.000Z","monitor":{"id":"m","name":"n","url":"https://example.com","type":"http"}}';

describe("webhook v1 signing", () => {
	it("signs the exact body with HMAC-SHA256 (known vector computed independently)", () => {
		const headers = webhookHeaders(body, "whsec_known_secret");
		expect(headers["X-Pulsy-Signature"]).toBe("sha256=8c048817e70d80ebb80612d2c83adb41cb63bc5fb57045059df4e8c813cea695");
		expect(headers["X-Pulsy-Event"]).toBe("test");
		expect(headers["X-Pulsy-Delivery"]).toBe("00000000-0000-4000-8000-000000000000");
		expect(headers["Idempotency-Key"]).toBe(headers["X-Pulsy-Delivery"]);
		expect(headers["X-Pulsy-Timestamp"]).toBe("2026-10-16T12:00:00.000Z");
	});

	it("changes the signature when the body or the secret changes", () => {
		const base = webhookHeaders(body, "whsec_known_secret")["X-Pulsy-Signature"];
		expect(webhookHeaders(body, "another-secret")["X-Pulsy-Signature"]).not.toBe(base);
		expect(webhookHeaders(body.replace('"n"', '"o"'), "whsec_known_secret")["X-Pulsy-Signature"]).not.toBe(base);
	});

	it("refuses to sign a body that is not a v1 payload", () => {
		expect(() => webhookHeaders('{"version":2}', "secret")).toThrow();
	});
});

describe("webhook v1 payload", () => {
	const at = "2026-10-16T12:00:00.000Z";
	const change = (over: Record<string, unknown> = {}) => ({ statusChangeId: "change-1", statusAfter: "down", createdAt: at, reason: "connection_refused", httpStatus: null, ...over });

	it.each([
		["down", "monitor.down"],
		["up", "monitor.up"],
		["degraded", "monitor.degraded"],
	] as const)("maps a %s transition to %s, marks it non-test and carries the contract fields", async (statusAfter, event) => {
		process.env.PUBLIC_WEB_URL = "https://pulsy.example";
		const owner = await createTestUser();
		const monitor = await createTestMonitor(owner.id, { name: "API", url: "https://api.example.com" });
		const payload = webhookV1.parse(JSON.parse(await buildWebhookBody("channel-1", monitor, change({ statusAfter, reason: statusAfter === "up" ? null : "connection_refused" }))));
		expect(payload).toMatchObject({ version: 1, event, test: false, timestamp: at, monitor: { id: monitor.uptimeMonitorId, name: "API", url: "https://api.example.com" } });
		expect(JSON.stringify(payload)).not.toContain(owner.id);
	});

	it("flags test deliveries with test: true and never attaches an incident", async () => {
		const owner = await createTestUser();
		const monitor = await createTestMonitor(owner.id);
		const payload = JSON.parse(await buildWebhookBody("channel-1", monitor, change({ test: true })));
		expect(payload).toMatchObject({ event: "test", test: true });
		expect(payload).not.toHaveProperty("incident");
		expect(payload).not.toHaveProperty("reason");
	});

	it("uses a stable delivery id per channel and change, distinct across channels and changes", async () => {
		const owner = await createTestUser();
		const monitor = await createTestMonitor(owner.id);
		const id = async (channel: string, changeId: string) => JSON.parse(await buildWebhookBody(channel, monitor, change({ statusChangeId: changeId }))).id as string;
		expect(await id("c1", "x")).toBe(await id("c1", "x"));
		expect(await id("c1", "x")).not.toBe(await id("c2", "x"));
		expect(await id("c1", "x")).not.toBe(await id("c1", "y"));
	});

	it("reports a localized-independent reason code, never English text, in reason.code", async () => {
		const owner = await createTestUser();
		const monitor = await createTestMonitor(owner.id);
		const payload = JSON.parse(await buildWebhookBody("c", monitor, change({ reason: "dns_not_found" })));
		expect(payload.reason.code).toBe("dns_not_found");
	});
});
