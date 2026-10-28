# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- HTTP request configuration, expected-status rules, response assertions, latency
  hysteresis, degraded alerts and configuration probes.
- DNS/TCP checks, cron heartbeats and the version 1.0.0 Linux server-health agent.
- Maintenance and snooze schedules, deferred delivery, incident acknowledgement,
  notes, runbooks, severity, grouping, timelines and two-step escalation.
- Reliability objectives, duration-weighted daily history and private annotations.
- Status-page component editing, announcements, duplicate/selection previews,
  optional public history, double opt-in email, RSS/Atom, JSON feeds and SVG badges.
- Configuration manifests with export/preview/reconcile, saved views, reusable
  templates and channel bindings; bulk deletion and spread first checks.
- Read/full API keys with expiry and removal, configuration/reliability REST
  routes and authenticated Prometheus metrics.
- Share preview and optional attribution, account timezone preferences, bundled
  localized Help, and five-locale translation integrity tooling.
- Agent, installer, Compose, retained-asset and real browser lifecycle checks;
  dedicated ESLint, translation, agent and acceptance CI jobs.

### Changed

- Responsive dashboard shell, status-page editor and canonical monitor tabs:
  Overview, Incidents, History, Alerts, Reports and Settings.
- Accessible shared form/dialog controls, keyboard navigation, draft guards,
  pre-paint theme/locale startup and Arabic RTL across phone and desktop widths.
- PostgreSQL advisory-lock scheduler leadership and periodic reconciliation;
  daily check aggregates and server/reliability retention use the operator setting.
- Source containers remain snapshots; Docker web builds enforce translations,
  types and tests, and non-root nginx retains immutable assets between deployments.
- Added OSS migrations `0012_lethal_ser_duncan`, `0013_wet_dracula` and
  `0014_useful_ares`; existing migration history is preserved.

### Security

- DNS-pinned egress and per-redirect validation with private/LAN targets allowed
  by default through `MONITOR_ALLOW_PRIVATE_NETWORKS=true`; metadata/link-local
  remain blocked. The old `BLOCK_PRIVATE_TARGETS` setting is deprecated.
- Signed webhook contract v1 with stable delivery IDs and encrypted signing keys.
  Browser-generated keys preserve one-time setup while server responses stay masked.
- Configurable trusted proxy depth, IPv6 /64 rate keys, bounded JSON ingress,
  token-keyed heartbeat/agent routes and published-only public projections.
- Owner locking, technical abuse ceilings, diagnostic redaction, single ongoing
  incident enforcement and verified-domain uniqueness.

## [0.1.0] - 2026-08-01

### Changed

- Simplified the web build to a dashboard-first SPA and replaced generated
  marketing sitemap output with a static crawler policy for authenticated and
  token-bearing routes.
- Reconciled the README, architecture, contributor guidance, issue templates,
  and environment reference with the current Docker-first implementation.
- Hardened environment-file ignore patterns and made optional email credentials
  empty by default in `.env.example`.

### Removed

- **Removed all billing, payments, and plan code.** Pulsy is now free and fully
  featured for every user with no tiers, entitlements, quotas, or feature flags.
  Deleted the Polar payment provider and its webhooks, the billing/entitlement
  resolver and tier guards, the `/pricing`, `/dashboard/billing`, and
  `/invite/:token` routes, the plan-invitation grant system, the contact-support
  flow, and the `FEATURE_FLAG_PAYMENTS`, `VITE_FEATURE_PAYMENTS`,
  `PAYMENT_PROVIDER`, `POLAR_*`, and `SUPPORT_INBOX_*` environment variables.
  The `subscription`, `order`, `customer`, `plan_invitation`, `pricing_tier`,
  `webhook_event`, and `support_request` tables are dropped by a migration;
  `organization`/`organization_member` remain and are now available to everyone.
  The `/superadmin` panel keeps its overview and user administration.
