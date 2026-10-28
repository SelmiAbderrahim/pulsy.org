# Testing

Run all application builds, tests, lint and typechecks through Docker and the
Makefile. Node, pnpm and Go are provided by the images; they are not required on
the host. The initial build downloads pinned dependencies from their registries.

## Build current source before checking it

Configure the root `.env` as described in the [README](../README.md), then run:

```bash
make start
make typecheck
make lint
make translations-check
make test
make web-assets-check
```

`make start` rebuilds and starts PostgreSQL, the source server and the web
runtime. The server entrypoint applies committed migrations by default;
`make migrate` applies them explicitly when needed. Application source is copied
into the images, with no repository bind mounts. Run `make start` again after
editing source before running checks that execute in the server container.

The `pulsy-web` container serves the built SPA with nginx as UID 101. It has no
Node, pnpm or application source. Web checks run in Docker build stages instead:
the normal web build checks translations, builds the app, typechecks it and runs
the full jsdom suite. Docker reuses successful cached stages when source and
configuration have not changed.

| Target | Checks |
|--------|--------|
| `make typecheck` | Server and database TypeScript in the source server; web validation during its Docker build. |
| `make lint` | Actual ESLint, policy regressions, server/database typechecks and the normal web build. |
| `make eslint-check` | Repository ESLint with zero warnings, followed by 22 policy regression cases. |
| `make translations-check` | Five-locale catalogue checks and three regression tests that mutate temporary catalogues to prove the gate rejects errors. |
| `make test` | Server/database Vitest suites against a recreated test database, then the normal web build and suite. |
| `make build` | Build both application images, including normal web validation. |
| `make web-assets-check` | Retained immutable assets across image changes and rollback, using disposable containers and a volume. |

The ESLint regressions reject native alert/confirmation calls and app-level
native select, disclosure, date and file controls, while allowing the shared UI
internals and scoped themed confirmation helpers. Translation checks cover
referenced keys, locale plural categories, interpolation variables, untranslated
values, hard-coded digits and the pending-translation ledger. Their regression
fixtures do not change the checked-in catalogues.

## Database-backed tests and focused regressions

Vitest runs pure unit tests and service integration tests against real
PostgreSQL. `make test` recreates `${POSTGRES_DB}_test` (normally `pulsy_test`)
and overrides `DATABASE_URL` for both workspace test processes. The test
harness applies Drizzle migrations, and database-backed files run serially to
avoid races between table resets. The runtime database is left intact.

The global setup also derives a sibling test database when given a URL whose
database name is not explicitly test-named. An explicitly test-named URL is
reused and its tables may be truncated. Keep test processes pointed at disposable
data; do not enable the configured-database override against a database you need.

Coverage includes monitor CRUD, incidents and recovery, HTTP/SSRF checks,
credential encryption and masking, user ownership, server-agent ingestion and
token rotation, public release files, status-page selection, and five-locale
backend messages. Notification-provider behavior uses mocked or local transports.
Representative tests include `lib/crypto.test.ts`, `lib/ssrf.test.ts`,
`lib/ip-rate-limit.test.ts` and `lib/i18n.test.ts` under `apps/server/src`, plus
web bulk selection, query keys, shared utilities and locale regressions.

For focused server-health work:

```bash
make server-health-regression-check
make server-health-web-check
```

`server-health-regression-check` rebuilds the source server and starts PostgreSQL
through `make test-infrastructure`, then recreates
`${POSTGRES_DB}_server_health_test`. It runs the server-health, agent-release-route,
validation-http and page-selection regressions. `make server-health-check` is a
narrower server-health/release-route gate that first rebuilds the full stack.

`server-health-web-check` builds the web `source` stage, then runs the web build,
typecheck and server-health/dashboard-help/dashboard-search suites inside a
disposable Node container. `make test-infrastructure` is also available when only
the source server and PostgreSQL are needed; it does not build the full web image.

## Agent checks

```bash
make agent-check
make agent-build
make agent-install-check
make agent-compose-check
```

