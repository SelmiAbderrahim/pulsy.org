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

/** Extract the bearer token (scheme is case-insensitive per RFC 9110), or null when absent/malformed. */
function extractBearerToken(header: string | undefined): string | null {
	const match = header ? /^bearer[ \t]+(\S+)[ \t]*$/i.exec(header) : null;
	return match ? match[1]! : null;
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
    req.apiKeyScope = result.scope;
		next();
	};
}

/** API access depends only on the authenticating key's scope. */
export function requireApiScope(scope: "read" | "full") {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.apiKeyScope !== "full" && !(scope === "read" && req.apiKeyScope === "read")) {
      sendApiError(res, req.apiTranslator ?? getRequestTranslator(req), "forbidden", "errors.apiKeyAccessNotAllowed"); return;
    }
    next();
  };
}
