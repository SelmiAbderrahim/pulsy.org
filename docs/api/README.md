# Pulsy Public REST API

Pulsy exposes a first-party REST API for managing uptime monitors
programmatically. The machine-readable contract is
[`openapi.yaml`](./openapi.yaml) (OpenAPI 3.1); this page is the human guide.

- **Base URL:** `<your-deployment>/api/v1` — e.g. `https://status.example.com/api/v1`.
  Derive it from your instance's `PUBLIC_WEB_URL`.
- **Format:** JSON in, JSON out. Monitor and monitor-data responses wrap the
  payload as `{ "data": … }`; configuration responses return their result directly,
  and `/metrics` returns Prometheus text. Errors use
  `{ "error": { "code", "message" } }`. Public status and subscription routes
  described below have separate authentication and response shapes.

## Authentication

Every request carries a Bearer API key:

```
Authorization: Bearer pul_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Create keys in the dashboard at **Dashboard → API Keys** (`/dashboard/api-keys`).
The plaintext key is shown **once** at creation — copy it then. Pulsy stores only
a SHA-256 hash, so it can never show the key again; if you lose it, revoke it and
create a new one. Keys authenticate the REST API only; dashboard key management
uses your signed-in session.

Choose `read` or `full` scope at creation. Dashboard creation defaults to `read`;
keys created before scopes were introduced retain `full`. An optional expiry
selects a UTC calendar date strictly after today and expires at
`23:59:59.999 UTC` on that date. Omit it for no expiry. Expired, revoked, removed
keys and keys whose owner is missing or banned return `401`. Banning an account
also revokes its live keys; unbanning does not restore revoked keys.

Revoke a key to stop its use immediately. A revoked key can then be removed from
the dashboard list; removal retains its audit timestamps and never reactivates
it. Expired keys must also be revoked before removal. Every account has the same
technical ceiling of **20 live, unexpired keys**, bounding the number of
independent per-key rate-limit buckets. Expired and revoked keys do
not consume this ceiling.

> An in-app version of this guide is available at **Dashboard → API Docs**
> (`/dashboard/api-docs`), translated into all supported languages.

## Access

Every account can use the entire API. `read` and `full` keys can read owned
resources; writes require `full`. A `read` key calling a write endpoint returns
`403`. Scope is a credential permission, selected by the owner, and all
operations remain available to every account. An API key cannot administer
other accounts or authenticate the dashboard session.

## Rate limiting

Requests are limited **per key** in a fixed window
(`API_RATE_LIMIT_PER_MIN`, default `60`/min). Responses after successful key
authentication carry the following headers; `401` responses do not:

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | Requests allowed per window. |
| `X-RateLimit-Remaining` | Requests left in the current window. |
| `X-RateLimit-Reset` | Unix epoch (seconds) when the window resets. |
| `Retry-After` | On `429` only — seconds to wait. |

> The limiter is in-memory and per-replica. Pulsy runs a single server process,
> so this is exact; a horizontally-scaled deployment would need a shared store.

## Errors

All errors share one shape:

```json
{ "error": { "code": "not_found", "message": "Monitor not found" } }
```

| HTTP | `code` | When |
|---|---|---|
| 401 | `unauthorized` | Missing, malformed, invalid, expired, revoked or removed key; unavailable owner. |
| 403 | `forbidden` | Key scope does not permit this operation. |
| 404 | `not_found` | Monitor doesn't exist or isn't yours. |
| 409 | `conflict` | Configuration changed since preview; preview again. |
| 422 | `validation_error` | Bad body or query parameters. |
| 400 / 413 / 415 | `validation_error` | Malformed JSON, oversized body, or unsupported body encoding/charset. |
| 429 | `rate_limited` | Per-key window exceeded. |

Messages are localized from the request's `Accept-Language` header (en, ar, fr,
de, es).

## Pagination

List endpoints are cursor-paginated: pass `?limit=` (1–100, default 20) and the
opaque `?cursor=` from the previous response's `nextCursor`. Annotation lists
use a default limit of 25 and also require `from` and `to`. A `null` `nextCursor`
means there are no more pages. Treat cursors as opaque values, not stable IDs.

```
GET /api/v1/monitors?limit=50
→ { "data": [ … ], "nextCursor": "MjA" }
GET /api/v1/monitors?limit=50&cursor=MjA
→ { "data": [ … ], "nextCursor": null }
```

## Endpoints

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/monitors` | read | List your monitors (paginated). |
| `POST` | `/monitors` | full | Create a monitor. → `201` |
| `GET` | `/monitors/{id}` | read | Get one monitor. |
| `PATCH` | `/monitors/{id}` | full | Update monitor config. |
| `DELETE` | `/monitors/{id}` | full | Delete a monitor (cascades history). |
| `POST` | `/monitors/{id}/check-now` | full | Run a check immediately (must be active). |
| `GET` | `/monitors/{id}/checks` | read | List check logs (paginated). |
| `GET` | `/monitors/{id}/incidents` | read | List incidents (paginated). |
| `GET` | `/monitors/{id}/stats?days=30` | read | Aggregate check-success/response-time stats. |
| `GET` | `/monitors/{id}/reliability?from=…&to=…` | read | Observed availability, coverage and error budget. |
| `GET` | `/monitors/{id}/annotations?from=…&to=…` | read | List private deployment/change annotations. |
| `POST` | `/monitors/{id}/annotations` | full | Add a private annotation. → `201` |
| `GET` | `/metrics` | read | Stored-state [Prometheus exposition](./prometheus.md). |
| `POST` | `/configuration/export` | read | Export selected monitor configuration. |
| `POST` | `/configuration/preview` | read | Review a native manifest without changing anything. |
| `POST` | `/configuration/apply` | full | Apply with the previewed `revision`. |

