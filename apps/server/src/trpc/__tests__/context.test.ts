import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock better-auth so createContext never makes a real session round-trip.
// `vi.hoisted` runs before the hoisted `vi.mock` factory, so the spy exists
// when the factory references it.
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../../auth/auth", () => ({
	auth: { api: { getSession } },
}));

import { createContext } from "../trpc";

// A minimal Express-shaped request: only `headers` is read by createContext.
function fakeReq(headers: Record<string, string | string[] | undefined>): Request {
	return { headers } as unknown as Request;
}

const fakeRes = {} as Response;

beforeEach(() => {
	getSession.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createContext", () => {
	it("populates user/session when better-auth returns a session", async () => {
		const user = { id: "user-1", email: "a@b.test" };
		const session = { id: "sess-1", userId: "user-1" };
		getSession.mockResolvedValue({ user, session });

		// Include an array-valued header (set-cookie) and a string header to
		// exercise both branches of the Express→WHATWG headers conversion.
		const ctx = await createContext({
			req: fakeReq({
				"accept-language": "fr",
				"set-cookie": ["a=1", "b=2"],
				"x-undefined": undefined,
			}),
			res: fakeRes,
		});

		expect(ctx.db).toBeDefined();
		expect(ctx.user).toEqual(user);
		expect(ctx.session).toEqual(session);
		expect(ctx.language).toBe("fr");
		expect(typeof ctx.t).toBe("function");
		// The translator resolves real keys (not echoing the key back).
		expect(ctx.t("errors.unauthorized")).not.toBe("errors.unauthorized");
		// The conversion forwarded the cookie header to better-auth.
		const passedHeaders = getSession.mock.calls[0]?.[0]?.headers as Headers;
		expect(passedHeaders.get("set-cookie")).toContain("a=1");
		expect(passedHeaders.get("accept-language")).toBe("fr");
	});

	it("sets user/session to null when there is no session", async () => {
		getSession.mockResolvedValue(null);

		// An array-valued accept-language exercises the Array.isArray branch
		// (first element wins).
		const ctx = await createContext({
			req: fakeReq({ "accept-language": ["de", "en"] }),
			res: fakeRes,
		});

		expect(ctx.user).toBeNull();
		expect(ctx.session).toBeNull();
		expect(ctx.language).toBe("de");
	});

	it("falls back to null user/session when getSession throws", async () => {
		getSession.mockRejectedValue(new Error("auth backend down"));

		const ctx = await createContext({
			req: fakeReq({}),
			res: fakeRes,
		});

		expect(ctx.user).toBeNull();
		expect(ctx.session).toBeNull();
		// No accept-language header → default language.
		expect(ctx.language).toBe("en");
	});
});
