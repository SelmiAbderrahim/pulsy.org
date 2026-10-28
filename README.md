# Pulsy

[![CI](https://github.com/SelmiAbderrahim/pulsy/actions/workflows/ci.yml/badge.svg)](https://github.com/SelmiAbderrahim/pulsy/actions/workflows/ci.yml)
[![CodeQL](https://github.com/SelmiAbderrahim/pulsy/actions/workflows/codeql.yml/badge.svg)](https://github.com/SelmiAbderrahim/pulsy/actions/workflows/codeql.yml)
[![Secret scan](https://github.com/SelmiAbderrahim/pulsy/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/SelmiAbderrahim/pulsy/actions/workflows/secret-scan.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933.svg?logo=node.js&logoColor=white)](.nvmrc)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Pulsy is a self-hosted website uptime and downtime monitor. It checks HTTP, DNS and TCP endpoints, receives cron heartbeats and Linux
server-health reports, records reliability and response times, tracks TLS
certificate expiry, groups failures into incidents, sends notifications, and
publishes opt-in status pages.

Pulsy is free and fully featured. There are no plans, tiers, quotas, paid
add-ons, or billing code of any kind — every capability is available to every
user on every install.

## Features

- HTTP `GET`, `HEAD` and `POST` checks with expected-status rules, request
  credentials, header/body assertions, redirect policy and optional TLS expiry.
- DNS and TCP checks, plus heartbeat/cron monitors with run history and deadlines.
- Linux CPU, RAM, swap, disk, load and uptime monitoring through the dependency-free
  [Go agent](docs/self-hosting/server-health-agent.md).
- Degraded/latency policies, maintenance windows, snoozes and deferred alerts.
- Incident acknowledgement, notes, runbooks, groups and two-step escalation.
- Reliability/SLO objectives, duration-weighted history, deployment annotations,
  daily aggregates and configurable retention.
- Email, signed webhook v1, Slack, Discord and Telegram notifications; encrypted
  provider credentials, destinations, custom headers and signing secrets.
- Published status pages with selected components, announcements, optional history,
  custom domains, double opt-in email subscriptions, RSS/Atom, JSON feeds and badges.
- Manifest import/export with preview and reconciliation, saved views, reusable
  monitor templates and bulk operations.
- Expiring share links with preview and optional attribution; configuration crosses
  accounts without private history, notification credentials or channels.
- SLA PDF reports and monthly email, account timezone preferences and bundled Help.
- A versioned REST API with scoped, expiring and revocable hashed keys, plus
  authenticated Prometheus metrics.
- English, Arabic, French, German and Spanish, including Arabic RTL, dark mode and
  a responsive keyboard-accessible dashboard.

## Screenshots

### Dashboard

![Pulsy dashboard with summary statistics and a monitor table](docs/screenshots/dashboard.png)

### Monitor detail

![Pulsy monitor detail with uptime and response-time charts](docs/screenshots/monitor-detail.png)

### Notifications

![Pulsy monitor notification settings](docs/screenshots/notifications.png)

### Status page

![Pulsy public status page](docs/screenshots/status-page.png)

## Quick start

Pulsy's supported development and self-hosting workflow uses Docker Engine with
the Compose plugin.

```bash
git clone https://github.com/SelmiAbderrahim/pulsy.git
cd pulsy
cp .env.example .env
chmod 600 .env
```

Edit `.env`, set a database password in both fields below, and replace the two
application secrets:

```dotenv
POSTGRES_PASSWORD=use-a-strong-database-password
DATABASE_URL=postgres://pulsy:use-a-strong-database-password@postgres:5432/pulsy
ENCRYPTION_KEY=replace-with-output-from-openssl
BETTER_AUTH_SECRET=replace-with-output-from-openssl
```

Generate a URL-safe database password and the two application secrets
independently:

```bash
openssl rand -hex 32
openssl rand -base64 32
openssl rand -base64 32
```

Use the generated hexadecimal form (or another URI-safe value): Compose builds
the PostgreSQL URL directly from `POSTGRES_PASSWORD`.

Then start the stack:

```bash
make start
make seed
```

Open <http://localhost:3000> and sign in to the optional demo account:

| Field | Value |
|---|---|
| Email | `demo@pulsy.org` |
| Password | `pulsy-demo-1234` |

The server applies committed Drizzle migrations during startup. `make migrate`
is available when you want to run the migrator explicitly. Remove the demo
account and use unique credentials before exposing an instance publicly.

Tagged releases publish multi-architecture server and web images to GHCR. The
prebuilt-image Compose file is [`docker/docker-compose.ghcr.yml`](docker/docker-compose.ghcr.yml);
building from source with `make start` remains the most predictable option
before the first tagged release.

## Deployment model

The default stack contains three containers:

| Service | Container | Host port | Purpose |
|---|---|---:|---|
| Web | `pulsy-web` | `3000` | Unprivileged nginx serving the React SPA and proxying `/api/*` |
| Server | `pulsy-server` | `4000` | Express, tRPC, better-auth, REST API, scheduler, and migrations |
| Database | `pulsy-postgres` | `5432` | PostgreSQL 16 |

The API and PostgreSQL host ports bind to `127.0.0.1`; the web service is the
public entry point. Put a TLS-terminating reverse proxy in front of it for
production. One PostgreSQL advisory-lock leader owns scheduled work across
server processes. Rate limits remain per process; keep the default single-server
deployment unless you also account for shared request budgets and proxy trust.

Useful commands:

```bash
make start              # build and start the stack
make logs               # follow all service logs
make migrate            # apply committed migrations
make seed               # create demo data
make seed-superadmin    # create/promote the configured operator account
make test               # run server/db tests and the web build/test pipeline
make typecheck          # typecheck server/db and validate the web image
make stop               # stop the stack
```

See [database migrations](docs/self-hosting/migrations.md) before upgrading an
installation created by an early `drizzle-kit push` release.

## Production security checklist

- Keep `.env` outside version control and deployment archives. It is ignored by
  Git and Docker, while `.env.example` contains placeholders only.
- Keep `ENCRYPTION_KEY` stable and backed up. Rotating it makes previously
  encrypted provider credentials, notification targets, and custom header
  values unreadable.
- Use a unique `BETTER_AUTH_SECRET` and database password for every deployment.
- Terminate TLS at the edge and set `PUBLIC_WEB_URL` and `BETTER_AUTH_URL` to
  the browser-facing HTTPS origin; add any extra origins to `TRUSTED_ORIGINS`.
- Registrations are open by default. Set `DISABLE_SIGNUP=true` for a private
  instance. Set `MONITOR_ALLOW_PRIVATE_NETWORKS=false` when accounts should
  reach only public targets. Private/LAN destinations are allowed by default;
  metadata and link-local addresses are always blocked. DNS is pinned at connect
  and every redirect is checked. See [network policy](docs/self-hosting/ssrf.md).
- Restrict access to PostgreSQL and the server port, keep images updated, and
  back up both PostgreSQL and the long-lived encryption key.
- Configure an outbound email provider if you require verification and password
  reset messages in production.

Security issues should be reported privately as described in
[SECURITY.md](SECURITY.md).

## Configuration

The root [`.env.example`](.env.example) is the deployment configuration
reference and the only environment-file template. Important groups include:

| Variables | Purpose |
|---|---|
| `POSTGRES_*`, `DATABASE_URL` | Database credentials and connection settings |
| `ENCRYPTION_KEY`, `BETTER_AUTH_SECRET` | Required application secrets |
| `PUBLIC_WEB_URL`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS` | Browser-facing auth/CORS trust |
| `DISABLE_SIGNUP`, `REQUIRE_EMAIL_VERIFICATION` | Registration and email-verification policy |
| `MONITOR_ALLOW_PRIVATE_NETWORKS` | Defaults to `true` for LAN targets; metadata/link-local always blocked |
| `BLOCK_PRIVATE_TARGETS` | Deprecated alias: `true` denies private targets only when the new setting is absent |
| `TRUST_PROXY_HOPS` | Trusted reverse-proxy depth, default `1` |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional auth and operator email delivery |
| `CHECK_LOG_RETENTION_DAYS` | Default `30`; check logs, server metrics and reliability retention |
| `CHECK_CONCURRENCY`, `CLEANUP_BATCH_SIZE`, `DATABASE_POOL_MAX` | Probe concurrency, cleanup batches and connection pool |
| `AUTH_RATE_LIMIT_PER_MIN`, `TRPC_RATE_LIMIT_PER_MIN`, `NOTIFICATION_RETRY_DELAYS_MS` | Request ceilings and delivery retries |
| `API_V1_ENABLED`, `API_RATE_LIMIT_PER_MIN` | REST API switch and per-key rate limit |
| `VITE_APP_URL`, `CUSTOM_DOMAIN_*`, `DNS_RESOLVERS`, `CERTBOT_*` | Custom status-page domains and TLS provisioning |
| `VITE_SOURCE_CODE_URL` | Public corresponding source linked from every app route |

`VITE_*` values are compiled into the browser bundle. Rebuild the web image
after changing them. Before building a fork or a modified deployment, set
`VITE_SOURCE_CODE_URL` to the publicly reachable tag or commit containing the
exact source used for that deployment; the upstream repository URL is only the
default. For custom status-page domains, follow
[the complete operator guide](docs/custom-domain-status-pages.md).

## Public status pages

Status pages are explicit, publishable resources. Owners choose which monitors
appear, and the unauthenticated response exposes only monitor names, current
states, aggregate uptime/response time, page metadata, and recent incidents.
Monitor URLs, TLS details, owners, channels and credentials are not returned.
Owners can publish announcements and maintenance notices, enable compact history,
and configure double opt-in email subscriptions. Feed URLs provide RSS/Atom,
`status.json`, `badge.svg` and explicitly enabled `history.json` projections.

Pages can use an app-host URL such as `/status/<userId>/<slug>` or a verified
custom domain. Custom-domain TLS automation is optional host-side tooling under
[`ops/custom-domains/`](ops/custom-domains/README.md).

## REST API

The authenticated REST API is mounted at `/api/v1`. Create a key under
**API Keys** in the dashboard and send it as a Bearer token:

```bash
curl https://your-pulsy.example/api/v1/monitors \
  -H 'Authorization: Bearer pul_…'
```

Choose `read` for read-only clients or `full` for writes, with optional expiry.
Plaintext keys are shown once and only their SHA-256 hashes are stored. Revocation,
expiry, removal and banning the owner invalidate access. The
complete reference and OpenAPI document live in [`docs/api/`](docs/api/README.md).

## Architecture

Pulsy is a pnpm workspace:

```text
apps/web/      React 19 SPA (Vite, TanStack Router/Query, Tailwind, i18next)
apps/server/   Express API, tRPC, better-auth, REST routes, and scheduler
packages/db/   Drizzle schema, migrations, validation, and PostgreSQL client
docker/        Development and release container definitions
docs/          API, operations, testing, and feature documentation
ops/           Optional host-side custom-domain provisioner
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for request flows, trust boundaries, and
the data model.

## Development and testing

Development is Docker-first. Do not run the application directly on the host.

```bash
cp .env.example .env
make start
make migrate
make typecheck
make lint
make translations-check
make test
make agent-check
```

The test suite uses Vitest. Server and database integration tests run against
an isolated PostgreSQL database; web tests run in the web Docker build. Coverage
configuration is maintained per workspace for focused coverage runs. See
[docs/TESTING.md](docs/TESTING.md) for details.

CI typechecks, tests, audits production dependencies, enforces ESLint and
translations, checks agent installation and runs browser acceptance with the real
60-second reporting interval. Separate workflows retain CodeQL and full-history
secret scanning. Containers contain source snapshots: rebuild with `make start`
before checks after edits. See [the agent guide](docs/self-hosting/server-health-agent.md),
[heartbeat ingress](docs/self-hosting/heartbeat.md) and [testing](docs/TESTING.md).

## Contributing and support

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), follow
the [Code of Conduct](CODE_OF_CONDUCT.md), and use [SUPPORT.md](SUPPORT.md) to
choose the right help channel. Please never include credentials, private URLs,
or unredacted logs in an issue.

## License

Pulsy is licensed under the GNU Affero General Public License, version 3 or any
later version (`AGPL-3.0-or-later`). See [LICENSE](LICENSE).
