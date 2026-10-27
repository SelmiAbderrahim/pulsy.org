# Heartbeat operation

Interval heartbeats monitor a job's reports rather than probing an endpoint.
Create **Add monitor → Job heartbeat** with an interval from 30 seconds to seven
days and grace from zero to seven days. Cron expressions are not accepted.
All accounts can create heartbeat monitors.

## Keep the ingress credential private

Create and rotate return a random 43-character token. Tokens are hashed for
lookup and encrypted at rest using `ENCRYPTION_KEY`. The signed-in owner can
explicitly reveal an encrypted token; older hash-only tokens require rotation.
Rotation revokes the previous token immediately without deleting history.
Ordinary polling omits token hashes, ciphertext and admission counters. Public
status pages and configuration exports never include tokens.

Heartbeat path URLs contain credentials. Before using them, exclude all
`/api/heartbeat` paths from access/error logs at every reverse proxy and tracing
layer, including failures and case variants. The bundled nginx configuration
already does this. Keep the URLs out of analytics, screenshots, tickets and
repositories; redact Authorization headers when using the header alternative.

## Send events

The public ingress accepts GET, HEAD and POST at either:

```text
/api/heartbeat/<token>/start
/api/heartbeat/<token>/success
/api/heartbeat/<token>/fail
```

or `/api/heartbeat/start`, `/api/heartbeat/success` and
`/api/heartbeat/fail` with `Authorization: Bearer <token>`. Use one credential
mechanism per request; combining a path token and Authorization is rejected.
Query parameters are rejected. A request may have no body; no content type is
needed for a bare ping.

For example, using the header endpoint:

```sh
curl --fail --silent --show-error --max-time 10 \
  -X POST "$PULSY_URL/api/heartbeat/success" \
  -H "Authorization: Bearer $PULSY_HEARTBEAT_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"runId":"nightly-42"}'
```

For a named run, send `start` with that same `runId` before success or failure.
For a simple completion signal, omit `runId`. The optional JSON object accepts
only `runId` and `metadata`. A run ID is 1–64 ASCII letters, digits, underscores,
dots, colons or hyphens. Metadata permits only `environment` and `version`, each
1–64 letters, digits, underscores, dots or hyphens. Do not send logs or private
job output. Declared JSON must contain a valid receipt object.

## Ingress bounds and responses

The Express route uses a raw-body limit of 10 KiB without decompression, before
the application's general JSON parser. Configure the proxy so it preserves
these bounds and never decompresses requests into an unbounded body.

Successful responses expose only an audited `outcome` and optional `runId`.
They never return monitor rows or credentials. Missing/malformed/unknown tokens,
missing monitors and unknown event paths use a uniform unavailable 404.

| Response | Action |
|---|---|
| 400 | Check fields, credential mechanism, query parameters and encoding. |
| 404 | Check the event path and current credential without logging either. |
| 409 | Send the matching named start before its completion. |
| 413 | Reduce the body below 10 KiB. |
| 429 or 503 | Respect `Retry-After` and avoid tight retry loops. |

Each token accepts up to 120 requests/minute. Additional ingress bounds are
1,200 requests/IP/minute, 12,000 requests/process/minute and 16 concurrent
receipt operations. Responses use `Cache-Control: no-store`. The ingress is a
token capability surface; it adds no public tRPC or account API access.

## Deadlines, history and recovery

The first success is due one interval after creation. At `expectedAt`, a
missing success becomes Late (Degraded); at `expectedAt + graceSeconds`, it
becomes Down and opens an incident. With zero grace it goes directly Down.
When a scan runs late, the recorded outage still starts at the grace deadline.
Start does not restore health or extend the deadline. Failure marks Down
immediately; success restores Up and starts a fresh interval.

Run duration measures received start-to-finish time, not HTTP latency. Repeated
receipts do not repeat a completed run's outcome; only recent IDs are retained,
so use a new ID for each new job. Check-success percentages count recorded
samples. Gaps are unknown in duration-based history, never invented successful
time. Raw check retention follows `CHECK_LOG_RETENTION_DAYS`, default 30 days.
Named-run deduplication retains at most 1,000 recent run IDs, pruning the oldest
100 when that bound is reached; it is not a permanent execution archive.

Pausing skips missing-heartbeat scans and notifications, but incoming events
can still record health. Resume rearms an existing deadline; pending/healthy
heartbeats receive a fresh interval. Existing Down/degraded health persists
until a genuine success, including a failed heartbeat whose deadline was cleared.
Maintenance suppresses alerts without fabricating recovery. Account timezone preferences
change display only. See the [heartbeat user guide](../uptime/heartbeat.md) for
the dashboard workflow.
