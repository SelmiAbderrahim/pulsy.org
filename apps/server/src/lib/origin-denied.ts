import type { ErrorRequestHandler } from "express";

/** Raised by the credentialed-CORS origin check when a browser origin is not one of this deployment's. */
export class OriginNotAllowedError extends Error {
	constructor() {
		super("Origin not allowed");
		this.name = "OriginNotAllowedError";
	}
}

/**
 * A refused origin is a client error, not a server fault: answer 403 with the same JSON envelope the REST
 * API uses instead of falling through to Express's generic 500 HTML page (which also pollutes error logs).
 */
export const originDeniedHandler: ErrorRequestHandler = (error, _request, response, next) => {
	if (!(error instanceof OriginNotAllowedError)) {
		next(error);
		return;
	}
	response.status(403).json({ error: { code: "origin_not_allowed", message: "This origin is not allowed to call the API." } });
};