Here, **read** accepts either scope; **full** requires a `full` key.

### Monitor object

```json
{
  "data": {
    "id": "V1StGXR8_Z5jdHi6B-myT",
    "name": "Public site",
    "monitorType": "http",
    "url": "https://example.com",
    "method": "GET",
    "expectedStatus": 200,
    "timeout": 10000,
    "interval": 300,
    "failureThreshold": 3,
    "active": true,
    "status": "up",
    "httpStatus": 200,
    "responseTime": 142,
    "lastCheckedAt": "2026-06-20T10:00:00.000Z",
    "nextCheckAt": "2026-06-20T10:05:00.000Z",
    "tlsExpiresAt": "2026-09-01T00:00:00.000Z",
    "tlsExpiresInDays": 73,
    "consecutiveFailures": 0,
    "uptimePercentage": 99.98,
    "tags": ["prod"],
    "createdAt": "2026-06-01T09:00:00.000Z"
  }
}
```

### Create a monitor

`interval` must be one of `30, 60, 300, 600, 1800, 3600` seconds. `method` is
`GET`, `HEAD`, or `POST`. Omit `name` or leave it empty to use the destination
hostname.

```bash
curl -X POST https://status.example.com/api/v1/monitors \
  -H "Authorization: Bearer pul_…" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "API health",
    "url": "https://api.example.com/health",
    "method": "GET",
    "expectedStatus": 200,
    "interval": 60,
    "tags": ["api", "prod"]
  }'
```

Status-page fields (`isPublic`, status-page title/description) are managed in
the dashboard. HTTP request headers, body and authentication are write-only
`requestConfig` fields: monitor reads show only `requestConfigured`, never their
values. `httpAssertions`, `redirectPolicy` and `latencyPolicy` are documented in
the [OpenAPI schemas](./openapi.yaml) and [HTTP guide](../uptime/http-checks.md).

Optional `expectedStatuses` accepts comma-separated codes (`"200,204"`), classes
(`"2xx"`) and ascending ranges (`"200-299"`), including combinations up to 128
characters and codes 100–599. It takes precedence over numeric `expectedStatus`.
Send `null` to restore the numeric rule; updating only `expectedStatus` clears a
previous expression. `tlsMonitoringEnabled` defaults to `true`. Disabling it
clears saved certificate observations and stops certificate-expiry checks and
alerts, while HTTPS transport verification remains enabled.

### Observed reliability and annotations

`GET /monitors/{id}/reliability?from=…&to=…` requires ISO 8601 timestamps with an
offset, with `to` after `from`. The requested span must be at most 730 days and
no longer than the operator's `CHECK_LOG_RETENTION_DAYS` (default 30). The end is
clipped to the request time and observations before retention stay unknown.
Inspect `retainedFrom`, `retentionClipped` and `boundaryLimited` when interpreting
partial evidence.

The `{data}` result contains duration totals in milliseconds, daily UTC `series`,
`raw` availability and coverage, optional `maintenanceAdjusted` totals, error
budget measures, and the captured measurement policy. Availability is
`upMs / observedMs`; coverage measures how much of the window was observed.
Down and degraded time consume the error budget. Gaps never count as healthy.
This differs from the per-check success ratio in `/stats` and the monitor's
rolling 30-day `uptimePercentage`. See [reliability](../uptime/reliability.md) and
[check success versus availability](../uptime/check-success-and-availability.md).