- Removed the obsolete hosted marketing, competitor, use-case, legal, SEO, and
  prerendering surface. Core public status pages, auth, and monitor sharing
  remain.
- Removed unused scaffolding, UI components, one-off scripts, and direct package
  dependencies that are not required at runtime.

### Security

- Notification-channel targets and custom header values are now encrypted at
  rest with AES-256-GCM. Channel APIs expose only masked presence metadata, and
  startup atomically upgrades legacy plaintext rows before accepting traffic.
- Banning an account now revokes its live API keys as well as its sessions;
  Bearer-key resolution independently rejects banned owners, and unbanning an
  account never reactivates old keys.
- Added owner constraints directly to monitor, history, incident, status-page,
  SLA/statistics, share-clone, and REST service queries. Foreign and missing
  incident identifiers are indistinguishable, and status-page monitor-set
  replacement is atomic.
- Notification delivery failures now retain only HTTP status codes, never
  provider-controlled response text that could contain sensitive data.
- **Opt-in SSRF egress filtering.** Outbound requests to user-controlled URLs — monitor
  HTTP checks, TLS certificate probes, and webhook/Slack/Discord notifications — now route
  through a new `apps/server/src/lib/ssrf.ts` guard. Set `BLOCK_PRIVATE_TARGETS=true` to
  reject targets that resolve to loopback, private, link-local (including the
  `169.254.169.254` cloud-metadata endpoint), unique-local, or CGNAT addresses, with each
  redirect hop re-validated so a public host cannot redirect inward. Off by default so
  self-hosted internal monitoring is unaffected; recommended for instances that expose
  signup to untrusted users.

### Added

- Added a localized corresponding-source link to every web route. Source builds
  can set `VITE_SOURCE_CODE_URL`, while release images link to their exact Git
  commit automatically.

- **Custom-domain status pages** — public status pages are now a first-class entity: create
  named pages (each with a per-user `slug`, title, description, optional logo), pick exactly
  which monitors each one shows, and publish independently. Reachable on the app host at
  `/status/:userId/:slug` (the migrated `default` page still backs the legacy
  `/status/:userId` URL). Attach **one custom domain** per page and prove ownership with a
  DNS **TXT** challenge at `_pulsy-verify.<domain>` (resolved over `dns/promises` — no
  outbound HTTP, so no SSRF surface); a verified + published page then serves at the root of
  that domain by `Host`. TLS for custom domains is the operator's reverse proxy (CNAME +
  cert; no in-app ACME). The public resolve exposes only the sanitized aggregate (monitor
  name/status/uptime/response-time, overall status, last-7-day incidents) — never URLs, TLS,
  channels, credentials, or owner identity. Page creation and custom domains are
  available to every account.
  Adds the `uptime_status_page` and `uptime_status_page_monitor` tables, the
  `uptimeMonitor.statusPage.*` sub-router (list/one/create/update/delete/setMonitors/
  attachDomain/verifyDomain/detachDomain) and the `public.statusPageBySlug` /
  `public.statusPageByDomain` resolvers. A migration backfills a `default` page for every
  user who had public monitors. **Behavior change:** the per-monitor "Show on status page"
  toggle is removed from the dashboard — page membership is managed from the Status Pages UI.

- **Monthly SLA reports (PDF + email)** — a new monitor-detail **SLA Report** tab renders an
  on-demand uptime/SLA report (uptime %, total/failed checks, average + p95 response time,
  incident roll-up, per-day series) and offers a one-click branded **PDF download** via an
  authenticated route (`GET /api/reports/sla/:id.pdf`). From the same tab, opt into a
  **monthly email** (per-monitor or account-wide) that ships the prior month's report as a
  PDF attachment on the 1st of each month through your configured email provider; a "Send now"
  control exercises the flow on demand. The PDF is generated with pure-JS `pdfkit` (no headless
  browser), every user value is HTML-escaped in the email body, and links derive from
  `PUBLIC_WEB_URL`. Available to every account. Adds the
  `uptime_sla_report_subscription` table, the `slaReport.*` tRPC sub-router
  (`data` + `subscription.list/upsert/remove/sendNow`), and a monthly `0 6 1 * *` cron job
  that checks the owner's configured sender before sending. **Breaking (internal tRPC):** the
  former `uptimeMonitor.monitor.slaReport` query moved to `uptimeMonitor.slaReport.data`.

