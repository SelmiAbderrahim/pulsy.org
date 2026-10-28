# Import & export

Open [Import & export](/dashboard/import-export) to export selected monitor settings or review a configuration before importing it.

## Steps

Open **Develop → Import & export** in the application navigation. Select explicit
monitors, then Export selected configuration. Download JSON becomes available
only for an export or a successful redacted preview. Loading a file or editing
text invalidates both the preview and download. Maximum 200 entries and 256 KiB
of UTF-8 JSON, depth 16 and 20,000 values. This moves settings, not check history,
incidents, publication, subscribers, recipients, API keys or a disaster-recovery
backup. Import and export are available to every account.

## File format

Version 1 has `format: "pulsy-monitor-configuration"`, `version: 1`, and a
`monitors` array. Each entry has a stable account-local `key`, `type`, `name`,
`interval` in seconds, `active`, and `tags`. Keys use ASCII letters, numbers,
underscore, dot, colon and hyphen, start with a letter/number and have at most
100 characters. Tag case sensitivity and existing type-specific bounds remain.
HTTP entries additionally require `url`, `method`, `expectedStatus`, `timeout`
in milliseconds, `failureThreshold` and `redirectPolicy`. `httpAssertions` and
`latencyPolicy` are optional: omission retains existing values; null disables
the latency policy. Heartbeat entries require `graceSeconds`. HTTP, DNS, TCP and interval heartbeat are supported. Cron schedules and third-party adapters are not supported.

## Example

```json
{
  "format": "pulsy-monitor-configuration",
  "version": 1,
  "monitors": [
    {
      "key": "api-production",
      "type": "http",
      "name": "API production",
      "url": "https://example.invalid/health",
      "method": "GET",
      "expectedStatus": 200,
      "timeout": 10000,
      "interval": 300,
      "failureThreshold": 3,
      "redirectPolicy": "follow",
      "active": false,
      "tags": ["production"],
      "httpAssertions": [
        { "type": "json", "path": "$.status", "op": "equals", "value": "ok" }
      ]
    }
  ]
}
```

## Keys and renames

Exports use an existing external key, or `pulsy:<monitorId>` for an unbound
monitor. Reapplying that key to the same account binds it without replacing the
monitor. A new key creates a new monitor. To rename a key deliberately, add
`previousKey` with the old owned key and choose the new `key`; preview shows the
binding change. It cannot select a foreign account's monitor. Missing old keys,
two entries selecting the same monitor, conflicting old/new keys and changing a
bound monitor's type are rejected. Repeating an already applied rename remains
idempotent. Remove `previousKey` before transferring that file to another account.
Keys are case-sensitive. Never put credentials in names, tags, keys or assertions.

## Private values and limits

Private request values are omitted and never returned. `needsReentry` lists
unfilled categories: request, url, assertions or heartbeatToken. All query- or
fragment-bearing URLs are omitted conservatively; a credential-bearing or known
secret-bearing URL is also omitted. Existing URLs remain when imported url is
null; a new monitor requires a safe URL. Sensitive header assertions and rules
containing known request values are omitted. Existing omitted assertions remain.
Imported request/auth/body/token/recipient/subscriber fields are stripped before
validation, including known repeated values in names, tags, URLs and assertions.
The returned preview replaces the editor with redacted JSON. Dangerous object
keys, unknown fields, duplicate configuration keys and unsupported versions are
rejected. At most 500 imported private leaf values per monitor are examined.
This is an unfilled-field format, not a secret-store integration.

No import replaces or clears stored request secrets. A retained POST body cannot
be changed to GET/HEAD by import; clear or replace it deliberately in the monitor
settings first. New HTTP monitors needing request/rule re-entry stay inactive.
Heartbeat imports never include a token or URL: new jobs stay inactive and need
explicit token rotation/copy and activation in settings. Existing heartbeat
activation is preserved regardless of the manifest's active value; change it in
the existing controls. Intervals/grace may change without fabricating a receipt,
recovery or healthy state. Existing token hashes and run history remain intact.

