# Architecture

This document describes Pulsy's current runtime and trust boundaries. The
source of truth is the code under `apps/` and `packages/`; setup and operator
instructions live in [README.md](README.md) and `docs/`. Contributor and agent
rules live in [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), and
[CLAUDE.md](CLAUDE.md).

Pulsy is an AGPL-3.0-or-later, self-hosted uptime monitor. It checks HTTP
targets, records availability and response time, groups failures into
incidents, checks TLS expiry, sends notifications, and serves public status
pages. Its core uptime ownership model is account-scoped: every monitor and
every user-managed uptime resource belongs to one `userId`.

## Runtime topology

```text
                         browser / API client
                                  |
                     http(s), same-origin /api/*
                                  |
                    +-------------v-------------+
                    | pulsy-web                  |
                    | unprivileged nginx + SPA   |
                    | host :3000 -> container    |
                    | :8080                      |
                    +-------------+-------------+
                                  |
                     proxy /api/* and /health
                                  |
                    +-------------v-------------+
                    | pulsy-server               |
                    | Express + tRPC + auth +    |
                    | in-process scheduler :4000 |
                    +-------------+-------------+
                                  |
                            postgres-js / Drizzle
                                  |
                    +-------------v-------------+
                    | pulsy-postgres :5432       |
                    | PostgreSQL 16              |
                    +---------------------------+
```

The browser normally reaches only the web container. nginx serves the built
SPA and proxies `/api/*` and `/health` to the server, keeping better-auth
cookies same-origin. The source Compose file binds the server and PostgreSQL
host ports to loopback for operator tooling; only the web port is publicly
bound by default.

The web application is a client-rendered React SPA. There is no SSR,
prerenderer, marketing site, or landing/legal route set. On the configured app
host, `/` sends authenticated users to the dashboard (or superadmin panel) and
guests to login. On another host, `/` can render a verified custom-domain
status page.

The server makes outbound connections to monitored HTTP(S) targets, TLS
endpoints, configured notification endpoints, SMTP/email-provider APIs, and DNS
resolvers for custom-domain verification. There is no payment provider and no
other third-party dependency.

### Express request order

Mount order in `apps/server/src/index.ts` is security-sensitive:

```text
Helmet + credentialed CORS
  -> /api/auth/*                         better-auth, strict IP limiter
  -> JSON parser (1 MB)
  -> /api/v1                             Bearer-key REST API, optional
  -> /api/trpc                           cookie/session tRPC, IP limiter
  -> /api/reports/sla/:monitorId.pdf     session + ownership
  -> /health
```

The REST API supplies its own non-credentialed CORS policy so external clients
can send `Authorization` from any origin. tRPC and auth remain on the
credentialed origin allowlist.

## Repository and package boundaries

Pulsy is a pnpm 11 workspace with two applications and one shared package.

| Path | Responsibility |
|---|---|
| `apps/web` | React 19 + Vite 7 SPA, TanStack Router/Query, tRPC client, Tailwind 4/shadcn UI, Recharts, and i18next. Imports only the server router type from `@pulsy/server/trpc`. |
| `apps/server` | Express 5 process containing better-auth, tRPC, `/api/v1`, scheduler, uptime services, notifications, reports, and superadmin operations. |
| `packages/db` | `@pulsy/db`: Drizzle schema, Zod input schemas, shared postgres-js pool, committed migrations, and migration scripts. Imported by the server. |
| `docker` | Source and prebuilt-image Compose files, server/web Dockerfiles, server entrypoint, and nginx configuration. |
| `ops/custom-domains` | Optional host-level nginx/certbot reconciliation service for verified custom status-page domains. It is outside the application containers. |
| `docs` | Self-hosting, REST API, custom-domain, SLA-report, and testing documentation. |
| `.github/workflows` | CI, CodeQL, secret scanning, and tagged GHCR/GitHub releases. |

