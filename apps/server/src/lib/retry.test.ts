import { afterEach, describe, expect, it, vi } from "vitest";
import {
	NOTIFICATION_RETRY_DELAYS_MS,
	NotificationSendError,
	isTransientSendError,
	resolveDefaultRetryDelays,
	withRetry,
} from "./retry";

describe("NotificationSendError", () => {
	it("carries the http status", () => {
		const err = new NotificationSendError("boom", 503);
		expect(err.name).toBe("NotificationSendError");
		expect(err.httpStatus).toBe(503);
		expect(err.message).toBe("boom");
	});
});

describe("isTransientSendError", () => {
	it("retries a 429 and 5xx NotificationSendError", () => {
		expect(isTransientSendError(new NotificationSendError("x", 429))).toBe(true);
		expect(isTransientSendError(new NotificationSendError("x", 500))).toBe(true);
		expect(isTransientSendError(new NotificationSendError("x", 502))).toBe(true);
	});

	it("does not retry a 4xx (except 429) NotificationSendError", () => {
		expect(isTransientSendError(new NotificationSendError("x", 401))).toBe(false);
		expect(isTransientSendError(new NotificationSendError("x", 404))).toBe(false);
		expect(isTransientSendError(new NotificationSendError("x", 422))).toBe(false);
	});

	it("does not retry a NotificationSendError with no status", () => {
		expect(isTransientSendError(new NotificationSendError("x"))).toBe(false);
	});

	it("retries timeout and abort errors", () => {
		const timeout = new Error("timed out");
		timeout.name = "TimeoutError";
		const abort = new Error("aborted");
		abort.name = "AbortError";
		expect(isTransientSendError(timeout)).toBe(true);
		expect(isTransientSendError(abort)).toBe(true);
	});

	it("retries socket-level errors by code", () => {
		for (const code of [
			"ECONNRESET",
			"ETIMEDOUT",
			"ECONNREFUSED",
			"EAI_AGAIN",
			"EPIPE",
		]) {
			const err = Object.assign(new Error("net"), { code });
			expect(isTransientSendError(err)).toBe(true);
		}
	});

	it("retries a fetch network TypeError", () => {
		expect(isTransientSendError(new TypeError("fetch failed"))).toBe(true);
	});

	it("does not retry a plain Error, a non-transient code, or a non-Error", () => {
		expect(isTransientSendError(new Error("nope"))).toBe(false);
		expect(
			isTransientSendError(Object.assign(new Error("x"), { code: "EACCES" })),
		).toBe(false);
		expect(isTransientSendError("just a string")).toBe(false);
	});
});

describe("withRetry", () => {
	const instant = async (_ms: number) => {};

	it("returns the value on first success without sleeping", async () => {
		const sleep = vi.fn(instant);
		const result = await withRetry(async () => "ok", { sleep });
		expect(result).toEqual({ ok: true, value: "ok", attempts: 1 });
		expect(sleep).not.toHaveBeenCalled();
	});

	it("retries transient failures then succeeds, honoring the delay schedule", async () => {
		const sleep = vi.fn(instant);
		const onRetry = vi.fn();
		let n = 0;
		const result = await withRetry(
			async () => {
				n += 1;
				if (n < 3) throw new NotificationSendError("temporarily down", 503);
				return "recovered";
			},
			{ sleep, onRetry, delaysMs: [10, 20, 30] },
		);
		expect(result).toEqual({ ok: true, value: "recovered", attempts: 3 });
		expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20]);
		expect(onRetry).toHaveBeenCalledTimes(2);
	});

	it("gives up after exhausting the schedule and reports the last error", async () => {
		const sleep = vi.fn(instant);
		const err = new NotificationSendError("still down", 500);
		const result = await withRetry(
			async () => {
				throw err;
			},
			{ sleep, delaysMs: [1, 1] },
		);
		expect(result).toEqual({ ok: false, error: err, attempts: 3 });
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it("fails fast on a non-retryable error without sleeping", async () => {
		const sleep = vi.fn(instant);
		const err = new NotificationSendError("bad key", 401);
		const result = await withRetry(
			async () => {
				throw err;
			},
			{ sleep },
		);
		expect(result).toEqual({ ok: false, error: err, attempts: 1 });
		expect(sleep).not.toHaveBeenCalled();
	});

	it("uses the real timer sleep when none is injected", async () => {
		let n = 0;
		const result = await withRetry(
			async () => {
				n += 1;
				if (n === 1) throw new NotificationSendError("blip", 503);
				return "ok";
			},
			{ delaysMs: [1] },
		);
		expect(result).toEqual({ ok: true, value: "ok", attempts: 2 });
	});

	it("exposes the production backoff schedule", () => {
		expect(NOTIFICATION_RETRY_DELAYS_MS).toEqual([30_000, 120_000, 600_000]);
	});
});

describe("resolveDefaultRetryDelays", () => {
	const KEY = "NOTIFICATION_RETRY_DELAYS_MS";
	const original = process.env[KEY];

	afterEach(() => {
		if (original === undefined) delete process.env[KEY];
		else process.env[KEY] = original;
	});

	it("falls back to the production schedule when the env var is unset", () => {
		delete process.env[KEY];
		expect(resolveDefaultRetryDelays()).toEqual([30_000, 120_000, 600_000]);
	});

	it("disables retries when the env var is empty (the test-env default)", () => {
		process.env[KEY] = "";
		expect(resolveDefaultRetryDelays()).toEqual([]);
	});

	it("parses a comma-separated ms list and drops non-finite entries", () => {
		process.env[KEY] = " 10, 20 , x, 30 ";
		expect(resolveDefaultRetryDelays()).toEqual([10, 20, 30]);
	});
});