`GET /monitors/{id}/annotations` uses the same `from`/`to` window format and
returns `{data, nextCursor}`, newest first, with `limit` 1–100 (default 25).
Create an annotation with a `full` key:

```json
{
  "at": "2026-10-20T12:00:00.000Z",
  "environment": "production",
  "version": "2026.10.20",
  "text": "Deployment completed",
  "link": "https://example.com/releases/2026-10-20"
}
```

`at` and `text` are required; `environment` and `version` default to empty
strings, and `link` defaults to `null`. `at` must not be in the future or outside
retention. Text is at most 1,000 characters; environment/version at most 100
each. Links must be HTTP(S), without credentials, query or fragment. Configured
secret values are redacted. The technical storage bound is 1,000 annotations per
monitor. These markers are private; adding one neither changes measured health
nor publishes it to status pages or feeds.

### Configuration and other monitor types

`POST /monitors` creates HTTP monitors. Native manifests also create and update
DNS, TCP, heartbeat and Linux server monitors. Their exact version-1 schemas and
an example containing all five types are in [openapi.yaml](./openapi.yaml).
Select existing owned monitors for export:

```json
{ "monitorIds": ["owned-monitor-id"] }
```

`POST /configuration/export` returns `{manifest, warnings}` directly. Export
supports HTTP, DNS, TCP and heartbeat monitors; Linux server export is rejected.
Imported server entries remain supported. Maximum selection/manifest size is
200 monitors; manifest JSON is bounded to 256 KiB, depth 16 and 20,000 values.
Configuration request bodies allow up to 1 MiB of uncompressed JSON.

Review before applying. `manifest.json` contains the native manifest:

```bash
# Preview using a read or full key. JSON-encode the file contents.
jq -n --rawfile text manifest.json '{text: $text}' > preview-request.json
curl -X POST "$PULSY_URL/api/v1/configuration/preview" \
  -H "Authorization: Bearer $PULSY_API_KEY" \
  -H 'Content-Type: application/json' --data-binary @preview-request.json
# → { "manifest": { … }, "warnings": [ … ], "revision": "<64 hex characters>",
#     "counts": { "create": 1, "update": 0, "unchanged": 0, "rejected": 0 },
#     "entries": [ … ] }

# Apply the same text and the reviewed revision using a full key.
jq -n --rawfile text manifest.json --arg revision "$REVISION" \
  '{text: $text, revision: $revision}' > apply-request.json
curl -X POST "$PULSY_URL/api/v1/configuration/apply" \
  -H "Authorization: Bearer $PULSY_API_KEY" \
  -H 'Content-Type: application/json' --data-binary @apply-request.json
# → { "counts": { "create": 1, "update": 0, "unchanged": 0, "rejected": 0 } }
```

Set `PULSY_URL` to your deployment origin and `REVISION` to the preview's exact
returned revision. Stable account-local `key` values match monitors; `previousKey`
performs an explicit rename. Apply is atomic, never deletes absent entries and
returns `409` if the reviewed configuration or references changed. Ordinary
health observations do not invalidate the preview. A rejected entry leaves all
entries unapplied.

Manifests omit request secrets, recipients, subscription data and credentials;
`needsReentry` and `warnings` explain missing setup. New heartbeat/server imports
stay paused until explicit token/credential setup and activation in the
dashboard. Existing passive-monitor activation is retained. DNS/TCP checks use
the regular configured intervals; heartbeats expect a 30–604800 second period,
and server reporting intervals are integers from 60–3600 seconds. Agent
credentials and heartbeat capabilities never travel through API-key endpoints.

Read endpoints, deletion and pause/resume (`PATCH` with `active`) support every
monitor type. Passive heartbeat/server monitors reject `check-now`; use the
manifest flow for type-specific configuration. See [configuration portability](../uptime/configuration-portability.md),
[DNS/TCP](../uptime/dns-tcp.md), [heartbeats](../uptime/heartbeat.md) and
[server monitoring](../uptime/server-monitoring.md).

### Notification channels and webhooks

Create Email, Webhook, Slack, Discord and Telegram channels and email providers
in the dashboard. API clients reference owned channels by `channelIds` on HTTP
creation and manifests; unknown/foreign IDs return `404`. Omitted manifest
`channelIds` retain bindings; `[]` clears them. Account-wide defaults apply to
every monitor, without a per-monitor opt-out.

