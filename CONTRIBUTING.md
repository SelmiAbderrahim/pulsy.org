# Contributing to Pulsy

Thanks for your interest in improving Pulsy! This guide covers how to set up a development
environment, the conventions we follow, and how to add common features (a notification
channel, a UI locale).

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Project layout

Pulsy is a pnpm monorepo:

```
apps/web/      React SPA (Vite, TanStack Router/Query, Tailwind, shadcn/ui, i18next)
apps/server/   tRPC API + better-auth + node-schedule scheduler
packages/db/   @pulsy/db — Drizzle schema, migrations, db client
docker/        Dockerfiles + docker-compose.yml
docs/          design notes, screenshots, testing guide
```

The server owns the API, scheduler, and auth. The web app is a pure SPA. The db package is
the single source of truth for the schema.

---

## Development setup

### Docker-first (recommended)

```bash
cp .env.example .env
openssl rand -base64 32   # -> paste as ENCRYPTION_KEY in .env
openssl rand -base64 32   # -> paste as BETTER_AUTH_SECRET in .env
make start                # build + start postgres, server, web
make migrate              # apply the schema
make seed                 # demo user + example monitors
make logs                 # tail logs
make stop                 # stop the stack
```

Useful container shells:

```bash
make shell-server     # sh into pulsy-server
make shell-web        # sh into pulsy-web
make shell-postgres   # psql into the database
```

`shell-web` opens the nginx runtime container; it does not contain Node, pnpm,
or the source tree. Use the Make targets for web builds, tests, and typechecks.

### Package Scripts

The monorepo keeps pnpm scripts for CI and for maintainers already working inside
the matching Docker container. First-time contributor setup and validation should
use the Makefile targets above so Postgres, the API server, the nginx web runtime,
and same-origin `/api/*` proxy are exercised together.

---

## Code style

- **TypeScript strict.** The repo extends a strict `tsconfig.base.json`
  (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`). No `any` escapes.
- **Conventions.** See `CLAUDE.md`'s Conventions section for the full list. The ones that apply
  to all contributions:
  - Service-layer + query-key-factory conventions for tRPC routers/hooks.
  - Backend errors go through `ctx.t`, never hardcoded strings.
  - Use logical CSS properties (`ms-*`/`me-*`/`ps-*`/`pe-*`, `text-start`/`text-end`); the app
    sets `dir="rtl"` for Arabic.
  - No card-lift hover, no decorative animation, `shadow-sm` max.
  - Tabbed views persist the active tab in the URL.
  - Never size a `Switch` with `min-h`/`min-w`.
  - A single root `.env`; never add subdirectory `.env` files.
- **Everything is free and ungated.** Pulsy has no plans, tiers, quotas, or billing
  code; never add a paywall, entitlement check, or capability flag. Scope every query
  by `ctx.user.id`.
- **Validate inputs with Zod.** Every tRPC procedure validates its input. Use
  `protectedProcedure` for all data access. The complete unauthenticated
  whitelist is `uptimeMonitor.public.{status,statusPageBySlug,statusPageByDomain,sharedLink}`;
  changes to it require an explicit security review.
- **No new dependencies without discussion.** Dependencies are pinned and pulled from
  public npm only.

---

## Running checks

```bash
# Typecheck every package
make typecheck

# Tests: server uses an isolated pulsy_test DB; web runs during Docker build
make test

# Runtime smoke path
make start                # bring up the stack (sets DATABASE_URL)
make migrate              # ensure the schema exists
make test
```

See [docs/TESTING.md](docs/TESTING.md) for the full testing guide, including test
database isolation.

> **Note:** on hosts without npm-registry access, `pnpm install` (and therefore tests) cannot
> run; rely on CI or a network-enabled machine.

---

## Commits, branches, and pull requests

- **Conventional commits.** Use `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`,
  etc. Example: `feat(notifications): add Microsoft Teams channel`.
- **Branch from `main`.** Use a descriptive branch name (e.g. `feat/teams-channel`,
  `fix/tls-expiry-rounding`).
- **Keep PRs focused.** One logical change per PR. Update docs and tests in the same PR.
- **Fill out the PR template.** Confirm typecheck/tests pass, docs are updated, and no
  secrets are committed.
- **DCO sign-off (optional but appreciated).** You may add a `Signed-off-by:` trailer with
  `git commit -s` to certify the [Developer Certificate of Origin](https://developercertificate.org/).
- **Inbound license.** By submitting a contribution, you agree that it may be
  distributed under this repository's `AGPL-3.0-or-later` license and that you
  have the right to submit it.

---

## How to add a new notification channel

The notification system lives in
[`apps/server/src/services/uptime/notification-service.ts`](apps/server/src/services/uptime/notification-service.ts).

1. **Schema** — add your channel value to the `uptimeNotificationChannelTypeEnum` in
   [`packages/db/src/schema/uptime-monitor.ts`](packages/db/src/schema/uptime-monitor.ts),
   and to the matching Zod enums (`apiCreateUptimeNotificationChannel`,
   `apiUpdateUptimeNotificationChannel`). Generate a migration with `make generate`.
2. **Sender** — add a `sendXxxNotification(channel, monitor, statusChange)` function in
   `notification-service.ts`, following the existing webhook/Slack/Discord/Telegram senders
   (build a payload with `buildPayload`, POST it, throw on a non-OK response). Export it from
   [`apps/server/src/services/uptime/index.ts`](apps/server/src/services/uptime/index.ts).
3. **Dispatch** — add a `case` for your channel type in the `switch` inside
   `dispatchNotifications`.
4. **UI** — surface the new channel type in the notification settings UI under
   [`apps/web/src/components/uptime/`](apps/web/src/components/uptime/).
5. **i18n** — add the channel's labels to every locale's `uptimeMonitor.json` (see below).
6. **Tests** — extend `apps/server/src/__tests__/uptime.integration.test.ts` so the new
   channel is dispatched on a status change.

---

## How to add a new locale

Pulsy ships 5 locales (`en`, `ar`, `fr`, `de`, `es`). To add another:

1. Create `apps/web/public/locales/<lang>/` by mirroring every JSON namespace in
   `apps/web/public/locales/en/`.
2. Register the language in [`apps/web/src/i18n.ts`](apps/web/src/i18n.ts).
3. If the language is right-to-left, ensure the app sets `dir="rtl"` for it (see how Arabic
   is handled) and use logical CSS properties throughout (`ms-*`/`me-*`, `text-start`/`text-end`).

To extend an existing locale, add your keys to the relevant `*.json` file for **every**
language so no locale is left with missing strings.

---

Questions? Follow [SUPPORT.md](SUPPORT.md) to choose the right issue template.
Thank you for contributing!
