import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedApiKey } from "../services/api-keys/api-key-service";
import { apiKeyAuth } from "./middleware";

function mockRes() {
	const state = {
		statusCode: 0,
		body: undefined as unknown,
		headers: {} as Record<string, string>,
	};
	const res = {
		setHeader(name: string, value: string) {
			state.headers[name] = value;
		},
		status(code: number) {
			state.statusCode = code;
			return res;
		},
		json(body: unknown) {
			state.body = body;
			return res;
		},
	} as unknown as Response;
	return { res, state };
}

function mockReq(overrides: Partial<Request> = {}): Request {
	return { headers: {}, ...overrides } as unknown as Request;
}

const resolveOk: ResolvedApiKey = {
	ok: true,
	user: { id: "user_1" },
	apiKeyId: "key_1",
  scope: "full",
};

describe("apiKeyAuth", () => {
	it("401s when the Authorization header is missing", async () => {
		const { res, state } = mockRes();
		const next = vi.fn();
		const resolve = vi.fn();
		await apiKeyAuth({ resolve })(mockReq(), res, next as NextFunction);
		expect(state.statusCode).toBe(401);
		expect((state.body as { error: { code: string } }).error.code).toBe(
			"unauthorized",
		);
		expect(next).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});

	it("401s when the scheme is not Bearer", async () => {
		const { res, state } = mockRes();
		const next = vi.fn();
		await apiKeyAuth({ resolve: vi.fn() })(
			mockReq({ headers: { authorization: "Basic abc" } as never }),
			res,
			next as NextFunction,
		);
		expect(state.statusCode).toBe(401);
		expect(next).not.toHaveBeenCalled();
	});

	it("401s when the Bearer token is empty", async () => {
		const { res, state } = mockRes();
		const next = vi.fn();
		await apiKeyAuth({ resolve: vi.fn() })(
			mockReq({ headers: { authorization: "Bearer    " } as never }),
			res,
			next as NextFunction,
		);
		expect(state.statusCode).toBe(401);
		expect(next).not.toHaveBeenCalled();
	});

	it("401s with the invalid message when resolution fails", async () => {
		const { res, state } = mockRes();
		const next = vi.fn();
		const resolve = vi
			.fn()
			.mockResolvedValue({ ok: false, reason: "invalid" } as ResolvedApiKey);
		await apiKeyAuth({ resolve })(
			mockReq({ headers: { authorization: "Bearer pul_bad" } as never }),
			res,
			next as NextFunction,
		);
		expect(state.statusCode).toBe(401);
		expect((state.body as { error: { message: string } }).error.message).toBe(
			"The provided API key is invalid.",
		);
		expect(next).not.toHaveBeenCalled();
	});

	it("401s with the revoked message when the key is revoked", async () => {
		const { res, state } = mockRes();
		const next = vi.fn();
		const resolve = vi
			.fn()
			.mockResolvedValue({ ok: false, reason: "revoked" } as ResolvedApiKey);
		await apiKeyAuth({ resolve })(
			mockReq({ headers: { authorization: "Bearer pul_revoked" } as never }),
			res,
			next as NextFunction,
		);
		expect(state.statusCode).toBe(401);
		expect((state.body as { error: { message: string } }).error.message).toBe(
			"This API key has been revoked.",
		);
	});

	it("attaches the user/access/key and calls next on success", async () => {
		const { res } = mockRes();
		const next = vi.fn();
		const resolve = vi.fn().mockResolvedValue(resolveOk);
		const req = mockReq({
			headers: { authorization: "Bearer pul_good" } as never,
		});
		await apiKeyAuth({ resolve })(req, res, next as NextFunction);
		expect(next).toHaveBeenCalledOnce();
		expect(req.apiUser).toEqual({ id: "user_1" });
		expect(req.apiKeyId).toBe("key_1");
		expect(req.apiTranslator).toBeTypeOf("function");
	});

	it("uses the real resolver by default (no deps)", async () => {
		const { res, state } = mockRes();
		const next = vi.fn();
		// Garbage token → real resolveApiKey returns invalid without a DB hit.
		await apiKeyAuth()(
			mockReq({ headers: { authorization: "Bearer not-a-pulsy-key" } as never }),
			res,
			next as NextFunction,
		);
		expect(state.statusCode).toBe(401);
		expect(next).not.toHaveBeenCalled();
	});
});
