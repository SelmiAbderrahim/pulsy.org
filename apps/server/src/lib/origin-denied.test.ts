import { describe, expect, it, vi } from "vitest";
import { OriginNotAllowedError, originDeniedHandler } from "./origin-denied";

const response = () => { const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res); return res; };
describe("refused browser origin", () => {
	it("answers 403 with the JSON error envelope instead of a generic 500", () => {
		const res = response(); const next = vi.fn();
		originDeniedHandler(new OriginNotAllowedError(), {} as never, res as never, next);
		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ error: { code: "origin_not_allowed", message: expect.any(String) } });
		expect(next).not.toHaveBeenCalled();
	});
	it("leaves every other error to the normal handlers", () => {
		const res = response(); const next = vi.fn(); const other = new Error("boom");
		originDeniedHandler(other, {} as never, res as never, next);
		expect(next).toHaveBeenCalledWith(other); expect(res.status).not.toHaveBeenCalled();
	});
});