`agent-check` verifies formatting, runs Go vet and executes race-enabled tests
in the pinned Go toolchain. `agent-build` exports Linux amd64/arm64 binaries,
installer, Compose configuration and `SHA256SUMS` to `artifacts/agent/v1.0.0/`.
The installer and Compose checks depend on that build automatically.

`agent-install-check` exercises the real installer in a disposable Linux/systemd
fixture. `agent-compose-check` runs the installer-generated Compose agent and
checks host metrics against a local HTTPS receiver. These Docker fixtures are
separate from the normal application stack. See the [agent README](../agent/README.md)
for installation and credential handling.

## Installed-agent acceptance

```bash
make server-health-e2e
```

This builds a separate Docker Compose project with its own PostgreSQL, HTTPS
proxy, systemd host fixture and Chromium browser. It has no host ports, repository
mounts or connection to the runtime database. The test creates a disposable
account, creates a server monitor through the UI, downloads the deployment's
versioned installer, and runs the actual installed agent over verified HTTPS. Notifications go only
to the local fixture webhook.

The lifecycle uses the production 60-second reporting interval and real elapsed
time. It observes the first two high-RAM reports without activating pressure,
then degradation on the third; preserves the active condition through a backend
restart; recovers after two healthy reports; detects three missing intervals;
and recovers after the agent restarts. It verifies four deduplicated lifecycle
notifications, credential rotation rejecting the old token, reconnection with the
new token, and monitor deletion rejecting further reports. Allow time for these
reporting and missing-report windows rather than shortening the interval.

Browser checks cover dashboard, detail, settings and rotation dialogs in en/ar/fr/de/es
at 360, 768 and 1440 pixels, including Arabic RTL, keyboard focus, WCAG accessibility,
overflow, console errors and failed requests. This fixture's web image skips the
jsdom suite; run the normal web validation separately.

Evidence is exported from the browser container to `artifacts/server-health-e2e/`
before containers and volumes are removed, including after failures. It contains
`results.json`, masked screenshots and failure/accessibility reports when needed;
service logs are captured on failure. Credentials are masked or redacted, and
page HTML, request bodies, traces and cookies are not retained. Each run clears
the previous evidence files.

`make server-health-e2e-run` reruns acceptance using built images. Rebuild with
`make server-health-e2e` after source changes. While a run is active,
`make server-health-e2e-logs` and `make server-health-e2e-fixture-status` inspect
only its disposable services.

## Retained web assets

After building the web image, `make web-assets-check` models successive image
contents and rollback under nginx UID 101. It verifies old and new hashed assets
remain available, an existing hash is never overwritten, gzip and immutable
caching work, and security headers remain present. A missing hashed asset must
return a real 404, while client routes still receive the SPA and HTML/OpenAPI
responses use no-cache. The check creates and removes its own containers and
volume without modifying the normal retained-assets volume.

## Coverage configuration

The workspace [server](../apps/server/vitest.config.ts),
[database](../packages/db/vitest.config.ts) and
[web](../apps/web/vitest.config.ts) Vitest configurations define the authoritative
coverage scopes and exclusions. All three specify 100% statement, branch,
function and line thresholds for explicit coverage runs. Normal `make test`
does not collect coverage. These configured thresholds are not a claim that an
ordinary test run measured 100% of the repository.

## CI and releases

[CI](../.github/workflows/ci.yml) keeps separate jobs for application
audit/typecheck/tests/build, production Docker images, ESLint, translations,
agent checks/installers, and installed-agent acceptance. All action references
are pinned to commit SHAs, and application execution uses Docker throughout.
Each service-backed job receives fresh disposable credentials. Installed-agent evidence is uploaded even after failure and retained
for 14 days. Separate security workflows remain independent.

The [release workflow](../.github/workflows/release.yml) checks the tag against
the package version, audits production dependencies, and runs the native Docker
validation before publishing Linux amd64/arm64 images. The multiarch web image
build sets `RUN_WEB_TESTS=0` because emulated jsdom tests can exceed their timeout
under QEMU; the same suite has already run natively in the required `validate`
job. Published web images link to the exact source commit used for that build.
