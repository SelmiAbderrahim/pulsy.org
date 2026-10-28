# Security Policy

## Supported versions

Pulsy is pre-1.0 and has not published its first stable release. Security fixes
are applied to the default branch. This table should be updated when the first
versioned release is published.

| Version | Supported |
|---|---|
| Default branch | :white_check_mark: |
| Older commits and private forks | :x: |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report security issues privately by email to **security@pulsy.org**. Where possible, include:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept is ideal),
- affected version / commit,
- any suggested remediation.

You may also use GitHub's private vulnerability reporting if this repository has it enabled.

### What to expect

Reports are handled on a best-effort basis. We will acknowledge and triage them
as quickly as maintainer availability allows, coordinate a disclosure timeline,
and credit reporters in release notes unless they prefer anonymity.

Please give us a reasonable opportunity to remediate before any public disclosure.

## Scope and hardening notes

Pulsy is self-hosted, and application data is scoped to its owning account, so
much of its security posture depends on how you deploy and configure it.

- **Notification and email-provider secrets are encrypted at rest** using
  **AES-256-GCM**, with the key derived from your `ENCRYPTION_KEY` environment
  variable. This includes webhook/Slack/Discord/Telegram targets and custom
  header values. Secrets are never logged and are never returned to the client
  unmasked. On upgrade, Pulsy encrypts legacy plaintext notification-channel
  rows in one transaction before the HTTP listener starts.
- **Set a strong `ENCRYPTION_KEY`.** Generate it with `openssl rand -base64 32`. Treat it as
  a long-lived secret: rotating it makes previously stored encrypted secrets unrecoverable.
- **Set a strong `BETTER_AUTH_SECRET`.** This signs authentication sessions; generate it with
  `openssl rand -base64 32` and keep it secret.
- **Keep `.env` out of version control.** It is git-ignored by default — do not commit it,
  and do not bake secrets into images.
- **Terminate TLS at a reverse proxy** in production and serve Pulsy over HTTPS so session
  cookies are protected in transit.
- **Outbound network policy.** `MONITOR_ALLOW_PRIVATE_NETWORKS=true` is the OSS
  default, allowing private/LAN targets. Metadata and link-local destinations
  remain blocked in every mode. Set `MONITOR_ALLOW_PRIVATE_NETWORKS=false` when
  accounts should reach only public addresses; this also denies private,
  loopback, ULA and CGNAT destinations. Input checks, DNS pinned at the actual
  socket connection and a fresh check on every redirect defend against rebinding.
  `BLOCK_PRIVATE_TARGETS=true` is a deprecated alias used only when the new setting
  is absent. Startup logs the effective policy and warns when LAN access is
  allowed. Inspect stored destinations with `make audit-private-targets`; see
  [the operator guide](docs/self-hosting/ssrf.md).
- **Capability ingress is deliberately narrow.** Heartbeat and server-health
  credentials authenticate bounded, rate-limited routes; ordinary reads omit
  credentials. Suppress heartbeat access/error logs at every proxy, including
  the outer TLS proxy. Public status feeds expose published projections only;
  subscriber addresses are encrypted and confirmation/unsubscribe capabilities
  are redeemed only from JSON bodies. Configure `TRUST_PROXY_HOPS` for the actual
  trusted proxy chain so rate-limit identities cannot be spoofed.
- **Webhook signing keys never appear in server responses.** The browser creates
  the one-time key locally and sends it for encryption. Rotation replaces the
  key immediately and returns only an outcome. Receivers should verify HMAC-SHA256
  against the raw request body with a timing-safe comparison and deduplicate
  delivery IDs; see [the contract](docs/api/webhooks.md).
- **Database access** should be restricted to the application host/network; do not expose
  Postgres publicly.

### Out of scope

- Vulnerabilities that require a compromised host, a leaked `ENCRYPTION_KEY`/
  `BETTER_AUTH_SECRET`, or physical/administrative access.
- Issues in third-party dependencies that have no impact on Pulsy as configured (please
  report those upstream; we will still update pinned versions).
- Social-engineering and denial-of-service against your own deployment's reverse proxy/host.

Thank you for helping keep Pulsy and its users safe.
