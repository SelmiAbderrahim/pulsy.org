// Bearer API-key authentication for the public REST API.
//
//   apiKeyAuth() — resolve `Authorization: Bearer pul_…` to a user, attach
//                  `req.apiUser`/`req.apiKeyId`, 401 on missing/invalid/revoked
//                  (localized).
//
// This is a custom middleware: better-auth has no apiKey/bearer plugin enabled,
// and `/api/v1` authenticates with the key, never the session cookie.

import type { NextFunction, Request, Response } from "express";
import { resolveApiKey as defaultResolveApiKey } from "../services/api-keys/api-key-service";
import { getRequestTranslator, sendApiError } from "./http";
import "./types";

const BEARER_PREFIX = "Bearer ";

/** Extract the bearer token, or null when the header is absent/malformed. */
function extractBearerToken(header: string | undefined): string | null {
	if (!header || !header.startsWith(BEARER_PREFIX)) {
		return null;
	}
	const token = header.slice(BEARER_PREFIX.length).trim();
	return token.length > 0 ? token : null;
}

/** Factory so tests can inject a fake resolver; prod uses the real service. */
export function apiKeyAuth(
	deps: { resolve?: typeof defaultResolveApiKey } = {},
) {
	const resolve = deps.resolve ?? defaultResolveApiKey;
	return async (
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> => {
		const t = getRequestTranslator(req);
		req.apiTranslator = t;

		const token = extractBearerToken(req.headers.authorization);
		if (!token) {
			sendApiError(res, t, "unauthorized", "errors.apiKeyInvalid");
			return;
		}

		const result = await resolve(token);
		if (!result.ok) {
			const key =
				result.reason === "revoked"
					? "errors.apiKeyRevoked"
					: "errors.apiKeyInvalid";
			sendApiError(res, t, "unauthorized", key);
			return;
		}

		req.apiUser = result.user;
		req.apiKeyId = result.apiKeyId;
		next();
	};
}