Both apps are TypeScript ESM. Node 24 is used by `.nvmrc`, CI, and the Docker
images. The server runs TypeScript with `tsx`; the web app is built into static
assets and served by nginx. The SPA ships `en`, `ar`, `fr`, `de`, and `es`
locales; i18next updates the document language and enables RTL for Arabic.

Within the applications, dependencies flow inward:

```text
web routes -> components/hooks -> services -> typed tRPC client
server transports -> tRPC/API routers -> services -> @pulsy/db
scheduler ------------------------^              -> external targets/providers
```

Business operations shared by tRPC and REST live in server services. Database
ownership checks belong at the service/router boundary, not in the client.

## Authentication, authorization, and trust boundaries

### Browser sessions

better-auth provides email/password accounts and 72-hour database-backed
sessions at `/api/auth/*`. The SPA sends cookies with `credentials: include`.
`BETTER_AUTH_SECRET` is mandatory and has no fallback. Email verification is
configurable and does not gate self-hosted product capability.

`protectedProcedure` rejects requests without both a user and session.
`adminProcedure` adds a database re-read of the user's role and ban state on
every call; session fields are only a UI convenience. Cross-user queries are
permitted in request-time management paths only behind that explicit
superadmin gate.

All monitor, incident, history, provider, channel, share-link, status-page,
API-key, report, and organization management paths must bind their queries to
`ctx.user.id` (or first prove ownership of the parent resource). Organizations
never change monitor ownership: monitors remain `userId`-owned.

### Unauthenticated tRPC procedures

The complete `publicProcedure` whitelist is:

- `uptimeMonitor.public.status`
- `uptimeMonitor.public.statusPageBySlug`
- `uptimeMonitor.public.statusPageByDomain`
- `uptimeMonitor.public.sharedLink`

Every other tRPC procedure is protected or superadmin-only. Public procedures
accept Zod-validated identifiers/tokens and return hand-written projections,
never raw database rows. Status projections omit owner identity, target URL,
HTTP code, TLS details, notification configuration, and history outside the
limited incident summary. Share-link resolution exposes only cloneable monitor
configuration plus limited attribution.

### Other externally reachable surfaces

| Surface | Authentication and boundary |
|---|---|
| `/api/v1/*` | Pulsy Bearer API key, never a session cookie. Plaintext keys are shown once; only a SHA-256 hash and display prefix are stored. Every route is key-owner scoped. |
| `/api/reports/sla/:monitorId.pdf` | Resolves the better-auth session again and rechecks ownership before streaming. |
| `/health` | Unauthenticated liveness JSON; contains no application data. |
| Public status and share pages | Render only the sanitized tRPC procedures listed above; mutations such as clone require a session. |

Every tRPC input and REST body/query is validated with Zod. Express applies a
1 MB body limit. Per-IP fixed-window limits protect auth and tRPC; the REST API
adds a per-key in-memory limit. These limiters are process-local, consistent
with Pulsy's single-server runtime assumption.

User-managed email-provider credentials, notification targets, and custom
notification-header values are encrypted at rest with AES-256-GCM using
`ENCRYPTION_KEY`; decrypted secrets are never sent to the browser. Delivery
audit rows reduce webhook and Telegram destinations to non-secret labels. API
keys and share tokens use cryptographically random values and are never
logged.

Outbound monitor, TLS, and webhook requests can be protected by
`BLOCK_PRIVATE_TARGETS=true`. The guard resolves every host, blocks private,
loopback, link-local, metadata, CGNAT, unique-local, and reserved addresses,
and revalidates redirect hops. It is off by default so self-hosters can monitor
internal services; operators who allow untrusted signup should enable it.

## Web routes and public product surfaces

The generated TanStack route tree contains product and authentication routes,
not a marketing site:

| Route | Purpose |
|---|---|
| `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password` | Application entry and account recovery. |
| `/dashboard`, `/dashboard/uptime/:monitorId` | Authenticated monitor management and detail views. |
| `/dashboard/api-keys`, `/dashboard/api-docs` | Authenticated REST-key management and API documentation. |
| `/superadmin` | Operator-only administration. |
| `/status/:userId` | Legacy/default public status page. |
| `/status/:userId/:slug` | Published named status page. |
| `/share/:token` | Share recipient flow; unauthenticated recipients are redirected through signup/login with the token preserved. |

### Status pages

Status pages are first-class `uptime_status_page` records linked to selected
monitors through `uptime_status_page_monitor`. Page membership, not a raw
monitor row, controls what renders. Named pages must be published. A custom
domain must be both DNS-verified and published before public resolution.

The SPA compares the browser host with build-time `VITE_APP_URL`. A different
host is resolved through `statusPageByDomain` and rendered at `/`. Ownership is
proved with a TXT record at `_pulsy-verify.<domain>`. The application records
the verification/provisioning state; the optional host daemon in
`ops/custom-domains` writes nginx vhosts and obtains certificates. The
application itself does not run ACME.

Public responses contain page display metadata, a sanitized monitor health
summary, overall state, and a bounded recent-incident summary. They do not
expose target URLs or account/private configuration.

### Monitor sharing

A share link snapshots a set of monitor IDs under an expiring random token.
Public resolution rechecks that the link is live and returns only cloneable
fields. An authenticated recipient selects monitors to clone; clones are new,
private, pending records under the recipient's `userId`, with no history,
incidents, channels, or provider credentials copied.

### REST API

`API_V1_ENABLED` controls `/api/v1` and defaults to enabled. The surface offers
owner-scoped monitor list/detail/create/update/delete, check history,
incidents, statistics, and manual checks. Read operations require effective
`limited` API access; writes require `full`. In default self-hosted mode every
user receives full access. `docs/api/openapi.yaml` is the contract reference.

## Server routers and services

The tRPC root router is grouped by domain:

- `uptimeMonitor`: monitor CRUD/bulk actions, checks, stats, incidents,
  providers, channels, delivery logs, shares, status pages, SLA reports, and
  the public projections.
- `config`: instance policy needed by the SPA.
- `organization`: optional account grouping and team membership.
- `apiKey`: key creation, listing, and revocation.
- `admin`: superadmin stats and user administration.

The services layer contains the reusable monitor, check, incident,
notification, report, and API-key logic. This keeps tRPC and REST behavior
aligned.

## Scheduler, checks, incidents, and notifications

`node-schedule` runs inside the single server process. At startup it loads all
active monitors and creates one cron-like job per interval. Three guards bound
work: a per-monitor re-entry set skips overlapping ticks, a global semaphore
uses `CHECK_CONCURRENCY` (default 20), and an in-flight registry lets graceful
shutdown drain current checks.

```text
scheduled/manual check
  -> HTTP probe with timeout and expected-status comparison
  -> apply failure-threshold transition
  -> one PostgreSQL transaction:
       check log
       + current monitor state
       + optional status-change row
       + incident open/resolve
  -> commit
  -> detached notification dispatch for recorded transitions
  -> for scheduled HTTPS checks only: certificate probe when its 24-hour
     window is due
```

Network probes happen before the transaction and notification delivery happens
after commit, so pooled connections are not held during external I/O. The
transaction prevents a monitor state change from being committed without its
history/incident transition.

Notifications can target email, generic webhook, Slack, Discord, or Telegram.
Monitor-specific channels are merged with account-level defaults, with target
deduplication. Email can use user-configured Resend, SendGrid, or SMTP
credentials. Transient network, 429, and 5xx failures retry according to
`NOTIFICATION_RETRY_DELAYS_MS`; a final `sent` or `failed` audit row records the
target-safe label, attempts, error, and provider message ID.

