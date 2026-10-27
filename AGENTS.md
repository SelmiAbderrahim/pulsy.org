# Pulsy -- AI Agent Guide

> This file follows the [AGENTS.md](https://agents.md) convention read by most
> AI coding tools. Claude Code additionally reads `CLAUDE.md`; the two are kept
> in sync. This file is a concise pointer; `CLAUDE.md` is the comprehensive
> reference. Do not duplicate content that already lives there.

---

## 1. Project Identity

Pulsy is a **self-hosted, open-source website uptime & downtime monitor** (AGPL-3.0-or-later).
It checks HTTP/DNS/TCP targets, receives cron heartbeats and Linux server health,
tracks up/down/degraded status, watches TLS cert expiry, groups
failures into incidents, sends notifications (email/webhook/Slack/Discord/Telegram),
and serves public status pages. Single-user accounts: every monitor is scoped to
its owning `userId`. Every capability is free and ungated: there is no billing code,
no payment provider, and no plan/tier/entitlement anywhere in the repo.

| Layer | Tech |
|-------|------|
| Frontend | React 19 + Vite + TanStack Router/Query + Tailwind + shadcn/ui + Recharts + i18next |
| Backend | Node + Express + tRPC + Drizzle ORM + `node-schedule` + better-auth |
| Datastore | PostgreSQL (Drizzle migrations in `packages/db`) |
| Containers | `pulsy-web` (3000), `pulsy-server` (4000), `pulsy-postgres` (5432) |

---

## 2. Critical Rules (Zero Tolerance)

These apply to **every** change. See `CLAUDE.md`'s Conventions section for the full list.

### 2.1 Everything is free and ungated
No plans, tiers, entitlements, quotas, or billing code. Never add a paywall or a
capability flag that unlocks a feature. Uniform technical abuse ceilings in
`lib/account-caps.ts` apply equally to every account and never unlock capability.

### 2.2 Scope every query by `ctx.user.id`
Monitor, incident, log, provider, channel, share link -- all `userId`-scoped. The complete `publicProcedure` whitelist is `uptimeMonitor.public.{status, statusPageBySlug, statusPageByDomain, sharedLink}`.
The separate public Express heartbeat ingress `/api/heartbeat/{token}/{start|success|fail}`
(or an event path with a Bearer token) is token-keyed, rate-limited, and returns
only an audited outcome and optional run ID. It precedes the general JSON parser,
accepts at most 10 KB without compression, and its URLs must never be logged.
Public Express agent metrics at `/api/agent/v1/metrics` require a Bearer token,
accept at most 48 KB of uncompressed JSON, and return only the audited outcome,
reporting interval, and filesystem exclusions. Versioned agent releases at
`/api/agent/releases/v1.0.0` serve an explicit file allowlist with immutable
caching. Both surfaces are rate-limited; neither adds public tRPC access.
Public Express `/api/status/pages/:key/{feed.rss,feed.atom,status.json,badge.svg,history.json}`
serves published page projections only (history also requires explicit enablement),
with CORS `*`, 240 requests per IP per minute, and uniform unavailable 404s.
Subscription POSTs at `/api/status/pages/:key/{subscribe,subscription}` share that
budget, validate the configured/verified page origin, accept at most 16 KB of
uncompressed JSON, and redeem capabilities only from the body. Email links use
`PUBLIC_WEB_URL`; subscriber addresses/tokens remain encrypted and never public.
These routes precede general CORS/auth/JSON parsing and add no public tRPC access.

### 2.3 Zod on every tRPC input
No raw SQL, no `as any` on input, no unvalidated payload.

### 2.4 Secrets encrypted at rest
AES-256-GCM via `ENCRYPTION_KEY`. Never logged, never returned unmasked.
Heartbeat tokens are exposed only by explicit owner create, rotate, or reveal
actions; polling projections omit both token hash and ciphertext.
Server-agent tokens are returned only by explicit owner create/rotate actions;
ordinary server and metric projections omit all credential fields.
Webhook signing keys use the OSS per-field scheme; browser-generated 64-character
lowercase hex keys enter create/rotate requests. Every channel server response
stays masked; rotation returns only `{rotated:true}`. No raw-secret exception.

### 2.5 UI stays restrained
`shadow-sm` max, no lift-on-hover, no decorative animation, no `rounded-2xl+`, no `transition-all`.

### 2.6 RTL + 5 locales (en/ar/fr/de/es)
Logical CSS props (`ms-`, `me-`, `text-start`); `dir="rtl"` for Arabic.

### 2.7 Docker-only development
Run build/test/lint/typecheck/migrate/seed commands through `make` or matching
containers; never Node, pnpm or Go on the host. Source containers have no bind
mounts: run `make start` before checks after edits. Generate migrations in Docker
and copy them out; regenerate the route tree through the web build stage only.

### 2.8 No destructive git without per-turn confirmation
`git push --force`, `git reset --hard`, branch deletes -- always ask first.

---

### 2.9 Egress policy
`MONITOR_ALLOW_PRIVATE_NETWORKS=true` is the OSS default for private/LAN targets.
Metadata/link-local stay blocked. Input validation, DNS pinning at connect and
redirect-hop checks are mandatory. `BLOCK_PRIVATE_TARGETS=true` is a deprecated
deny alias only when the new setting is absent; startup reports the policy.

## 3. Sources of Truth

| Concern | Authoritative File |
|---------|--------------------|
| Project overview, stack, layout, conventions | `CLAUDE.md` |
| System design, request flow, directory map | `ARCHITECTURE.md` |
| Schema + migrations | `packages/db/src/schema/*.ts`, `packages/db/drizzle/` |
| Env vars (single root `.env`) | `.env.example`, README "Configuration" |

---

## 4. Optional Tooling

This repo ships a `code-review-graph` MCP server for AST-based blast-radius /
semantic search (informational only -- verify against source before acting).
Make targets: `make graph-build`, `make graph-update`, `make graph-status`,
`make graph-changes`, `make graph-recheck`. After restructuring `apps/*` or
`packages/*`, run `make graph-recheck`. Don't commit `.code-review-graph/`.

---

## 5. Quick Reference

```bash
make start      # docker compose up (postgres + server + web)
make migrate    # run drizzle migrations
make seed       # demo user + example monitors
make logs       # tail all services
make stop       # docker compose down
make lint       # real ESLint + policy tests and typechecks
make translations-check # references, plurals, placeholders and gate regressions
make agent-check # pinned Go toolchain tests
make server-health-e2e # real installed-agent/browser acceptance
make graph-update  # refresh code-review-graph after edits
```
