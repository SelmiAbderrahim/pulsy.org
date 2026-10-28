# Webhook contract v1

Generic Webhook channels POST signed JSON to the configured destination. Slack,
Discord and Telegram use their vendor-specific payloads. Configure channels in
the dashboard; REST clients reference owned channel IDs rather than submitting
destinations or signing secrets through `/api/v1`.

## Signing credential lifecycle

The dashboard generates 32 cryptographically random bytes in the browser,
encodes them as **64 lowercase hexadecimal characters**, and submits the secret
as write-only input. Save the local one-time copy in your receiver's secret
store. Closing the dialog clears that displayed copy; the server cannot reveal
it later. **Rotate secret** generates a replacement locally and submits it
explicitly. Future dispatches use the replacement; an already-started dispatch
may still complete attempts with its previous secret.

Dashboard session-authenticated tRPC operations use these inputs:

| Operation | Signing input | Response |
|---|---|---|
| `uptimeMonitor.channel.create` | Optional `signingSecret` on a Webhook, alongside monitor/channel configuration. | Masked channel only. |
| `uptimeMonitor.channel.createDefault` | Optional `signingSecret` on an account-wide Webhook. | Masked channel only. |
| `uptimeMonitor.channel.rotateSecret` | Required `{ "channelId": "owned-channel-id", "signingSecret": "<64 lowercase hex characters>" }`. | `{ "rotated": true }`. |

Provided signing secrets must match `^[a-f0-9]{64}$`; non-Webhook channels reject
them. Omission on creation preserves compatibility by generating an encrypted
random server-side key, which is never returned. Rotate with a locally generated
secret before configuring a receiver when no consumer copy is available. Legacy
Webhook channels acquire an encrypted signing key when first needed and can be
rotated the same way. These operations require the owner's dashboard session;
an account API key cannot manage channels or rotate their signing credentials.

Targets and each custom-header value are stored independently with
AES-256-GCM using `ENCRYPTION_KEY`, with `secretVersion: 1` on the stored row.
The signing secret has its own encrypted `signingSecretCipher`. Ordinary
responses expose only target presence/masking and custom-header names; **no
channel response returns signing plaintext, ciphertext, custom-header values or
the storage-version marker**, including create and rotate responses. Provider
credentials, signing secrets and destination tokens are redacted from delivery
errors. Exports carry channel IDs only.

## Payload

```json
{
  "version": 1,
  "id": "7a05d739-2ab9-81f7-9aa5-123456789abc",
  "event": "monitor.down",
  "test": false,
  "timestamp": "2026-10-20T10:00:00.000Z",
  "monitor": {
    "id": "monitor-id",
    "name": "API",
    "url": "https://example.com",
    "type": "http"
  },
  "reason": { "code": "connection_refused", "message": "Connection refused" },
  "incident": {
    "id": "incident-id",
    "startedAt": "2026-10-20T10:00:00.000Z",
    "url": "https://pulsy.example.com/dashboard/incidents?incidentId=incident-id"
  }
}
```

Required fields are `version`, `id`, `event`, `test`, `timestamp` and `monitor`.
`version` is `1`. `id` is a stable UUID for the logical channel/event delivery,
constructed from a SHA-256 digest with UUID version 8 and RFC variant bits.
Different channels or event identities produce different IDs. Treat this ID as
opaque and use it for deduplication. `timestamp` is the event's stored timestamp,
not the send/retry time. Monitor types are `http`, `dns`, `tcp`, `heartbeat` and
`server`; passive heartbeat/server monitors have an empty monitor URL.

| Event | Meaning |
|---|---|
| `monitor.down` | A Down transition. |
| `monitor.up` | Recovery to Up. |
| `monitor.degraded` | A Degraded transition. |
| `monitor.tls_expiring` | Eligible certificate-expiry warning. |
| `test` | Explicit Send test; `test: true`. |

`reason`, when present, contains a stable `code` and human-readable `message`.
Down/degraded/TLS events include it; recovery includes it when supplied. Check
failures use the shared check-error taxonomy, TLS warnings use `tls_expiring`,
server-health events use `server_health`, and unclassified reasons use `unknown`.
Ordinary check-failure messages use the English notification locale; server
messages retain their report's locale. Consumers should branch on `event` and
`reason.code`, rather than matching translated text.

An associated measured incident contributes `incident: {id, startedAt, url}`.
These facts describe the persisted timeline, not notification delivery time.
TLS warnings and tests omit incident data; not every event opens an incident.
A recovery with a resolved incident also includes
`recovery: {recoveredAt, downtimeSeconds}`. Incident links require owner
sign-in. Tests omit `reason`, `incident` and `recovery`.

## Headers and signature verification

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `User-Agent` | `Pulsy/0.1.0` |
| `X-Pulsy-Event` | Signed body's `event`. |
| `X-Pulsy-Delivery` | Signed body's `id`. |
| `Idempotency-Key` | Same delivery ID. |
| `X-Pulsy-Timestamp` | Signed body's `timestamp`. |
| `X-Pulsy-Signature` | `sha256=<64 lowercase hex characters>`. |

Custom headers cannot override contract headers: `Content-Type`, `User-Agent`,
`Idempotency-Key`, or any `X-Pulsy-*` header. The signature is:

```text
sha256=hex(HMAC-SHA256(key = UTF-8 secret string, message = exact raw JSON body bytes))
```

Use the secret's **text** as the key, without hex-decoding it. There is no
header prefix or timestamp concatenated to the signed bytes. Do not parse and
re-serialize JSON before verification: whitespace and byte order matter.
Compare the received and computed digests in constant time, after validating the
signature's format and length.

After signature verification, parse/validate v1 JSON and require event,
delivery/idempotency and timestamp headers to match the corresponding signed
body fields. Header values alone are not authenticated. Use the signed timestamp
for an explicit receiver freshness policy; rejecting events more than 60 seconds
in the future and older than 24 hours is a useful starting point for deferred
jobs. Those are receiver policy choices, not a guarantee of Pulsy delivery age.
Persist accepted delivery IDs for at least that window and handle duplicates
without performing the action twice. Timestamp checks alone cannot prevent
replay inside the accepted window.

## Retries and delivery outcomes

Automatic delivery retries transient network failures, timeouts, HTTP `429` and
`5xx`. The default delays are **30 seconds, 2 minutes, 10 minutes**, giving four
attempts total; operators can override them with `NOTIFICATION_RETRY_DELAYS_MS`.
Other HTTP failures are permanent. Each HTTP attempt has a 10-second timeout.
Manual **Send test** performs one attempt.

Retries retain the logical delivery ID and raw body. Durable deferred/escalation
jobs freeze that body before network I/O and reuse it after worker restarts.
In-process retry timers themselves are lost on restart; only durable jobs can
resume. Receivers must deduplicate by delivery ID. A `2xx` means the receiver
accepted the request, not proof of downstream processing. Delivery is not
exactly once.

Every attempt uses the DNS-pinned egress policy and revalidates each redirect
hop. Cross-origin redirects strip credential and contract-signature headers;
configure a direct receiver endpoint rather than relying on redirects to forward
a signed request. Account-wide default channels apply to every monitor; use
monitor-specific channels for selective recipients. There is no per-monitor
default opt-out.

See the [REST API guide](./README.md) for channel references and the
[incident guide](../uptime/incidents.md) for measured incident behavior.
