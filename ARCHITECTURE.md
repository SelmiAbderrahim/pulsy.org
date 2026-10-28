# Architecture

This document describes Pulsy's current runtime and trust boundaries. The
source of truth is the code under `apps/` and `packages/`; setup and operator
instructions live in [README.md](README.md) and `docs/`. Contributor and agent
rules live in [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), and
[CLAUDE.md](CLAUDE.md).

Pulsy is an AGPL-3.0-or-later, self-hosted uptime monitor. It checks HTTP, DNS and TCP targets, receives cron heartbeats and Linux
server-health reports, records availability and response time, groups failures
into incidents, checks TLS expiry, sends notifications, and serves public status
pages with announcements, history and email subscriptions. Its core uptime ownership model is account-scoped: every monitor and
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

The web application is a client-rendered React SPA with authenticated product
routes, account recovery, Help, public status pages and monitor sharing. On the configured app
host, `/` sends authenticated users to the dashboard (or superadmin panel) and
guests to login. On another host, `/` can render a verified custom-domain
status page.

The server makes outbound connections to configured HTTP/TLS and DNS/TCP
targets, notification endpoints, SMTP/email-provider APIs and DNS resolvers.
Agent installers fetch versioned artifacts from the configured Pulsy origin;
fonts and product guides are bundled in the web image.

### Express request order

Mount order in `apps/server/src/index.ts` is security-sensitive:

