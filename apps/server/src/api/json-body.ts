import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth/auth";
import { getRequestTranslator } from "./http";
/** Larger manifests and component drafts use only their protected UI transports.
 * REST configuration keeps its own API-key/read/write middleware and parser.
 */
export function createApiJsonParser(): RequestHandler {
  const normal = express.json();
  const bounded = express.json({ limit: "1mb", strict: true, inflate: false });
  return async (req, res, next) => {
    if (/^\/api\/v1\/configuration(?:\/|$)/i.test(req.path)) { next(); return; }
    const manifest = /^\/api\/trpc\/uptimeMonitor\.portability\.(?:export|preview|reconcile)$/.test(req.path);
    const components = /^\/api\/trpc\/uptimeMonitor\.statusPage\.communication\.(?:componentsPreviewPost|componentsApply)$/.test(req.path);
    if (req.method !== "POST" || (!manifest && !components)) { normal(req, res, next); return; }
    const t = getRequestTranslator(req);
    const invalid = components ? "errors.statusPageCommunicationInvalid" : "errors.manifestInvalid";
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session?.user) { res.status(401).json({ error: { code: "unauthorized", message: t("errors.unauthorized") } }); return; }
      bounded(req, res, error => {
        if (!error) { next(); return; }
        const status = error && typeof error === "object" && "status" in error ? error.status : 400;
        res.status(status === 413 ? 413 : status === 415 ? 415 : 400).json({ error: { code: "invalid_request", message: t(invalid) } });
      });
    } catch { res.status(503).json({ error: { code: "unavailable", message: t(invalid) } }); }
  };
}

/**
 * Body-parser failures on `/api/v1` (malformed JSON, oversized or unsupported
 * body) would otherwise reach Express' default HTML error page, bypassing the
 * documented `{ error: { code, message } }` envelope. Mount after the parser.
 */
export const apiJsonErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  const type = error && typeof error === "object" && "type" in error ? error.type : "";
  if (res.headersSent || (type !== "entity.parse.failed" && type !== "entity.too.large" && type !== "encoding.unsupported" && type !== "charset.unsupported")) { next(error); return; }
  const status = type === "entity.too.large" ? 413 : type === "entity.parse.failed" ? 400 : 415;
  res.status(status).json({ error: { code: "validation_error", message: getRequestTranslator(req)("errors.badRequest") } });
};
