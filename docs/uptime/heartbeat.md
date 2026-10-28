# Interval heartbeats

## Set up a heartbeat

Choose **Add monitor → Job heartbeat**. Enter a name, the expected interval and the extra grace period allowed before marking the job Down. The interval is 30 seconds to seven days; grace is zero to seven days. Pulsy expects interval-based signals, not cron expressions. Review the displayed next due time, grace deadline and timezone before saving.

Overview and Settings show a masked ping URL. Use Reveal or Copy URL deliberately; newly created and rotated tokens are encrypted at rest and recovered only for the signed-in owner. Older hash-only tokens cannot be recovered: rotate them in Settings to enable URL copying. Rotation invalidates the old token immediately without resetting history. Keep capability URLs out of logs, screenshots and committed files. The bundled nginx proxy excludes heartbeat paths from access and error logging regardless of case, including failed requests; configure the same exclusion on any external reverse proxy.

## Send a result

After a successful job, send the request below using your deployment address and token. The copied capability URL has the form `/api/heartbeat/{token}/success`. Replace `success` with `start` or `fail` for those events. GET, POST and HEAD are accepted; no body and no content type are needed. An optional JSON object (up to 10 KB) may carry `runId` and `metadata`. Dashboard examples include curl and wget. The header-authenticated endpoint below also remains supported; do not combine a token URL and an Authorization header. Send to `/api/heartbeat/fail` when the job fails. To measure run duration, send `/api/heartbeat/start` before the job and `/api/heartbeat/success` or `/api/heartbeat/fail` afterwards. Use the same `runId` on start and finish when runs may overlap or retry.

```sh
curl -fsS -m 10 --retry 3 "$PULSY_SERVER/api/heartbeat/$PULSY_HEARTBEAT_TOKEN/success"
```

```sh
curl -fsS -m 10 --retry 3 -X POST "$PULSY_SERVER/api/heartbeat/success" \
  -H "Authorization: Bearer $PULSY_HEARTBEAT_TOKEN" \
  -H 'Content-Type: application/json' -d '{"runId":"nightly-42"}'
```

## Understand the result

New means no successful result has arrived; it does not mean healthy. The first success is due one interval after creation. A missing success becomes Late at the due time, then Down at the grace deadline. With no grace it goes directly Down. A success restores Up and starts a new interval. A failure marks Down immediately. Starting a run does not extend the deadline or restore health.

Late does not open an incident; Down does. One timeline is used everywhere: **Expected at** is when the ping was due (Late begins), **Grace ends** is `expectedAt + graceSeconds` — the moment the monitor is declared Down and the incident's start time — and **Alert sent at** is when the first outage alert was delivered. If the deadline scanner runs late, the incident, history entry and alert still use the grace end, not the later scan time. Timestamps use the account timezone, or browser timezone when selected in Preferences.

Run duration measures time between received start and finish events, not HTTP latency. A simple success without a run keeps the previous duration, or leaves it unknown. Check success is the ratio of recorded samples, not continuous observed availability. Repeated same-state receipts can be sampled once per interval.

## Private values and limits

Send a JSON object, at most 10 KiB. Optional `runId` accepts up to 64 ASCII letters, digits, underscores, dots, colons or hyphens. Optional metadata accepts only `environment` and `version`, each up to 64 letters, digits, underscores, dots or hyphens. Do not send logs or private job output. Repeated receipt IDs are handled without repeating the outcome; a terminal ID needs an existing start. Only recent run IDs are retained, so use new IDs for new jobs.

Pausing skips missing-heartbeat checks and notifications; received results can still record health. Maintenance pauses alerts while health continues. Import / export transfers configuration without tokens or history; HTTP templates and configuration share links do not copy heartbeats.

## Troubleshooting

For 404, check the endpoint and current token. For 400, check the JSON fields; for 413, reduce its size. For 409, send a start with the matching run ID before its result. For 429 or 503, respect `Retry-After`; each token permits up to 120 requests per minute. If a job remains Late or Down, compare its last successful receipt with the displayed deadline and check that the job actually sent a success.

## Related topics

- [Personal saved views and groups](/dashboard/help/saved-views)
- [Advanced HTTP checks](/dashboard/help/http-checks)
- [Reliability goals and event context](/dashboard/help/reliability)
- [Public status-page communication](/dashboard/help/status-communication)
