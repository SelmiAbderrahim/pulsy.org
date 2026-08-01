# Pulsy Public REST API

Pulsy exposes a first-party REST API for managing uptime monitors
programmatically. The machine-readable contract is
[`openapi.yaml`](./openapi.yaml) (OpenAPI 3.1); this page is the human guide.

- **Base URL:** `<your-deployment>/api/v1` — e.g. `https://status.example.com/api/v1`.
  Derive it from your instance's `PUBLIC_WEB_URL`.
- **Format:** JSON in, JSON out. All responses wrap the payload as
  `{ "data": … }`; errors are `{ "error": { "code", "message" } }`.

## Authentication

Every request carries a Bearer API key:

```
Authorization: Bearer pul_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Create keys in the dashboard at **Dashboard → API Keys** (`/dashboard/api-keys`).
The plaintext key is shown **once** at creation — copy it then. Pulsy stores only
a SHA-256 hash, so it can never show the key again; if you lose it, revoke it and
create a new one. Keys are revocable at any time and authenticate the REST API
only (never the dashboard session).

> An in-app version of this guide is available at **Dashboard → API Docs**
> (`/dashboard/api-docs`), translated into all supported languages.

## Access

Every account has full read and write access to the API — Pulsy has no plans or
per-key access levels. A key can do anything its owner can do in the dashboard.

## Rate limiting

Requests are limited **per key** in a fixed window
(`API_RATE_LIMIT_PER_MIN`, default `60`/min). Every response carries:

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
| 401 | `unauthorized` | Missing, malformed, invalid, or revoked key. |
| 404 | `not_found` | Monitor doesn't exist or isn't yours. |
| 422 | `validation_error` | Bad body or query parameters. |
| 429 | `rate_limited` | Per-key window exceeded. |

Messages are localized from the request's `Accept-Language` header (en, ar, fr,
de, es).

## Pagination

List endpoints are cursor-paginated: pass `?limit=` (1–100, default 20) and the
opaque `?cursor=` from the previous response's `nextCursor`. A `null`
`nextCursor` means there are no more pages.

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
| `POST` | `/monitors` | write | Create a monitor. → `201` |
| `GET` | `/monitors/{id}` | read | Get one monitor. |
| `PATCH` | `/monitors/{id}` | write | Update monitor config. |
| `DELETE` | `/monitors/{id}` | write | Delete a monitor (cascades history). |
| `POST` | `/monitors/{id}/check-now` | write | Run a check immediately (must be active). |
| `GET` | `/monitors/{id}/checks` | read | List check logs (paginated). |
| `GET` | `/monitors/{id}/incidents` | read | List incidents (paginated). |
| `GET` | `/monitors/{id}/stats?days=30` | read | Aggregate uptime/response-time stats. |

### Monitor object

```json
{
  "data": {
    "id": "V1StGXR8_Z5jdHi6B-myT",
    "name": "Marketing site",
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
`GET`, `HEAD`, or `POST`.

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

Status-page fields (`isPublic`, status-page title/description) are **not**
editable through the REST API — manage those in the dashboard.

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
