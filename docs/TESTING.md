# Testing

Pulsy uses [Vitest](https://vitest.dev/) across the server, web, and database
workspaces. Tests fall into two buckets:

- **Unit tests** — pure, with no database or network dependency; contributors
  still execute them through the Docker-first workflows below.
- **Integration tests** — exercise the real services against a real Postgres. Network-facing
  provider paths use mocked/captured transports unless safe credentials are explicitly present.

> **Heads up:** the initial Docker build needs npm-registry access to install
> pinned dependencies. After the image cache is warm, normal test runs reuse it.

---

## Test Commands

Use Docker-first Makefile targets for contributor validation:

```bash
make start
make migrate
make test
```

The `pulsy-web` container is an nginx runtime image and intentionally does not
contain pnpm or source files. Use `make test`, `make typecheck`, or `make build`
for Docker-first web validation; the web Docker build runs web typecheck, web
tests, and the production build.

Package-level pnpm scripts are used by CI and maintainers working inside the
right container. Each `vitest.config.ts` defines focused coverage scopes and
100% statement/branch/function/line thresholds for explicit coverage runs; the
normal `make test` path runs the suites without collecting coverage. See the
`coverage.include`/`exclude` lists for what is deliberately excluded. A
representative sample of the 100+ test files:

| Test | What it covers |
|------|----------------|
| `apps/server/src/lib/crypto.test.ts` | AES-256-GCM `encrypt`/`decrypt` round-trip, ciphertext ≠ plaintext, random-IV (two encryptions differ), unicode/empty handling. Sets `ENCRYPTION_KEY` itself. |
| `apps/server/src/lib/ssrf.test.ts` | The SSRF egress guard — private/loopback/link-local/CGNAT/cloud-metadata targets, redirect-hop re-validation. |
| `apps/server/src/lib/ip-rate-limit.test.ts` | The per-IP fixed-window limiter used in front of `/api/trpc` and `/api/auth/*` — limits, headers, window reset, bucket eviction. |
| `apps/server/src/lib/i18n.test.ts` | Backend `ctx.t` translation catalogue — 5-locale completeness and placeholder parity. |
| `apps/web/src/lib/utils.test.ts` | The `cn()` class-name merge helper (clsx + tailwind-merge). Runs under jsdom. |
| `apps/web/src/lib/locales.test.ts` | Supported-locale list + RTL detection. |
| `apps/web/src/hooks/useBulkSelection.test.ts` | The generic checkbox bulk-selection hook used by monitor-list bulk actions. |
| `apps/web/src/hooks/uptime/queryKeys.test.ts` | The tRPC query-key factory — the single source of truth for cache keys. |

---

## Integration tests

`make test` recreates a sibling `pulsy_test` database inside the Compose
Postgres service and overrides `DATABASE_URL` for the server and database test
processes. The seeded runtime database remains untouched.

It covers:

- **(a)** monitor CRUD via `monitor-service`,
- **(b)** incident open-on-threshold / resolve-on-recovery via `incident-service`,
- **(c)** a live HTTP check via `performHttpCheck` (up vs. unroutable; network assertions are
  tolerant of a sandboxed environment),
- **(d)** email-provider secret encryption/masking and decrypted email notification dispatch,
- **(e)** Resend, SendGrid, SMTP, webhook, Slack, Discord, and Telegram notification
  formatting/error behavior through mocked local transports where real credentials are not
  required,
- **(f)** the organization tRPC router
  (`trpc/routers/__tests__/organization.test.ts`) and the backend i18n
  catalogue (5-locale completeness + placeholder parity, in `lib/i18n.test.ts`).

### Run it via Docker

```bash
make start            # brings up postgres + server (DATABASE_URL is set in the container)
make migrate          # ensure the schema exists
make test             # server/db tests in pulsy-server; web tests during the web Docker build
```

The test harness applies Drizzle migrations to `pulsy_test` and truncates test
tables between cases. Do not point package-level `pnpm test` at a database whose
data you care about.

---

## In CI

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs package checks,
builds the web app, and builds both Docker images. The test harness provisions
an isolated PostgreSQL container for database-backed tests; provider traffic is
mocked.
