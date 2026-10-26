import { describe, expect, it, vi } from "vitest";
import { FIRST_CHECK_JITTER_MS, firstCheckAt } from "../first-check";

describe("firstCheckAt", () => {
	const now = Date.parse("2026-10-16T12:00:00.000Z");

	it("is due immediately for a single create, resume or retarget", () => {
		expect(firstCheckAt(1, now)).toBe("2026-10-16T12:00:00.000Z");
		expect(firstCheckAt(undefined, now)).toBe("2026-10-16T12:00:00.000Z");
	});

	it("is always within the 10 s first-result budget, whatever the batch size", () => {
		for (const size of [1, 2, 50, 200]) {
			const delay = Date.parse(firstCheckAt(size, now)) - now;
			expect(delay).toBeGreaterThanOrEqual(0);
			expect(delay).toBeLessThan(10_000);
		}
	});

	it("spreads bulk creates over at most the jitter window", () => {
		const random = vi.spyOn(Math, "random");
		random.mockReturnValueOnce(0).mockReturnValueOnce(0.999999);
		expect(Date.parse(firstCheckAt(20, now)) - now).toBe(0);
		expect(Date.parse(firstCheckAt(20, now)) - now).toBe(FIRST_CHECK_JITTER_MS - 1);
		random.mockRestore();
		expect(FIRST_CHECK_JITTER_MS).toBeLessThanOrEqual(5_000);
	});
});
