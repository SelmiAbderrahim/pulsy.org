# Claude Code Configuration — Pulsy

## What Pulsy Is

Pulsy is a **self-hosted, open-source website uptime & downtime monitor**. It periodically checks
HTTP (GET/HEAD/POST), DNS/TCP targets, cron heartbeats and Linux server health;
it tracks up/down/degraded status, watches TLS certificate expiry, groups
failures into incidents, sends notifications (email/webhook/Slack/Discord/Telegram), and serves
public status pages. Single-user accounts: every monitor is scoped to its owning `userId`.

It was cloned from one feature of a larger SaaS and rebuilt as an independent project. There is **no
multi-tenancy**, and every build is **fully featured and free**: no plans, tiers, quotas,
entitlements, or billing code exist anywhere in the repo, and the app contacts no payment
provider.

License: **AGPL-3.0-or-later**.

## Stack

| Layer | Tech |
|---|---|
| `apps/web` | React 19 + Vite + TanStack Router + TanStack Query + Tailwind + shadcn/ui + Recharts + i18next |
| `apps/server` | Node + Express + `@trpc/server` + Drizzle ORM + `node-schedule` + better-auth |
| `packages/db` | Drizzle schema (uptime + auth tables, `userId`-scoped) + drizzle-kit migrations + db client |
| Datastore | PostgreSQL |
| Auth | better-auth (email/password + sessions only) |

## Monorepo Layout

```
apps/web/      React SPA — talks to the server via a typed tRPC client (credentials: include)
apps/server/   tRPC API + better-auth handler (/api/auth/[...all]) + node-schedule scheduler
packages/db/   @pulsy/db — schema, migrations, drizzle client (db.query.*)
docker/        Dockerfiles + docker-compose.yml (postgres, server, web)
docs/          user + self-hosting docs, API reference, design notes
```

The **server** owns the API, the scheduler, and auth. The **web** app is a pure SPA.

## Ports (defaults)

| Service | Port | Container name |
|---|---|---|
| web | 3000 | `pulsy-web` |
| server | 4000 | `pulsy-server` |
| postgres | 5432 | `pulsy-postgres` |

## Development (Docker-first)

```bash
cp .env.example .env      # then fill ENCRYPTION_KEY + BETTER_AUTH_SECRET
make start                # docker compose up (postgres + server + web)
make migrate              # run drizzle migrations
make seed                 # demo user + example monitors
make logs                 # tail all services
make stop                 # docker compose down
```

Package-level pnpm scripts are kept for CI and maintainers working inside the
matching container. Contributor setup and runtime validation are Docker-first.

## Conventions

- **UI stays restrained** — no card lift, no decorative animation, `shadow-sm` max.
- **RTL + i18n** — logical CSS props (`ms-`/`me-`/`text-start`); `dir="rtl"` for Arabic; backend
  error messages localized via `ctx.t`.
- Monitor-detail tabs persist in the URL. Never size `Switch` with `min-h`/`min-w`.
- Tabbed detail views, service-layer + query-key-factory conventions, and contextual docs links on
  detail pages — follow the existing patterns already in `apps/web/src/components/uptime/` and
  `apps/server/src/services/uptime/` rather than inventing new ones.
- Monitor-list bulk actions reuse the existing bulk-selection hook
  (`apps/web/src/hooks/useBulkSelection.ts`).
- Share links (token generation, public-resolve sanitization, clone semantics, the `?share=`
  auth-redirect flow) follow the existing patterns in the uptime-monitor service layer.
- Notification emails: no raw IPs/ports in links, SPF/DKIM/DMARC on the sending domain, build
  links from `PUBLIC_WEB_URL`.
- Never run destructive git (force-push, `reset --hard`, branch deletes) without explicit
  per-turn confirmation.
- **Docker-only execution** (strict) — all build/test/lint/typecheck/migrate/seed/run via `make`
  or `docker compose exec pulsy-*`, never the host.