Channel destinations, custom-header values and provider credentials are
write-only; routine dashboard responses expose presence flags, masked targets
and header names. No REST response or export contains the secrets. Generic
Webhook channels send the signed [webhook contract v1](./webhooks.md); their
browser-generated signing secret is shown locally only on explicit creation
or rotation. The server never returns its plaintext or ciphertext; see the
webhook guide for the write-only credential contract.

### Prometheus

`GET /metrics` returns private Prometheus text exposition, not a JSON envelope.
It reads stored state without running probes. Seven gauges per monitor use only
`monitor_id` labels. Unknown/pending status is `-1`, down `0`, up `1`, degraded
`2`; use `pulsy_monitor_fresh` separately to exclude stale or paused data.
Durations are seconds, timestamps Unix seconds, and unavailable values are
`NaN` (including heartbeat/server request durations).

At most 1,000 monitors are returned per scrape. Larger installations can select
1–200 owned IDs using comma-separated `monitorIds`; missing/foreign IDs yield
no series. Responses use `Cache-Control: private, no-store` and the usual
per-key limit. See the [scrape configuration and complete gauge reference](./prometheus.md).

### Published status feeds and email subscriptions

These routes are outside `/api/v1`. They use public-page identifiers or
page-bound capabilities, not account API keys or dashboard cookies.

A published page exposes `/api/status/pages/{publicKey}/status.json`,
`history.json`, `badge.svg`, `feed.rss` and `feed.atom`. `publicKey` is a
non-secret identifier. `status.json` is version 1; `history.json` additionally
requires explicit public-history enablement. Missing/draft/unavailable pages
return uniform `404` responses. GET responses allow CORS `*`, use `no-store`
and reject query parameters. They contain only published projections, excluding
private monitor URLs/request settings, subscribers and internal notes.

Subscriptions must be enabled with the owner's usable verified mail provider.
Both POST routes require `Origin` matching the deployment or configured/verified
page origin, `Content-Type: application/json` and at most **16 KiB uncompressed**
JSON. Query parameters are rejected. They share the public feeds' **240 requests
per IP per minute** budget; `429` and temporary `503` responses include
`Retry-After`.

| POST path | JSON body | Meaning |
|---|---|---|
| `/api/status/pages/{publicKey}/subscribe` | `{"email":"reader@example.com","componentIds":[],"language":"en"}` | Request confirmation; empty component selection follows the whole page. |
| `/api/status/pages/{publicKey}/subscription` | `{"action":"confirm","token":"<43-character capability>"}` | Confirm the chosen subscription. |
| `/api/status/pages/{publicKey}/subscription` | `{"action":"unsubscribe","token":"<43-character capability>"}` | Unsubscribe; remains usable after unpublication. |

Valid submissions return neutral `202 {"outcome":"accepted"}` without revealing
whether an address is registered or a token had an effect. `language` defaults
to `en` and accepts `en/ar/fr/de/es`; selected component IDs must belong to that
page. Capabilities are accepted **only in the JSON body**, never in a query
string, path, Authorization header or GET request. Email action links carry a
fragment removed before analytics/router initialization; visiting a link alone
does nothing. Confirmation requires an explicit action within 24 hours; another
confirmation request becomes eligible after 15 minutes. Old tokens cannot alter
a later confirmed opt-in. Subscriber addresses and recoverable token material
remain encrypted; lookup hashes and private counts are never public. See [public status communication](../uptime/status-communication.md).

Heartbeat ingress at `/api/heartbeat/…` uses a heartbeat capability; agent
metrics at `/api/agent/v1/metrics` use a server-agent Bearer credential. Neither
accepts an account API key. Follow the linked heartbeat/server guides for those
contracts; keep their capabilities out of logs and URLs shown to others.

## Examples

```bash
# List monitors
curl https://status.example.com/api/v1/monitors \
  -H "Authorization: Bearer pul_…"

# Trigger an immediate check
curl -X POST https://status.example.com/api/v1/monitors/$ID/check-now \
  -H "Authorization: Bearer pul_…"

# Last 7 days of stats
curl "https://status.example.com/api/v1/monitors/$ID/stats?days=7" \
  -H "Authorization: Bearer pul_…"
```

## OpenAPI spec

The full contract lives at [`docs/api/openapi.yaml`](./openapi.yaml). Import it
into Postman/Insomnia, or generate a client with `openapi-generator`.
