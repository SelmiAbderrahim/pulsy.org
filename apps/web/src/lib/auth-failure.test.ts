import { describe, expect, it } from "vitest";
import { authFailureKey } from "./auth-failure";

describe("authFailureKey", () => {
	it("recognises a rate limit and keeps the fallback for everything else", () => {
		expect(authFailureKey({ status: 429 }, "auth:login.error")).toBe("auth:ux.rateLimited");
		expect(authFailureKey({ status: "429" }, "auth:login.error")).toBe("auth:ux.rateLimited");
		for (const error of [{ status: 401 }, { status: 422 }, { status: 500 }, { message: "x" }, null, undefined, "429", 429]) expect(authFailureKey(error, "auth:login.error")).toBe("auth:login.error");
	});
});