Notification retries are detached and in-memory, not a durable queue. A server
restart can lose an outstanding retry; `uptime_notification_log` contains only
dispatches that reached a final outcome and is not replayed. TLS certificates
are checked at most once per monitor per 24 hours in process memory, and
eligible channels can emit threshold-based expiry alerts.

Other scheduled jobs are:

- daily 03:00 cleanup of old check logs, status changes, resolved incidents,
  and notification logs in bounded batches;
- monthly 06:00 on day 1 generation and email of prior-month SLA PDFs for
  active SLA-report subscriptions.

Check-log retention follows `CHECK_LOG_RETENTION_DAYS`. The process handles
SIGTERM/SIGINT by stopping HTTP, cancelling scheduled jobs, draining checks,
and closing the shared database pool.

There is no distributed scheduler or leader election. Running multiple server
replicas would duplicate checks, incidents, and notifications; horizontal
server scaling first requires a PostgreSQL advisory-lock leader or an external
job system. The REST and IP rate-limit stores would also need shared storage.

## Database model

Schema declarations and relations live in `packages/db/src/schema/`.

| Group | Tables and role |
|---|---|
| Auth | `user`, `session`, `account`, `verification`: better-auth identities, password accounts, sessions, verification tokens, plus Pulsy role/ban fields. |
| Monitoring | `uptime_monitor`, `uptime_check_log`, `uptime_status_change`, `uptime_incident`: configuration/current state, granular checks, transition history, and grouped outages. |
| Notifications and reports | `uptime_email_provider`, `uptime_notification_channel`, `uptime_notification_log`, `uptime_sla_report_subscription`: encrypted senders, monitor/default destinations, delivery audit, and monthly report delivery. |
| Publishing and sharing | `uptime_status_page`, `uptime_status_page_monitor`, `uptime_share_link`: named published pages, ordered monitor membership, custom-domain state, and expiring clone links. |
| API | `api_key`: hashed Bearer keys with display prefixes. |
| Organizations | `organization`, `organization_member`: optional account grouping and membership roles. |

User-owned root records carry `userId`; dependent history generally inherits
ownership through its monitor foreign key. User and monitor deletion cascades
through owned data where appropriate. Provider/channel references that must
preserve audit or configuration use `SET NULL`. Ownership-sensitive indexes
lead with the user or parent identifier, and public lookup keys are uniquely
constrained.

Notification-provider credentials, channel targets, and custom header values
are ciphertext. API-key plaintext is never stored. Share tokens are
high-entropy server-generated values. Public output types are deliberately
separate from selected row types.

The server, scheduler, auth adapter, and reports share one postgres-js pool,
bounded by `DATABASE_POOL_MAX` (default 20).

## Pricing, plans, and tiers

There are none. Pulsy is free and fully featured for every user: no billing
code, no payment provider, no entitlement resolver, no plan gates, and no
feature flags that unlock capability. Organizations are optional account
grouping only — they do not create a second monitor tenant key, and uptime
resources remain owned by individual `userId` values.

## Environment and configuration

The repository uses one root `.env`; `.env.example` is the authoritative
inventory and contains safe defaults/placeholders rather than deployment
secrets. The server reads `process.env` directly, while Compose injects the
file. Vite variables are public build-time values and must never contain
secrets.

