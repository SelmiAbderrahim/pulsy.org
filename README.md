# Pulsy

[![CI](https://github.com/SelmiAbderrahim/pulsy.org/actions/workflows/ci.yml/badge.svg)](https://github.com/SelmiAbderrahim/pulsy.org/actions/workflows/ci.yml)
[![CodeQL](https://github.com/SelmiAbderrahim/pulsy.org/actions/workflows/codeql.yml/badge.svg)](https://github.com/SelmiAbderrahim/pulsy.org/actions/workflows/codeql.yml)
[![Secret scan](https://github.com/SelmiAbderrahim/pulsy.org/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/SelmiAbderrahim/pulsy.org/actions/workflows/secret-scan.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933.svg?logo=node.js&logoColor=white)](.nvmrc)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Pulsy is a self-hosted website uptime and downtime monitor. It checks HTTP
endpoints on a schedule, records availability and response times, tracks TLS
certificate expiry, groups failures into incidents, sends notifications, and
publishes opt-in status pages.

Pulsy is free and fully featured. There are no plans, tiers, quotas, paid
add-ons, or billing code of any kind — every capability is available to every
user on every install.

## Features

- Scheduled `GET`, `HEAD`, and `POST` checks with configurable timeouts,
  expected status codes, intervals, and failure thresholds.
- Up, down, degraded, and pending states with response-time history, uptime
  charts, incidents, and retention controls.
- TLS certificate expiry monitoring for HTTPS targets.
- Email, webhook, Slack, Discord, and Telegram notifications.
- Resend, SendGrid, and SMTP email-provider credentials, notification targets,
  and custom webhook-header values encrypted at rest using AES-256-GCM.
- Named public status pages with selected monitors, recent incidents, optional
  custom domains, and a deliberately limited public data projection.
- Expiring monitor-configuration share links that never include history,
  channels, or credentials.
- Monthly SLA reports, including PDF download and optional email delivery.
- A versioned REST API with revocable, hashed Bearer API keys.
- English, Arabic, French, German, and Spanish interfaces, including RTL
  support for Arabic.

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
production. The scheduler runs in the server process, so run a single server
replica unless you add distributed scheduling and rate limiting.

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
  instance, or set `BLOCK_PRIVATE_TARGETS=true` when untrusted users can create
  monitors. The latter blocks loopback, private, link-local, metadata, ULA, and
  CGNAT targets and revalidates redirects.
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
| `DISABLE_SIGNUP`, `BLOCK_PRIVATE_TARGETS`, `TRUSTED_ORIGINS` | Registration and network security policy |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional auth and operator email delivery |
| `CHECK_*`, `CLEANUP_BATCH_SIZE`, `DATABASE_POOL_MAX` | Scheduler, retention, and scale tuning |
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
Monitor URLs, TLS details, owners, channels, and credentials are not returned.

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

Plaintext keys are shown once and only their SHA-256 hashes are stored. The
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
make typecheck
make test
```

The test suite uses Vitest. Server and database integration tests run against
an isolated PostgreSQL database; web tests run in the web Docker build. Coverage
configuration is maintained per workspace for focused coverage runs. See
[docs/TESTING.md](docs/TESTING.md) for details.

CI typechecks, tests, audits production dependencies, builds the web app, and
builds both Docker images. Separate workflows run CodeQL and full-history
secret scanning.

## Contributing and support

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), follow
the [Code of Conduct](CODE_OF_CONDUCT.md), and use [SUPPORT.md](SUPPORT.md) to
choose the right help channel. Please never include credentials, private URLs,
or unredacted logs in an issue.

## License

Pulsy is licensed under the GNU Affero General Public License, version 3 or any
later version (`AGPL-3.0-or-later`). See [LICENSE](LICENSE).