- Source containers have no bind mounts: rebuild with `make start` before checks.
  Generate migrations in Docker and copy them out; regenerate the router tree only
  through the web build stage. Never run Node, pnpm or Go on the host.
- Shared UI controls, canonical monitor tabs, account timezone and the five locale
  namespaces stay consistent. Keep pre-paint scripts external under the strict CSP.
- Required quality gates include real ESLint, translation integrity, agent checks
  and installed-agent acceptance; see `docs/TESTING.md` and the Makefile.
- Single root `.env` for all env vars.

## Hard Rules

- **Capability is never gated** — no plans, tiers, entitlements, quotas, or paywalls. Never
  add billing code or a flag that unlocks a feature. Uniform technical abuse
  ceilings in `lib/account-caps.ts` never depend on account capability.
- Scope every monitor/incident/log/provider/channel/share-link query by `ctx.user.id`.
- Secrets (email-provider credentials, etc.) are encrypted at rest (AES-256-GCM via
  `ENCRYPTION_KEY`) — never logged, never returned unmasked, no fallback/default key values, and
  any comparison against a stored secret uses a timing-safe compare.
- Every tRPC input validated with Zod. `protectedProcedure` for all data access. The complete `publicProcedure` whitelist is `uptimeMonitor.public.{status, statusPageBySlug, statusPageByDomain, sharedLink}` — each is keyed to a specific page/token and returns a hand-audited field list, never a raw row.
- The separate public Express heartbeat ingress `/api/heartbeat/{token}/{start|success|fail}`
  (or an event path with a Bearer token) is token-keyed and rate-limited. Its audited
  response contains only an outcome and optional run ID. Mount it before the general
  JSON parser; accept at most 10 KB without compression and never log its URLs.
- Heartbeat tokens may be exposed only by explicit owner create, rotate, or reveal
  actions. Polling projections omit token hashes, ciphertext, and admission counters.
- Public Express `/api/agent/v1/metrics` requires an agent Bearer token and accepts
  at most 48 KB of uncompressed JSON before the general parser. Its audited
  response permits only outcome, interval, and filesystem exclusions. The public
  `/api/agent/releases/v1.0.0` surface serves an explicit artifact allowlist with
  immutable caching. Both are rate-limited and add no public tRPC procedures.
- Public Express `/api/status/pages/:key/{feed.rss,feed.atom,status.json,badge.svg,history.json}`
  returns only audited published page projections; history requires explicit enablement.
  CORS is `*`, the shared budget is 240 requests/IP/minute, and missing/draft pages
  return uniform unavailable 404s. Subscription POSTs at
  `/api/status/pages/:key/{subscribe,subscription}` share the budget, require the
  configured or verified page origin, accept at most 16 KB of uncompressed JSON,
  and redeem capabilities only from the body. Mail links use `PUBLIC_WEB_URL`;
  subscriber addresses/tokens stay encrypted and never public. Mount these before
  general CORS/auth/JSON parsing. No public tRPC procedures are added.
- Server-agent tokens may be returned only by explicit owner create/rotate actions;
  ordinary server and metric projections omit all credential fields.
- Webhook signing keys use the OSS per-field encryption scheme. Browser-generated
  64-character lowercase hex keys enter create/rotate requests; every channel
  server response stays masked, and rotation returns only `{rotated:true}`.
  Never port an envelope format or add a raw-secret response exception.
- Notification channel types are email, webhook, Slack, Discord and Telegram.
  Provider/diagnostic output is sanitized; notification links use `PUBLIC_WEB_URL`.
- Egress permits private/LAN targets by default through
  `MONITOR_ALLOW_PRIVATE_NETWORKS=true`; metadata/link-local remain blocked.
  Validate inputs, pin DNS at connect and re-check every redirect. The old
  `BLOCK_PRIVATE_TARGETS=true` alias means deny only when the new setting is absent.
- 5 locales (en, ar, fr, de, es) + full RTL.
- Conventional commits. Pinned deps from public npm only.