| Category | Principal variables |
|---|---|
| Required datastore/security | `DATABASE_URL`, `POSTGRES_PASSWORD`, `ENCRYPTION_KEY`, `BETTER_AUTH_SECRET` |
| Origins and ports | `PUBLIC_WEB_URL`, `PUBLIC_SERVER_URL`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `WEB_PORT`, `SERVER_PORT`, `POSTGRES_PORT` |
| Public web build | `VITE_SERVER_URL`, `VITE_APP_URL`, `VITE_SOURCE_CODE_URL`, `VITE_DEMO_NOTICE`, optional `VITE_GA_MEASUREMENT_ID` |
| Instance policy | `DISABLE_SIGNUP`, `REQUIRE_EMAIL_VERIFICATION`, `BLOCK_PRIVATE_TARGETS`, auth/tRPC rate limits |
| Scheduler/storage | `CHECK_LOG_RETENTION_DAYS`, `CLEANUP_BATCH_SIZE`, `CHECK_CONCURRENCY`, `DATABASE_POOL_MAX`, `NOTIFICATION_RETRY_DELAYS_MS` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| REST | `API_V1_ENABLED`, `API_RATE_LIMIT_PER_MIN` |
| Custom domains | `CUSTOM_DOMAIN_CNAME_TARGET`, `CUSTOM_DOMAIN_IP`, `DNS_RESOLVERS`, `CERTBOT_EMAIL`, `CERTBOT_STAGING`, `ACME_WEBROOT` |
| Optional operator | `SUPERADMIN_*` |

Startup rejects a missing or placeholder `BETTER_AUTH_SECRET`; secret
encryption rejects a missing, placeholder, or trivially short
`ENCRYPTION_KEY`. Compose requires `POSTGRES_PASSWORD` rather than falling back
to a public default. `VITE_*` values are baked into the web image and cannot be
changed on a prebuilt image without rebuilding it.

After committed schema migrations run in the server entrypoint, application
startup atomically encrypts version-0 notification-channel targets and custom
header values before binding the HTTP listener. Version-0 reads remain
temporarily compatible for safe rollout, but new writes always use the current
ciphertext version.

## Schema migrations

Drizzle TypeScript schemas are the model source of truth; committed SQL lives
in `packages/db/drizzle/`. `packages/db/scripts/migrate.mjs` applies those
migrations through the Drizzle ORM migrator and its journal, so it is safe on
every boot and works in the production image without `drizzle-kit`.

The server entrypoint defaults to `PULSY_SCHEMA_MODE=migrate`, applies
migrations, optionally starts the idempotent superadmin seed in the background,
and then starts Express. `PULSY_SCHEMA_MODE=push` is a temporary source/dev
compatibility path for installations created before committed migrations; it
is not the normal production strategy.

Contributor commands are Docker-first:

```bash
make migrate     # apply committed migrations
make generate    # generate a new migration from schema changes
make db-push     # development/legacy only
```

Schema changes require both the TypeScript declaration and a committed
migration. The generated migration should be reviewed before it is applied.

## Containers, CI, releases, and tests

`docker/docker-compose.yml` builds three services:

- `pulsy-postgres`: PostgreSQL 16 with a persistent `pulsy_pgdata` volume and
  `pg_isready` health check;
- `pulsy-server`: Node 24 dev image for Docker-first local checks, dependent on
  healthy PostgreSQL, with a fetch-based health check;
- `pulsy-web`: Vite build served by non-root nginx on container port 8080,
  dependent on the healthy server.

`Dockerfile.server` also has a lean `prod` target used by CI/releases; it keeps
runtime dependencies and migrations but removes test suites/tooling. The web
Dockerfile builds the SPA, runs its typecheck and tests, and copies only `dist`
into the nginx image. `docker-compose.ghcr.yml` runs released multi-architecture
images; build-time `VITE_*` customization requires building from source.

The contributor workflow remains Docker-only:

```bash
make start
make migrate
make typecheck
make test
make stop
```

Vitest covers all three workspaces. Web tests run in jsdom. Server and database
integration suites use a real isolated PostgreSQL database: they reuse an
explicitly test-named URL, create a disposable sibling test database, or start
PostgreSQL through Testcontainers. Provider and webhook transports are mocked
for deterministic tests. Coverage configuration enforces 100% on its selected
logic scope when coverage is collected; ordinary test runs do not collect it.

GitHub Actions performs a production-dependency audit, workspace typechecks and
tests, a web build, and independent server/web Docker builds. Separate workflows
run CodeQL and gitleaks. Version tags publish amd64/arm64 GHCR images with SBOM
and provenance and create a GitHub release with generated notes.
