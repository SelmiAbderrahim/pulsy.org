# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

- **Superadmin invitation links** — a new `Invitations` tab on `/superadmin` mints single-use
  links (`/invite/<token>`) that comp a chosen paid plan for **1 month or 1 year**. Each link
  carries an admin-only `label` for attribution, expires after 7/30/60/90 days if unclaimed,
  and can be soft-revoked (never deleted) while pending. Recipients claim through signup if
  needed — the auth flow carries only the token, never a redirect path. Claiming writes a
  time-boxed `subscription` row (`providerSubscriptionId = invite-grant-<id>`); when the grant
  lapses the account falls back to `free` at read time and the existing pricing/upgrade UI
  takes over. A real Polar purchase supersedes a live grant, a nightly job retires elapsed
  ones, and every claim notifies `SUPPORT_INBOX_ADDRESS` (silently skipped when unconfigured;
  a mail failure never blocks the grant). Adds the `plan_invitation` table, the
  `admin.invitations` sub-router, and one new `publicProcedure`,
  `billing.invitation.resolve`, whose payload is limited to
  `{ plan, grantDuration, expiresAt, status }`. No new environment variables.

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
  channels, credentials, or owner identity. Tier-gated: `maxStatusPages` now counts **pages**
  (not public monitors) and custom domains need the `customDomainStatusPages` entitlement —
  both **unrestricted by plan for self-hosters** when payments are off.
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
  `PUBLIC_WEB_URL`. Tier-gated to the Team plan when payments are on, and **free for
  self-hosters** because payments-off bypasses the plan guard. Adds the
  `uptime_sla_report_subscription` table, the `slaReport.*` tRPC sub-router
  (`data` + `subscription.list/upsert/remove/sendNow`), and a monthly `0 6 1 * *` cron job
  that re-checks each owner's entitlements before sending. **Breaking (internal tRPC):** the
  former `uptimeMonitor.monitor.slaReport` query moved to `uptimeMonitor.slaReport.data`.

- **Public REST API + API keys** — a first-party, versioned REST surface at `/api/v1` for
  managing uptime monitors programmatically (list / get / create / update / delete /
  check-now, plus read-only check logs, incidents, and stats — all cursor-paginated and
  scoped to the key owner). Authentication is a Bearer API key (`Authorization: Bearer
  pul_…`) created and revoked in the dashboard; the plaintext is shown exactly once and only
  its SHA-256 hash is stored, so a lost key is revoked and regenerated rather than recovered.
  Access is plan-gated — reads need `limited`, writes need `full` API access — so on a
  self-hosted instance with payments off the whole API works out of the box.
  Requests are rate-limited per key (`API_RATE_LIMIT_PER_MIN`, default 60/min,
  with `X-RateLimit-*` and `Retry-After` headers) and write paths reuse the same monitor-count
  and check-interval tier guards as the dashboard. Adds the `api_key` table, the custom Bearer
  auth middleware, the `apiKey.*` tRPC router (list/create/revoke/access) for the dashboard
  key manager, and an OpenAPI spec + reference under `docs/api/`. The surface can be disabled
  with `API_V1_ENABLED=false`.

- **Priority support** — an in-app Contact-support flow (header entry point) that captures
  a category + message, persists it to the new `support_request` table, and emails it to a
  configurable operator inbox (`SUPPORT_INBOX_ADDRESS`) via the operator's Resend
  credentials. Requests from plans with the `prioritySupport` entitlement (Pro/Team, and
  every self-hosted user through the compatibility entitlement row) are flagged, routed
  to an optional `SUPPORT_PRIORITY_INBOX_ADDRESS`, and subject-prefixed `[PRIORITY]`; the
  dialog and billing overview surface the tier and its stated response-time target (priority
  24h / standard 72h). Delivery is best-effort: with no inbox configured the request is
  still recorded and the UI says so. Adds the `support.*` tRPC router (`submit` + `info`).

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

[Unreleased]: https://github.com/SelmiAbderrahim/pulsy/commits/main
