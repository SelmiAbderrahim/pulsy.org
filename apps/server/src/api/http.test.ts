import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import {
	getRequestTranslator,
	sendApiError,
	sendApiErrorMessage,
} from "./http";

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

function reqWith(acceptLanguage?: string | string[]): Request {
	return {
		headers: acceptLanguage ? { "accept-language": acceptLanguage } : {},
	} as unknown as Request;
}

describe("getRequestTranslator", () => {
	it("resolves the language from a string Accept-Language header", () => {
		const t = getRequestTranslator(reqWith("fr"));
		expect(t("errors.apiKeyInvalid")).toBe("La clé API fournie est invalide.");
	});

	it("uses the first entry of an array Accept-Language header", () => {
		const t = getRequestTranslator(reqWith(["de", "en"]));
		expect(t("errors.apiKeyInvalid")).toBe(
			"Der angegebene API-Schlüssel ist ungültig.",
		);
	});

	it("falls back to English when no header is present", () => {
		const t = getRequestTranslator(reqWith());
		expect(t("errors.apiKeyInvalid")).toBe("The provided API key is invalid.");
	});
});

describe("sendApiError", () => {
	it("writes a localized error envelope with the mapped status", () => {
		const { res, state } = mockRes();
		const t = getRequestTranslator(reqWith("en"));
		sendApiError(res, t, "unauthorized", "errors.apiKeyInvalid");
		expect(state.statusCode).toBe(401);
		expect(state.body).toEqual({
			error: { code: "unauthorized", message: "The provided API key is invalid." },
		});
	});

	it("interpolates vars and sets extra headers", () => {
		const { res, state } = mockRes();
		const t = getRequestTranslator(reqWith("en"));
		sendApiError(res, t, "rate_limited", "errors.rateLimited", {
			vars: { retryAfter: 30 },
			headers: { "Retry-After": "30" },
		});
		expect(state.statusCode).toBe(429);
		expect(state.headers["Retry-After"]).toBe("30");
		expect(state.body).toEqual({
			error: {
				code: "rate_limited",
				message: "Too many requests. Retry after 30 seconds.",
			},
		});
	});
});

describe("sendApiErrorMessage", () => {
	it("sends a literal (already-localized) message", () => {
		const { res, state } = mockRes();
		sendApiErrorMessage(res, "not_found", "Monitor not found");
		expect(state.statusCode).toBe(404);
		expect(state.body).toEqual({
			error: { code: "not_found", message: "Monitor not found" },
		});
	});
});