Optional `channelIds` reference existing owned alert channels only. They never
contain recipients, provider credentials or delivery targets. Omission retains
existing bindings; an empty array explicitly clears these references without
deleting channels. On another installation remove references or replace them
with that account's channel IDs. Missing, foreign, removed or ineligible channel
references reject the import. Templates, saved views, maintenance schedules,
providers and public-page membership are outside this monitor manifest.

## Preview and apply

Validate and preview writes nothing and executes no probe. It displays exact
field changes and create/update/unchanged/rejected counts. Apply these changes
is explicit and atomic: any rejected entry, storage failure or stale
configuration leaves all entries unapplied. A revision checks configuration and
reference identity, not routine health changes. Concurrent creation serializes with ordinary monitors and heartbeat through
a transaction lock on the owner row, without a monitor count limit. IDs, checks, incidents,
public membership and omitted secrets remain. No deletion, prune or silent
replacement exists. Active HTTP imports start scheduled requests; POST can have
side effects. Re-preview the same manifest to see unchanged entries without new
monitors. An all-unchanged preview has nothing to apply.

## API access

Every account can use API keys with scope `read` for reads and `full` for writes. Use `Authorization: Bearer` with an account API key, never put a key in a URL. Programmatic export and preview use read access; apply requires `full`. The UI is available in all five languages. The first two POST routes below use read access:

```sh
curl -X POST "$PULSY_URL/api/v1/configuration/export" \
  -H "Authorization: Bearer $PULSY_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"monitorIds":["owned-monitor-id"]}'

curl -X POST "$PULSY_URL/api/v1/configuration/preview" \
  -H "Authorization: Bearer $PULSY_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @preview-request.json

curl -X POST "$PULSY_URL/api/v1/configuration/apply" \
  -H "Authorization: Bearer $PULSY_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @apply-request.json
```

preview-request.json contains `{"text":"<JSON-escaped native manifest>"}`.
apply-request.json contains the same text and the returned `revision`, for
example `{"text":"<same escaped JSON>","revision":"<64-character revision>"}`.
Use your CI system's standard JSON encoding; do not interpolate unescaped file
contents into shell commands. Review the preview before permitting the apply
step. Stale revision returns HTTP 409; rejected/invalid input 422; parser bounds
413, malformed JSON 400 and unsupported compressed payload 415. Successful
responses use no-store. No new CLI, package or sync daemon is required.

Repeating an import keeps an HTTP monitor inactive while its required omitted request values or assertion rules remain unconfigured. Configure those values in monitor settings before requesting activation through a later import. Existing configured private values are retained.

Version 1 now also carries DNS and TCP entries: `type` is `dns` or `tcp`; `configuration` contains the matching typed hostname/record expectations or hostname/port, plus timeout and failure threshold. These use the configured check interval, retain history on owned-key update and never add TLS claims or publication.

## Troubleshooting

Check the selected monitor, time window and saved settings first. Missing observations are not healthy results. After an error, keep your draft, correct the indicated field or prerequisite, then retry deliberately. For a stale preview, generate and review a fresh preview before applying.

## Related topics

- [Personal saved views and groups](/dashboard/help/saved-views)
- [Advanced HTTP checks](/dashboard/help/http-checks)
- [Reliability goals and event context](/dashboard/help/reliability)
- [Public status-page communication](/dashboard/help/status-communication)

Invalid JSON is reported immediately below the editor with a safe reason and line/column. For example, `{"bad":` is incomplete at line 1, column 8. Focus moves to the error without clearing your input. Parser messages never echo pasted secret values.


## Export selection

Use **Select all eligible monitors** to select up to 200 HTTP, DNS, TCP and job-heartbeat monitors. Linux servers are disabled with an explanation: their agent setup requires new credentials. The server rejects Linux-server export requests too. Existing server manifests remain importable and produce inactive pending servers requiring new setup. **Download sample** gives a safe inactive HTTP example independently of the editor; **Download JSON** saves only an exported or reviewed, sanitized manifest.
