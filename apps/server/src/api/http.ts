// Shared HTTP helpers for the public REST API: localized JSON error envelopes
// and per-request translator resolution (via `Accept-Language`, reusing the
// backend i18n dictionary).

import type { Request, Response } from "express";
import {
	getEffectiveLanguage,
	getTranslator,
	type Translator,
} from "../lib/i18n";
import "./types";

/** Stable REST error codes → HTTP status. */
export const API_ERROR_STATUS = {
	unauthorized: 401,
	forbidden: 403,
	not_found: 404,
	validation_error: 422,
	rate_limited: 429,
	internal: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

/** Resolve a translator for a request from its `Accept-Language` header. */
export function getRequestTranslator(req: Request): Translator {
	const header = req.headers["accept-language"];
	const acceptLanguage = Array.isArray(header) ? header[0] : header;
	return getTranslator(getEffectiveLanguage({ acceptLanguage }));
}

/**
 * Send a localized `{ error: { code, message } }` envelope. Optional headers
 * (e.g. `Retry-After`) are set before the body is written.
 */
export function sendApiError(
	res: Response,
	t: Translator,
	code: ApiErrorCode,
	messageKey: string,
	opts: {
		vars?: Record<string, string | number>;
		headers?: Record<string, string>;
	} = {},
): void {
	if (opts.headers) {
		for (const [name, value] of Object.entries(opts.headers)) {
			res.setHeader(name, value);
		}
	}
	res.status(API_ERROR_STATUS[code]).json({
		error: { code, message: t(messageKey, opts.vars) },
	});
}

/**
 * Send an error with an already-localized literal message (e.g. a thrown
 * `TRPCError.message` that was built with the request translator).
 */
export function sendApiErrorMessage(
	res: Response,
	code: ApiErrorCode,
	message: string,
): void {
	res.status(API_ERROR_STATUS[code]).json({ error: { code, message } });
}