```text
Helmet
  -> /api/status                        published feeds + body-only subscription capabilities
  -> /api/v1 (when enabled)              own CORS, Bearer auth, rate limit, bounded JSON
  -> credentialed CORS + origin-denied JSON handler
  -> /api/auth/*                        better-auth, strict IP limiter; no body parser
  -> /api/heartbeat                     token ingress, 10 KB raw parser, no compression
  -> /api/agent/v1                       agent Bearer ingress, 48 KB JSON, no compression
  -> /api/agent/releases/v1.0.0          immutable artifact allowlist
  -> JSON parser (100 KB default; 1 MB on selected protected UI transports)
     + structured parser-error handler
  -> /api/trpc                          cookie/session tRPC, IP limiter
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
| `apps/web` | React 19 + Vite 7 SPA, TanStack Router/Query, tRPC client, Tailwind 4/shadcn UI, Recharts, and i18next. Imports the server router type from `@pulsy/server/trpc` and browser-safe validation/formatting subpaths from `@pulsy/db`; never bundles the database client. |
| `apps/server` | Express 5 process containing better-auth, tRPC, `/api/v1`, scheduler, uptime services, notifications, reports, and superadmin operations. |
| `packages/db` | `@pulsy/db`: Drizzle schema, Zod 4 validation, pure shared modules, postgres-js pool, committed migrations and migration scripts. Explicit pure subpath exports are available to the web app. |
| `agent` | Dependency-free Go Linux health agent, installer, protocol, systemd/Compose integration and checks. |
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
HTTP code, TLS details, notification configuration, and private history. Explicitly
enabled compact history uses a separate seven-completed-UTC-day projection. Share-link resolution exposes only cloneable monitor
configuration plus limited attribution.

### Other externally reachable surfaces

| Surface | Authentication and boundary |
|---|---|
| `/api/v1/*` | Pulsy Bearer API key, never a session cookie. Plaintext keys are shown once; only a SHA-256 hash and display prefix are stored. Every route is key-owner scoped; `read` keys read, `full` keys read and write. Expired, revoked, removed and banned-owner credentials are rejected. |
| `/api/reports/sla/:monitorId.pdf` | Resolves the better-auth session again and rechecks ownership before streaming. |
| `/health` | Unauthenticated liveness JSON; contains no application data. |
| `/api/heartbeat/:token/:event` or `/api/heartbeat/:event` | Random 43-character token in the path or exact Bearer header; `event` is `start`, `success`, or `fail`. GET, HEAD, and POST only; bounded 10 KB raw body before the general parser, no compression. Uniform unavailable 404; explicit outcome and optional run ID only. |
| `/api/agent/v1/metrics` | POST with an exact 43-character agent Bearer token; strict 48 KB JSON before the general parser, no compression. Audited response permits only outcome, reporting interval, and filesystem exclusions; unknown credentials yield the same unavailable 401. |
| `/api/agent/releases/v1.0.0/*` | Public version-keyed allowlist of installer, Compose definition, checksums, and Linux amd64/arm64 binaries; GET/HEAD only, immutable one-year caching, 240 requests per IP per minute. |
| `/api/status/pages/:key/{feed.rss,feed.atom,status.json,badge.svg,history.json}` | Published page key, hand-audited display/health/announcement projections; history requires explicit opt-in. CORS `*`, no-store, shared 240 requests/IP/minute, bounded 16 concurrent projections, uniform unavailable 404. |
| `/api/status/pages/:key/{subscribe,subscription}` | POST/OPTIONS with exact configured or verified page origin, shared IP budget, 16 KB uncompressed JSON, bounded 16 active requests. Confirm/unsubscribe capabilities only in the JSON body, neutral accepted outcomes, no address/token disclosure. |
| Public status and share pages | Render only the sanitized tRPC procedures listed above; mutations such as clone require a session. |

Every tRPC input and REST body/query is validated with Zod. Ordinary JSON uses
Express's 100 KB default; selected authenticated UI operations and REST
configuration have a 1 MB bound. API-key CORS/auth/rate checks precede its own
parser and terminal JSON 404; it never falls through into cookie CORS. Per-IP fixed-window limits protect auth and tRPC; the REST API
adds a per-key in-memory limit. These limiters are process-local. The default deployment uses one server;
additional API replicas need a shared limiter if an installation requires the
same aggregate budget across replicas. `TRUST_PROXY_HOPS` defaults to one and
must match the trusted proxy chain; IPv6 source buckets use /64 groups.

Heartbeat ingress additionally bounds requests to 1,200 per IP per minute
(IPv6 /64 groups, at most 1,024 buckets, rejecting new sources at capacity),
12,000 globally per process per minute, and 16 in-flight receipt transactions.
Each token admits at most 120 receipts per minute. Receipt fields use a strict
Zod schema and cannot contain the token. Nginx suppresses access and error logs
for heartbeat URLs. No public tRPC procedure is added.

Heartbeat configuration, token rotation/reveal, and bounded run history use
owner-scoped protected procedures. Tokens have SHA-256 lookup hashes and
AES-256-GCM recovery ciphertext. Explicit owner actions may reveal a token;
ordinary monitor and heartbeat reads omit credentials and admission counters.
Transactions lock the parent monitor before heartbeat state. Durable run IDs
make repeated starts and terminal receipts idempotent; superseded and pruned
runs cannot recover a newer failure.

The scheduler leader evaluates persisted heartbeat deadlines every five seconds
in bounded batches with owned row locks and `SKIP LOCKED`. Pending has no health
sample before its first due time. Late begins at `expectedAt`; Down and its
incident begin at `expectedAt + graceSeconds`, even when a scan runs later.
Only an actual success receipt restores health; edits and resumes preserve an
outage. Resume gives a previously pending/healthy heartbeat a fresh interval.
Worker shutdown cancels the job and drains an active scan before releasing
leadership or closing the database.

Server health uses `uptime_server` for encrypted agent credentials, thresholds,
filesystem exclusions, reporting state, and bounded condition streaks. Accepted
samples enter owner-scoped `uptime_server_metric`; CPU, memory, swap, load,
uptime, and filesystem utilization are validated against a bounded versioned
schema. Identity metadata is limited to agent version/architecture, boot ID,
and sequence; samples contain no hostname, IP address, or process list.
Receive-time ordering, sampled time, boot ID, sequence, and per-token admission
guards reject stale or repeated reports without rewinding measured state.
Metric reads and daily cleanup use `CHECK_LOG_RETENTION_DAYS` with a 30-day
fallback; no account-dependent interval or retention values are applied.

Metrics ingress has the same 1,200/IP/minute, 1,024-bucket, 12,000/global/minute,
and 16-in-flight bounds as heartbeat ingress, plus 12 attempts per token per
minute and the configured reporting cadence. Threshold pressure requires three
violations and two healthy observations to clear; absent values reset streaks
without clearing an active condition. The leader's five-second worker marks a
reporting server Down after three missed reporting intervals. Two accepted
reports recover missing-agent state. Samples, monitor state, and incidents are
written together; localized notifications are dispatched after commit.

The dependency-free Go agent module targets Go 1.26 and produces version 1.0.0
Linux amd64/arm64 binaries and checksums. A pinned build-platform toolchain puts
these exact artifacts into both server images, readable by the non-root Node
user. Install commands derive their origin from `PUBLIC_WEB_URL`; installers
verify downloads and support systemd and Compose. Agent production containers
run without root. Installer/systemd and Compose acceptance fixtures are isolated
Docker resources.

User-managed email-provider credentials, notification targets, and custom
notification-header values are encrypted at rest with AES-256-GCM using
`ENCRYPTION_KEY`; decrypted secrets are never sent to the browser. Delivery
audit rows reduce webhook and Telegram destinations to non-secret labels. API
keys and share tokens use cryptographically random values and are never
logged.

### Outbound network policy

`lib/ssrf.ts` owns the policy for HTTP/TLS, DNS/TCP, notification destinations
and outbound sockets. OSS defaults to `MONITOR_ALLOW_PRIVATE_NETWORKS=true`
so private/LAN monitoring works. Metadata and link-local destinations stay
blocked in every mode. Set the value to `false` to reject private, loopback,
CGNAT and unique-local destinations as well. The deprecated
`BLOCK_PRIVATE_TARGETS=true` alias means deny private targets only when the new
setting is absent. Startup reports the effective policy and warns when LAN
access is allowed.

Create, update and import validate destinations before storage. DNS lookup at
connect pins the validated address to the actual HTTP/TLS/TCP socket; each
redirect hop is checked again. HTTP request policy also constrains forwarding
credentials and POST bodies across origins. `make audit-private-targets` is a
read-only inventory against the strict public-target policy. See
[the operator guide](docs/self-hosting/ssrf.md).

## Web routes and public product surfaces

The generated TanStack route tree serves these product and authentication routes:

| Route | Purpose |
|---|---|
| `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password` | Application entry and account recovery. |
| `/dashboard`, `/dashboard/uptime/:monitorId` | Authenticated monitor management and detail views. |
| `/dashboard/incidents` | Owned incident workspace, acknowledgement, notes, grouping and escalation. |
| `/dashboard/status-pages/:pageId?tab=…` | Status-page editor, membership, publication, communication and subscription settings. |
| `/dashboard/import-export` | Manifest export, preview and reconciliation; `/dashboard/configuration` redirects here. |
| `/dashboard/api-keys`, `/dashboard/api-docs` | Authenticated REST-key management and API documentation. |
| `/dashboard/help`, `/dashboard/help/:topic` | Localized, bundled product guides. |
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
incidents, statistics, and manual checks. Reads require a `read` or `full` key; writes require `full`. Scopes are chosen
by the owner, with optional UTC expiry, revocation and removal. Existing keys
retain full access through the migration default. Banned owners are rejected
independently of key state. The API also exposes reliability, annotations,
configuration export/preview/apply and authenticated Prometheus metrics.
`docs/api/openapi.yaml`, served at `/openapi.yaml`, is the contract reference.

## Server routers and services

The tRPC root router is grouped by domain:

- `uptimeMonitor`: monitor CRUD/bulk actions, checks, stats, incidents,
  providers, channels, delivery logs, shares, status pages, SLA reports, and
  the public projections.
- `config`: instance policy and the account reporting timezone used by the SPA.
- `organization`: optional account grouping and team membership.
- `apiKey`: scoped key creation, listing, expiry, revocation and removal.
- `admin`: superadmin stats and user administration.

The services layer contains the reusable monitor, check, incident,
notification, report, and API-key logic. This keeps tRPC and REST behavior
aligned.

## Scheduler, checks, incidents, and notifications

### Leadership and scheduling

`node-schedule` lives in each server process, but a dedicated PostgreSQL
connection elects one scheduler through a session advisory lock. The winner
starts monitor schedules, heartbeat/server deadline scans, maintenance/deferred
alerts, incident escalations, status-subscription delivery and retention,
daily cleanup and monthly reports. Standbys serve API requests. Leadership
is retried every ten seconds; the leader reconciles persisted monitor changes
every thirty seconds. Losing leadership cancels scheduled work and drains
workers. Shutdown stops leadership before closing the database.

A per-monitor re-entry guard, `CHECK_CONCURRENCY` (default 20) and an in-flight
registry bound probe work. Create, resume and target-changing edits set a
persisted `nextCheckAt` for a prompt first observation; bulk creation spreads
first checks over up to five seconds. Heartbeat and server monitors are
receipt-driven rather than HTTP cron jobs. Owner-row locks serialize creation
and shared technical ceilings without limiting monitor count.

### Health writes and diagnostics

```text
scheduled/manual HTTP, DNS or TCP probe
  -> egress-safe connection, timeout, status/assertion evaluation
  -> failure threshold + latency/degraded hysteresis
  -> one transaction under the owned monitor lock:
       captured observation + check log + reliability cursor/day contributions
       + current monitor state + optional status change
       + incident open/resolve + response timeline/delivery state
  -> commit
  -> notification dispatch
  -> scheduled HTTPS certificate probe when its window is due and enabled
```

External network I/O happens outside the health transaction. HTTP configuration
supports expected-status rules, redirect policy, encrypted request credentials,
header/body assertions and an independent TLS-monitoring toggle. Testing a
configuration is protected, validates egress and requires explicit consent for
POST. DNS compares the normalized expected answer set; TCP uses pinned outbound
sockets. Slow successful observations can produce degraded health with separate
slow/recovery counters and `notifyOnDegraded` delivery preferences.

`@pulsy/db/check-error` defines stable DNS, connection, timeout, TLS, redirect,
blocked-target, assertion and heartbeat failure codes. Classified failures are
stored as codes and localized at presentation, including old-message mappings.
Provider-controlled text and request credentials never become diagnostic output;
`safe-error.ts` and tRPC validation formatting return sanitized, localized errors.

### Reliability and daily aggregates

`insertObservedCheck` stores each captured observation, closes the previous
observation, advances its cursor and updates UTC daily duration buckets inside
the existing monitor transaction. Policy versions and applicable maintenance
ranges are captured with the observation. Bounded observation horizons prevent
missing time from becoming invented availability; obsolete samples do not move
the cursor backwards. Reliability windows combine compact complete days with
retained boundary observations and the current cursor, tracking raw and
maintenance-adjusted duration, latency objectives, degraded time and coverage.
Annotations remain owner-only; public history excludes private annotations.

`uptime_check_day` is a separate daily check-count statistics path.
The `pulsy_check_day_changed` transition-table trigger keeps daily status counts
correct for inserts, updates, deletes and truncation. Its initial backfill locks
check history. `checkLog.daily` and account aggregates use these compact counts.
Cleanup prunes granular checks, server metrics and reliability history according
to `CHECK_LOG_RETENTION_DAYS`; no account-derived retention value exists.

### Incident response and notification delivery

A partial unique index allows one ongoing incident per monitor. Incident
response state adds acknowledgement, severity, notes, runbooks, grouping and a
bounded timeline. One or two ordered escalation steps bind only owned channels;
leased delivery rows and stable source IDs support restart-safe progress.
Text redaction prevents request credentials from entering workspace events.

Maintenance windows and snoozes suppress alerts while observations continue.
Deferred alerts retain expected/notified timing and an encrypted-credential-free
snapshot, then re-evaluate current ownership, suppression, condition and recovery
before delivery. Cooldowns and recoveries preserve the operational outage identity.

Notifications target email, webhook, Slack, Discord or Telegram. Monitor channels
merge with account defaults with destination deduplication. Resend, SendGrid and
SMTP credentials, targets and custom header values use the OSS per-field
AES-256-GCM/`secretVersion` scheme. Webhook signing secrets have their own encrypted
field. The browser generates the one-time 32-byte secret locally for create or
rotate and sends its 64-character lowercase hex representation for encryption;
all channel HTTP responses stay masked. Rotation returns only `{rotated:true}`.
Legacy clients may omit a create secret; the server generates an encrypted key
without disclosing it, and the owner can rotate to a known key later.

Webhook contract v1 sends versioned health/test events, a stable per-channel/event
UUID, reason codes and applicable incident/recovery fields. HMAC-SHA256 signs the
exact raw JSON body; reserved signature/content headers override custom values.
Retries preserve the logical delivery ID. See [the contract](docs/api/webhooks.md).
Email links derive from `PUBLIC_WEB_URL`, with no raw IP/port links.

Transient network, 429 and 5xx delivery failures use
`NOTIFICATION_RETRY_DELAYS_MS`; final audit rows contain only safe destination
labels and sanitized outcomes. Immediate retries are in-memory and can be lost on
restart; deferred/escalation/subscriber delivery has dedicated durable state.
TLS probes are due at most once per monitor per 24-hour in-memory window.

The leader runs cleanup at 03:00 server time, and prior-calendar-month SLA email
reports at 06:00 on the first. The dashboard passes its resolved IANA display zone for on-demand PDF
downloads; direct PDF links and monthly jobs use the saved account zone or UTC.
Reporting windows remain UTC. See [SLA reports](docs/sla-reports.md).

## Database model

Schema declarations and relations live in `packages/db/src/schema/`.

| Group | Tables and role |
|---|---|
| Auth | `user`, `session`, `account`, `verification`: better-auth identities, password accounts, sessions, verification tokens, plus Pulsy role/ban fields. |
| Monitoring | `uptime_monitor`, `uptime_check_log`, `uptime_check_day`, `uptime_status_change`, `uptime_incident`: configuration/current state, granular checks, daily counts, transitions and outages. |
| Receipt monitors | `uptime_heartbeat`, `uptime_heartbeat_run`, `uptime_server`, `uptime_server_metric`: encrypted capability configuration, runs and Linux health samples. |
| Operations | Maintenance/deferred-alert tables, incident response/event/group/escalation tables: suppression and durable response state. |
| Reliability | Policy, cursor, UTC daily duration and annotation tables: versioned objectives, captured facts and private release context. |
| Reuse | Saved monitor views, templates and channel bindings: owned filter/configuration reuse. |
| Notifications and reports | `uptime_email_provider`, `uptime_notification_channel`, `uptime_notification_log`, `uptime_sla_report_subscription`: encrypted senders, monitor/default destinations, delivery audit, and monthly report delivery. |
| Publishing and sharing | Status pages/membership, announcements, subscriber/config/mail-job/pacing tables and share links: published projections, private opt-in delivery and expiring clone configuration. |
| API | `api_key`: hashed Bearer keys, display prefixes, read/full scope, expiry, revocation and removal state. |
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

## Availability and technical bounds

Every capability is free and available to every account. Technical abuse ceilings
in `lib/account-caps.ts` are identical for all users: 200 share links, 2,000 channels,
20 email providers, 200 SLA email subscriptions and 20 API keys. They cannot be
raised through a capability flag. Monitor and status-page counts are unrestricted.
Organizations provide optional account grouping; uptime resources remain owned by
individual `userId` values.

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
| Public web build | `VITE_SERVER_URL`, `VITE_APP_URL`, `VITE_SOURCE_CODE_URL`, `VITE_DEMO_NOTICE` |
| Instance policy | `DISABLE_SIGNUP`, `REQUIRE_EMAIL_VERIFICATION`, `MONITOR_ALLOW_PRIVATE_NETWORKS`, deprecated `BLOCK_PRIVATE_TARGETS`, `TRUST_PROXY_HOPS`, auth/tRPC rate limits |
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
migrations, checks the daily-rollup trigger/backfill, optionally starts the
idempotent superadmin seed in the background,
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
migration. The generated migration should be reviewed before it is applied. Containers have
no source bind mounts: copy generated migrations back with `docker cp`. This port
adds OSS migrations `0012_lethal_ser_duncan` (degraded event enum, separately),
`0013_wet_dracula` (feature schema, incident/domain invariants and locked daily
backfill/trigger), and `0014_useful_ares` (durable escalation delivery state).
Existing OSS migrations and migration history remain intact.

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
Dockerfile runs dependencies → source → translation assets gate → production
build/typecheck/tests, then copies static assets and OpenAPI into nginx. The
runtime retains immutable hashed assets in `web_assets` at `/var/cache/pulsy`,
writable by UID 101, to support clients loading older chunks after deployment.
Missing hashes return 404, and the SPA fallback never substitutes HTML for them. `docker-compose.ghcr.yml` runs released multi-architecture
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

GitHub Actions retains SHA-pinned actions and separate build, Docker, ESLint,
translations, agent and installed-agent acceptance jobs. Production dependency
audit, CodeQL and gitleaks remain enabled. Release validation runs natively before
amd64/arm64 GHCR builds with SBOM/provenance; the agent builds on `$BUILDPLATFORM`.
See [testing](docs/TESTING.md) for commands and redacted acceptance evidence.

### Status-page publication and subscription delivery

Component membership, display aliases and ordering are owner-scoped. Preview revisions
bind the exact names, selection and publication state; apply rejects stale disclosures.
Replacing membership preserves retained component IDs and metadata. Duplicates are
drafts without custom-domain claims, announcements or subscribers. There is no page
or component count limit. Missing and draft public pages are unavailable; pending or
empty published components produce an unknown state rather than false availability.

Published announcements are immutable snapshots with request credentials redacted
before storage. Public maintenance overlays require an explicitly published occurrence
that still matches its enabled owned schedule. Public feeds use audited display fields
and XML escaping; compact history exposes seven completed UTC days without private
monitor IDs, policy details or annotations.

Subscription requests store page-specific HMAC email hashes and encrypted addresses.
A 24-hour confirmation capability enables a versioned component selection. Mail links
use PUBLIC_WEB_URL with fragment capabilities that the browser redeems in JSON only;
verified custom domains are allowed request origins, never sources for mail links.
Publishing enqueues fan-out in the page transaction; jobs bind the provider/config and
subscriber versions. Fan-out batches 100 subscribers, scans claim at most 25 jobs, and
four sends share a persisted provider pacing gate. Uncertain delivery is terminal;
definite transient failures receive at most four attempts. Leader-owned workers drain
on shutdown. Terminal jobs and unconfirmed/unsubscribed addresses expire after 30 days.
Public responses never contain subscriber addresses, provider responses or capabilities.

## Dashboard interaction and UI policy

The responsive shell has a sticky header, grouped desktop navigation and a mobile
sheet, a skip link, keyboard search and recoverable session errors. Every route
retains the corresponding-source offer and its 45px layout allowance. Theme and
locale bootstrap run before first paint; theme loads as a synchronous same-origin
script under the strict script CSP. Account timezone and locale formatting apply
consistently, with logical CSS properties and RTL for Arabic.

Monitor tabs use `overview | incidents | history | alerts | reports | settings`;
old `notifications` and `slaReport` URLs rewrite to `alerts` and `reports`.
Dashboard URL state retains filters, sort/group/density and saved views. Selection
uses the shared bulk-selection hook. Reuse/import previews validate the exact
owned configuration and disclose pending changes before reconciliation.

Shared controls provide accessible labels, logical focus, indeterminate selection,
validation summaries, confirmation dialogs and dirty draft guards. Dialogs have
bounded scrolling and sticky actions; inputs remain usable at phone widths. UI
stays restrained: `shadow-sm` maximum, no hover lift, decorative animation,
`rounded-2xl+` or `transition-all`. Specialized date/file/select controls live under
`components/ui`; ESLint prevents native alternatives elsewhere. In-app Help
compiles the five localized Markdown guide sets at build time without raw HTML.
