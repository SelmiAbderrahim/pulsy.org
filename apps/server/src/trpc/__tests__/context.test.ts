import type { Request, Response } from "express";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock better-auth so createContext never makes a real session round-trip.
// `vi.hoisted` runs before the hoisted `vi.mock` factory, so the spy exists
// when the factory references it.
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../../auth/auth", () => ({
	auth: { api: { getSession } },
}));

import { createContext, publicProcedure, router } from "../trpc";

// A minimal Express-shaped request: only `headers` is read by createContext.
function fakeReq(headers: Record<string, string | string[] | undefined>): Request {
	return { headers } as unknown as Request;
}

const fakeRes = { setHeader: vi.fn() } as unknown as Response;

beforeEach(() => {
	getSession.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createContext", () => {
	it("generates a fresh server request reference and returns it in the response header", async () => {
		getSession.mockResolvedValue(null);
		const first = await createContext({ req: fakeReq({ "x-request-id": "untrusted-client-id" }), res: fakeRes });
		const second = await createContext({ req: fakeReq({}), res: fakeRes });
		expect(first).toHaveProperty("requestId", expect.stringMatching(/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/));
		expect(second).toHaveProperty("requestId", expect.not.stringContaining("untrusted"));
		expect(first).not.toHaveProperty("requestId", Reflect.get(second, "requestId"));
		expect(fakeRes.setHeader).toHaveBeenCalledWith("X-Request-Id", Reflect.get(first, "requestId"));
	});

	it("uses the same reference in a safe localized HTTP error and its response header", async () => {
		getSession.mockResolvedValue(null);
		const app = express();
		app.use("/rpc", createExpressMiddleware({ createContext, router: router({
			fail: publicProcedure.query(() => { throw new Error("private-provider-token"); }),
		}) }));
		const server = app.listen(0, "127.0.0.1");
		await new Promise<void>(resolve => server.once("listening", resolve));
		try {
			const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc/fail`, { headers: { "accept-language": "fr" } });
			const body = z.object({ error: z.object({ json: z.object({
				message: z.string(), data: z.object({ requestId: z.string(), stack: z.string().optional() }),
			}) }) }).parse(await response.json());
			const requestId = response.headers.get("x-request-id");
			expect(response.status).toBe(500);
			expect(requestId).toEqual(expect.any(String));
			expect(body.error.json.data.requestId).toBe(requestId);
			expect(body.error.json.message).toContain(requestId);
			expect(JSON.stringify(body)).not.toContain("private-provider-token");
			expect(body.error.json.data.stack).toBeUndefined();
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		}
	});
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
