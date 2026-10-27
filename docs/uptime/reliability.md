# Reliability goals and event context

## Steps

In monitor History, choose 24 hours, 7 days, 30 days or a custom local-time range within retained history. Refresh updates rolling windows. UTC daily trend rows show availability, observed coverage and measured request/resolution/connection duration. Heartbeat run duration is not request latency.

## Timezones

Monitor and incident timestamps follow Preferences → Account timezone, or browser timezone when selected. For custom ranges and annotation times, use the timezone indicated beside the inputs. SLA report periods and daily trends remain explicitly UTC; changing your display timezone does not move those report boundaries.

## Behavior

Duration-weighted availability counts Up time over observed time. Down and Degraded consume the downtime budget. It is separate from the successful-check ratio. Each newly recorded observation covers at most one configured interval, capped at seven days, and ends earlier at the next observation. Earlier history without a captured observation and gaps beyond that horizon remain unknown. Never-received heartbeat time is unknown. Heartbeat deadline states still determine actual health; these estimates do not infer continuous historical health from a stale sample.

Coverage shows how much of the selected time was observed. Unknown time supplies no downtime allowance. A fully observed 30-day window at 99.9% allows exactly 2,592 seconds (43 minutes 12 seconds) of downtime. Partial coverage reduces the allowance to eligible observed time. Zero observed time has no availability percentage or budget. Remaining budget cannot go below zero; excess is recorded separately.

## Goals and annotations

Optional goals do not change checking, alerts, measured health or existing SLA PDFs/monthly reports. Availability budgets use the current target as an explicit benchmark. Latency compliance uses the policy captured with each observation, counts valid Up/Degraded observations only, and includes exact equality. Changing goals creates a version; repeated identical settings do not. Earlier versions remain visible within retained history.

Maintenance adjustment is optional and separate from raw results. Only maintenance intervals captured by an enabled exclusion policy are removed; overlapping intervals count once. Alert snooze never removes measured time. Later schedule edits do not rewrite captured periods. With no eligible adjusted time, the adjusted percentage and budget are unknown. This operational view does not redefine an SLA contract.

## Private values and limits

Private timestamped annotations hold environment, version, a short description and an optional public HTTP(S) link without credentials, query or fragment. They are owner-only and never appear on public status pages. Known request secrets are redacted, but do not enter secrets into these fields. Markers show correlation, not a proven cause. Add only timestamps within retained history, up to the present; older items page in stable timestamp/ID order.

Export visible window downloads the exact operational measurement snapshot shown, including its window, as-of timestamp, coverage and policy. It is not an SLA PDF, monthly delivery or disaster-recovery backup. SLA PDFs and monthly reports are also available to every account.

Every account can use API keys with scope `read` for reads and `full` for writes. Use `Authorization: Bearer` with an account API key, never put a key in a URL.

## Example

Read: GET /api/v1/monitors/ID/reliability?from=2026-10-09T00%3A00%3A00.000Z&to=2026-10-10T00%3A00%3A00.000Z

Insert: POST /api/v1/monitors/ID/annotations with JSON {"at":"2026-10-10T00:00:00.000Z","environment":"staging","version":"v2","text":"Deployment observed","link":null}. Creation returns 201. GET the same annotations path with from/to and optional limit/cursor for private paging. Never put an API key in a URL.

Public history requires explicit owner enablement on a published page. It shows seven completed UTC days with raw availability, coverage, separately enabled maintenance adjustment and typed duration. The page requests all selected components once when expanded; each component panel mounts only when opened. Gaps remain unknown. Private names, URLs, notes, goals, monitor IDs and secrets are not projected. Request duration is not browser page-load time. This optional publication discloses availability and performance measurements: review that choice before enabling it.

Incident context pages all measured incidents overlapping the visible window. Durations clip at both boundaries, including already-open and later-recovered incidents. Cause summaries rank the newest 1,000 matching incidents by their summed durations; a partial-summary label appears above that bound, while pagination remains complete. Concurrent incidents may overlap, so these duration totals are not the availability calculation. Private causes are redacted using the current request configuration. Annotation timing alone does not establish an incident cause.

## Troubleshooting

Check the selected monitor, time window and saved settings first. Missing observations are not healthy results. After an error, keep your draft, correct the indicated field or prerequisite, then retry deliberately. For a stale preview, generate and review a fresh preview before applying.

## Related topics

- [Personal saved views and groups](/dashboard/help/saved-views)
- [Advanced HTTP checks](/dashboard/help/http-checks)
- [Public status-page communication](/dashboard/help/status-communication)
