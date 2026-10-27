# Prometheus output

## Steps

`GET /api/v1/metrics` reads the authenticating account's stored monitor state.
Create a normal API key in [Develop → API keys](/dashboard/api-keys). Every account can scrape with an API key whose scope is `read` or `full`.
The endpoint reads only the authenticating account’s monitors.

## Scrape configuration

```yaml
scrape_configs:
  - job_name: pulsy
    scheme: https
    metrics_path: /api/v1/metrics
    static_configs:
      - targets: ['pulsy.example.com']
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/pulsy-api-key
    scrape_interval: 60s
```

Use your own deployment hostname. Store the token in the referenced file with
appropriate access; do not put it in URLs, committed config, or screenshots.
Rotate by creating a replacement key, updating the file, then revoking the old
key. This uses existing key expiry/revocation behavior.

## Behavior

| Gauge (prefix `pulsy_monitor_`) | Meaning |
| --- | --- |
| `status` | -1 unknown (pending or no valid last check); 0 down; 1 up; 2 degraded |
| `fresh` | 1 if active, health is known and last check age is 0 through twice the interval plus timeout, inclusive; a heartbeat must also have a stored deadline record and its next deadline no more than 10 seconds overdue; 0 otherwise |
| `active` | 1 checking enabled; 0 paused |
| `last_check_timestamp_seconds` | Last check Unix timestamp; NaN if missing |
| `duration_seconds` | Last HTTP request, DNS resolution or TCP connection duration in seconds; NaN if missing or a heartbeat; zero remains zero |
| `open_incident` | 1 when a measured incident is open; 0 otherwise |
| `tls_expiry_timestamp_seconds` | Last observed HTTP TLS certificate expiry Unix timestamp; NaN if unavailable or another monitor type |

Freshness does not rewrite stored measured health. A paused or stale monitor can
retain its last known status and duration. A certificate value is the last
observation, not a new handshake performed by scraping. DNS timings measure
resolution; TCP timings measure connection establishment, not application health.
Heartbeat duration is NaN because job run duration is not request or connection
timing. Heartbeat freshness reads an additional bounded owner-scoped deadline
batch and never runs the deadline worker. A null next deadline after a recorded
failure does not make that known Down state healthy. Pending, paused and
future-dated observations have freshness zero.

## Example queries

Select current known health explicitly:

```promql
pulsy_monitor_status{job="pulsy"} >= 0
  and on (job, instance, monitor_id) pulsy_monitor_fresh{job="pulsy"} == 1
```

## Private values and limits

Every series has only `monitor_id`, the stable account-local monitor ID. Monitor
names, URLs, tags, account identifiers, channels, and request data are excluded.
Scraping does not execute checks or return their bodies. One SQL query joins open
incidents to owned monitors; it does not scan history. Seven gauges per monitor,
1,000 monitors maximum per response; more than 1,000 returns 422. Larger
self-hosted installations can partition by a comma-separated `monitorIds`
selection (1–200 IDs per request). Foreign or nonexistent IDs return no series.
This is a per-request technical safety bound.

The existing API limit applies (default 60 requests per minute per key; 429
includes Retry-After). Invalid keys return 401, insufficient access 403, invalid
query 422. All responses use `private, no-store`; do not place an authenticated
scrape behind a shared public cache. A restart needs no exporter state recovery:
the next scrape reads the durable check/monitor/incident records.

## Troubleshooting

Check the selected monitor, time window and saved settings first. Missing observations are not healthy results. After an error, keep your draft, correct the indicated field or prerequisite, then retry deliberately. For a stale preview, generate and review a fresh preview before applying.

## Related topics

- [Personal saved views and groups](/dashboard/help/saved-views)
- [Advanced HTTP checks](/dashboard/help/http-checks)
- [Reliability goals and event context](/dashboard/help/reliability)
- [Public status-page communication](/dashboard/help/status-communication)
