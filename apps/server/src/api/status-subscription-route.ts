import express from "express";
import { apiStatusSubscriptionRedeem, apiStatusSubscriptionRequest, db, uptimeStatusPage } from "@pulsy/db";
import { eq } from "drizzle-orm";
import { PUBLIC_WEB_URL } from "../lib/auth-config";
import { publicPageUrl } from "../services/uptime/status-public-url";
import { redeemSubscriptionToken, requestSubscription } from "../services/uptime/status-subscription";
/** No session/API-key authority. Fragment capabilities are redeemed only in a bounded JSON body. */
export function createStatusSubscriptionRouter(): express.Router {
  const router = express.Router(); let active = 0;
  const paths = ["/pages/:key/subscribe", "/pages/:key/subscription"];
  const validate = (subscription: boolean): express.RequestHandler => async (req, res, next) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(req.params.key ?? ""))) { res.status(404).json({ outcome: "unavailable" }); return; }
    if (Object.keys(req.query).length) { res.status(400).json({ outcome: "invalid" }); return; }
    if (!["POST", "OPTIONS"].includes(req.method)) { res.setHeader("Allow", "POST, OPTIONS"); res.status(405).json({ outcome: "invalid" }); return; }
    // Technical bound: 16 active subscription requests/process, within the parent IP budget; revisit after measured subscription traffic.
    if (active >= 16) { res.setHeader("Retry-After", "1"); res.status(503).json({ outcome: "busy" }); return; }
    active++; let released = false;
    const release = () => { if (!released) { released = true; active--; } }; res.once("finish", release); res.once("close", release);
    try {
      const [page] = await db.select().from(uptimeStatusPage).where(eq(uptimeStatusPage.statusPageId, String(req.params.key ?? ""))).limit(1);
      // Unsubscribe must continue to work after a page is unpublished.
      if (!page || !subscription && !page.isPublished) { res.status(404).json({ outcome: "unavailable" }); return; }
      const origin = req.get("Origin"), allowed = new Set([new URL(PUBLIC_WEB_URL).origin, new URL(publicPageUrl(page)).origin]);
      if (!origin || !allowed.has(origin)) { res.status(403).json({ outcome: "forbidden" }); return; }
      res.setHeader("Vary", "Host, Accept-Language, Origin"); res.setHeader("Access-Control-Allow-Origin", origin);
      if (req.method === "OPTIONS") {
        if (req.get("Access-Control-Request-Method") !== "POST" || (req.get("Access-Control-Request-Headers") ?? "").split(",").some(value => value.trim() && value.trim().toLowerCase() !== "content-type")) { res.status(403).json({ outcome: "forbidden" }); return; }
        res.setHeader("Access-Control-Allow-Methods", "POST"); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.status(204).end(); return;
      }
      if (!req.is("application/json")) { res.status(415).json({ outcome: "invalid" }); return; }
      next();
    } catch { res.setHeader("Retry-After", "1"); res.status(503).json({ outcome: "unavailable" }); }
  };
  // Bind the operation to its registered route, independent of Express case
  // matching or optional trailing slashes.
  router.use(paths[0]!, validate(false));
  router.use(paths[1]!, validate(true));
  const parse = express.json({ limit: "16kb", strict: true, inflate: false });
  const submit = (subscription: boolean): express.RequestHandler => async (req, res) => {
    try {
      if (subscription) { const input = apiStatusSubscriptionRedeem.safeParse(req.body); if (!input.success) { res.status(400).json({ outcome: "invalid" }); return; } res.status(202).json(await redeemSubscriptionToken(String(req.params.key ?? ""), input.data)); }
      else { const input = apiStatusSubscriptionRequest.safeParse(req.body); if (!input.success) { res.status(400).json({ outcome: "invalid" }); return; } res.status(202).json(await requestSubscription(String(req.params.key ?? ""), input.data)); }
    } catch { res.setHeader("Retry-After", "1"); res.status(503).json({ outcome: "unavailable" }); }
  };
  router.post(paths[0]!, parse, submit(false));
  router.post(paths[1]!, parse, submit(true));
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const type = error && typeof error === "object" && "type" in error ? error.type : null;
    res.status(type === "entity.too.large" ? 413 : type === "encoding.unsupported" ? 415 : 400).json({ outcome: "invalid" });
  });
  return router;
}
