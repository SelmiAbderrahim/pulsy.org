# Advanced HTTP checks

## Steps

Quick add keeps its GET defaults. In New monitor or Settings, expand **Advanced HTTP checks** to add assertions and private request values. Every enabled rule must pass against the same response; one assertion set never creates extra HTTP probes. Advanced redirect handling can make up to six requests, including the original request.

## Behavior

Supported rules are body contains/not-contains, header equals/contains, and JSON exists/equals/not-equals/less-than/at-most/greater-than/at-least. JSON paths start with `$`, followed by dotted ASCII keys or numeric array indexes, for example `$.status` and `$.jobs[0].depth`. Quoted keys, wildcards, scripts, prototype keys and expressions are rejected. Enter JSON expected values as `"ok"`, `0`, `false`, `null` or a flat array of these values. Missing differs from null, false, zero, empty text and an empty array. A missing field fails every comparison, including not-equals. Numeric comparisons never coerce strings. Invalid JSON fails enabled JSON assertions.

## Example

For example, HTTP 200 AND `$.status` equals `"ok"` AND `$.queueDepth` less than `100` requires all three conditions. HTTP 200 with `{"status":"error"}` is Down when the status assertion is enabled. Advanced configuration treats an unacceptable HTTP status as Down. Legacy monitors without advanced configuration retain their existing expected-status behavior, including Degraded for unexpected sub-400 responses. Timing measures this HTTP request, not browser page load.

## Private values and limits

Private headers, Basic/Bearer authentication and POST body values are encrypted together with the existing `ENCRYPTION_KEY`. They cannot be retrieved through the editor. Retain leaves the payload untouched; Replace requires re-entry and removes omitted values; Clear removes the entire payload. An omitted API `requestConfig` retains it, `null` clears it, and an object replaces it. Do not put credentials into URLs or assertion values. URL credentials are rejected on new/edited configurations. Bodies require POST. Changing away from POST requires deliberately clearing or replacing the stored body.

Headers have unique case-insensitive names. Transport headers such as Host, Content-Length, Connection and Transfer-Encoding cannot be overridden. At most 20 headers, 16 KiB of encoded header configuration, 4,096 characters per value and 64 KiB of UTF-8 body data are accepted. Basic usernames cannot contain a colon. Request values are excluded from status pages, sharing and REST/owner projections. Configuration share links omit advanced settings. Templates and native manifests can carry supported non-secret assertions and latency settings; private request values remain excluded.

For monitors with private request values, assertions or a non-default redirect policy, Follow revalidates each redirect against the existing network policy, stops after five hops, and removes all configured headers/authentication when the origin changes. Cross-origin 307/308 redirects with a body are rejected; 301/302 POST and 303 (except HEAD) change to GET without a body. Inspect returns the first response; Reject makes redirects fail. Legacy HTTP checks also validate each redirect destination. HTTP(S) targets reject unspecified, metadata and link-local addresses in every deployment. Private and internal targets (loopback, RFC1918, CGNAT, unique-local, `localhost`, `*.internal`, single-label service names) are allowed by default with `MONITOR_ALLOW_PRIVATE_NETWORKS=true`. Set it to `false` to block these targets when saving or importing a monitor and again at connection time. HTTP connections always use validated DNS answers at connection time.

Body/JSON rules read at most 512 KiB of decompressed response bytes. JSON parsing accepts depth 16 and 10,000 nodes. Header-only rules do not read response bodies. HEAD body rules fail as unread rather than pretending an empty body was observed. The configured timeout remains active through body reads. Oversized/unread bodies have distinct outcomes. Full bodies and actual assertion response values are never stored; check logs retain only rule indexes, pass/fail and bounded reason codes.

## Test without saving

**Test configuration without saving** performs one explicit probe, without scheduling, writing history or changing current health. It uses the same checker and effective configuration as saving the monitor. POST may have side effects and requires explicit confirmation. Save never probes automatically.

Every account can use API keys with scope `read` for reads and `full` for writes. Use `Authorization: Bearer` with an account API key, never put a key in a URL.

## Failure and recovery

A failed assertion produces a safe cause such as `Assertion 1: mismatch`, opens the ordinary measured incident after the existing failure threshold, and uses existing notifications and maintenance suppression. It does not publish a public announcement or change uptime definitions. Encrypted payload corruption requires re-entry with the configured encryption key; do not replace or rotate that key without preserving existing secrets.

## Troubleshooting

Check the selected monitor, time window and saved settings first. Missing observations are not healthy results. After an error, keep your draft, correct the indicated field or prerequisite, then retry deliberately. For a stale preview, generate and review a fresh preview before applying.

## Related topics

- [Personal saved views and groups](/dashboard/help/saved-views)
- [Reliability goals and event context](/dashboard/help/reliability)
- [Public status-page communication](/dashboard/help/status-communication)

## Monitor addresses

Create monitor, Quick add and Bulk add accept a bare hostname such as `example.com` and show the normalized `https://example.com/` address. A missing name uses the hostname. Duplicate detection compares canonical addresses against your existing monitors and the current batch, including trailing-slash equivalents, and identifies the existing monitor by name. Query strings remain significant. New monitors default to three consecutive failures; saved thresholds remain unchanged.

## Accepted statuses and TLS

Expected status accepts `200,204`, `2xx` and `200–299`, including combinations. Every code must be between 100 and 599; ranges must ascend. The same rule applies to ordinary and advanced checks. A single code keeps the previous behavior. Settings includes a TLS certificate monitoring switch: turning it off stops expiry checks and alerts and clears the stored certificate result. HTTPS transport verification stays enabled. Templates and configuration exports retain these settings.

Shared configurations also retain accepted-status rules and the TLS monitoring setting, without certificate observations or credentials. Cloning a share checks canonical URLs against your existing monitors and the selected batch, including your own shares.

## Names and saving

Name is optional when creating an HTTP monitor: leaving it empty uses the URL hostname. DNS, TCP, server and heartbeat monitors, and saved templates, require a name. Save in edit forms stays disabled until values differ from the saved version. Restoring the original values removes the unsaved-change warning. Invalid fields show an inline message and a form summary; submitting focuses the first invalid field. Failed saves retain your draft.