- **Public REST API + API keys** — a first-party, versioned REST surface at `/api/v1` for
  managing uptime monitors programmatically (list / get / create / update / delete /
  check-now, plus read-only check logs, incidents, and stats — all cursor-paginated and
  scoped to the key owner). Authentication is a Bearer API key (`Authorization: Bearer
  pul_…`) created and revoked in the dashboard; the plaintext is shown exactly once and only
  its SHA-256 hash is stored, so a lost key is revoked and regenerated rather than recovered.
  Access is scoped to the key owner and available to every account.
  Requests are rate-limited per key (`API_RATE_LIMIT_PER_MIN`, default 60/min,
  with `X-RateLimit-*` and `Retry-After` headers); writes reuse the validated,
  owner-scoped dashboard services. Adds the `api_key` table, the custom Bearer
  auth middleware, the `apiKey.*` tRPC router (list/create/revoke/access) for the dashboard
  key manager, and an OpenAPI spec + reference under `docs/api/`. The surface can be disabled
  with `API_V1_ENABLED=false`.

- **Monitor sharing** — select monitors in the dashboard and generate an expiring share
  link (7 / 30 / 90 days). Anyone opening the link clones the monitor configurations into
  their own account: signed-in users get a selectable confirmation popup directly, and new
  users are routed through signup (token preserved in `?share=`) before landing on the same
  popup at `/share/:token`. Links are revocable from a new "Share Links" panel on the
  dashboard. Only monitor config (name, URL, method, expected status, timeout, interval,
  failure threshold, tags) crosses accounts — never history, incidents, notification
  channels, or credentials. Adds the `uptime_share_link` table, the `share.*` tRPC
  procedures, and the public `public.sharedLink` resolve endpoint.

#### Initial feature set

The first tagged release has not been published yet. The current development
snapshot also includes:

- **Uptime monitoring** — HTTP `GET`/`HEAD`/`POST` checks with configurable expected status,
  request timeout, and check intervals (30s / 60s / 5m / 10m / 30m / 1h). Up / down /
  degraded status with per-monitor consecutive-failure thresholds.
- **TLS expiry monitoring** — certificate expiry date and days-remaining tracking for HTTPS
  targets.
- **Incidents** — consecutive failures grouped into a single ongoing incident that resolves
  on recovery, with computed downtime duration.
- **Notifications** — email, generic webhook, Slack, Discord, and Telegram channels, with
  per-channel "notify on down" / "notify on recovery" / "notify on TLS expiry" toggles.
- **Encrypted application secrets** — Resend / SendGrid / SMTP credentials,
  notification targets, and custom notification-header values encrypted at
  rest with AES-256-GCM.
- **Public status pages** — named, independently publishable pages with selected
  monitors, customizable metadata, and optional custom domains.
- **Authentication** — better-auth email/password with sessions; every
  user-managed record is scoped by its owning `userId`.
- **Dashboards & charts** — uptime percentage, response-time history, and uptime bars.
- **Internationalization** — 5-language UI (English, Arabic, French, German, Spanish) with
  full RTL support for Arabic.
- **Fast monitor entry and bulk management** — quick add, bulk URL batches, a table-based
  monitor list, multi-select, and confirmation-gated bulk delete.
- **Docker deployment** — Compose stack (postgres + server + web) with a `Makefile` for
  common workflows, plus a seed for a demo user and example monitors.

[Unreleased]: https://github.com/SelmiAbderrahim/pulsy/compare/v0.1.0...master
[0.1.0]: https://github.com/SelmiAbderrahim/pulsy/releases/tag/v0.1.0
