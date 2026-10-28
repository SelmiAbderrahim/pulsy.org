import express, { type ErrorRequestHandler } from "express";
import { createIpRateLimiter } from "../lib/ip-rate-limit";

const RELEASE_FILES = new Set([
  "/install.sh", "/compose.yaml", "/SHA256SUMS",
  "/pulsy-agent-linux-amd64", "/pulsy-agent-linux-arm64",
]);

/** Version-keyed, credential-free files built into this server image. */
export function createAgentReleaseRouter(directory = "/app/agent-dist/v1.0.0"): express.Router {
  const router = express.Router();
  router.use(createIpRateLimiter({
    limit: 240, maxBuckets: 1024, failClosed: true,
    onLimited: res => { res.setHeader("Cache-Control", "no-store"); res.json({ outcome: "limited" }); },
  }));
  router.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.setHeader("Cache-Control", "no-store");
      res.status(405).json({ outcome: "invalid" });
      return;
    }
    if (!RELEASE_FILES.has(req.path) || Object.keys(req.query).length) {
      res.setHeader("Cache-Control", "no-store");
      res.status(404).json({ outcome: "unavailable" });
      return;
    }
    next();
  });
  router.use(express.static(directory, {
    dotfiles: "deny", index: false, redirect: false, fallthrough: false,
    immutable: true, maxAge: "1y",
  }));
  const unavailable: ErrorRequestHandler = (_error, _req, res, _next) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ outcome: "unavailable" });
  };
  router.use(unavailable);
  return router;
}
