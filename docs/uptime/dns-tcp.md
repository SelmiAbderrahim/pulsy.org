# DNS and TCP monitoring

DNS and TCP monitoring are available to every account, alongside HTTP and heartbeat monitoring. Check history follows the operator setting `CHECK_LOG_RETENTION_DAYS`.

## Steps

Open the **Add monitor** menu and choose **DNS / TCP monitor**. Enter a name, hostname, interval, timeout and consecutive failures before Down. Creation is explicit; enabled monitors start scheduled checks. Disabling a monitor stops automatic probing, without making it healthy. Existing maintenance and snooze suppress notifications while checks and measured history continue. Notes, acknowledgement and public announcements remain separate from health.

## Example

DNS supports A, AAAA, CNAME, MX and TXT through the operator’s configured system resolver. Names are ASCII/punycode, up to253 characters; underscore-prefixed TXT names such as `_acme-challenge.example.invalid` remain intact. Do not enter a URL or a port in a DNS hostname. Choose record existence or an exact expected set. Expected records use a JSON array in the advanced form:

- A: `["1.1.1.1"]`; AAAA: `["2001:4860:4860::8888"]`.
- CNAME: `["api.example.invalid"]`.
- MX: `[{"priority":10,"exchange":"mail.example.invalid"}]`.
- TXT: `["Case Sensitive", ""]`. Each string is one complete record; native TXT chunks within that record are joined. An empty string differs from no answer.

Order and duplicate occurrences do not affect set comparison. Address representations are normalized, and CNAME/MX hostnames ignore case and a final dot. MX priority remains significant. TXT content, whitespace and case remain exact. Changed or removed answers fail a configured expected set; Pulsy never learns a replacement baseline automatically. The record-type control does not replace entered expectations when changed: correct the JSON for the selected type before saving.

DNS reports distinct causes for nonexistent names, empty answers, temporary resolution errors, timeout, mismatched sets, prohibited addresses and oversized answers. Maximum50 answers,4KiB per TXT record and64KiB normalized expectations/answers; maximum query timeout60,000ms. Queries use a native resolver and are cancelled at the deadline. The configured resolver remains trusted operator infrastructure; customers cannot select arbitrary DNS servers in this form. Raw answer bodies are not persisted or exported as observations.

## Behavior

TCP checks establish one native TCP connection to a hostname and port1–65535. The timeout includes resolution and connection setup, at most60,000ms. A successful connection is Up; refusal, timeout, resolution failure or prohibited destination is Down, subject to the existing consecutive-failure threshold. The client socket is closed after every attempt. An open port does not prove authentication, application correctness or TLS certificate health. TCP TLS verification is not enabled by this feature.

Lists/details, history, incidents and existing channels use the shared health pipeline. DNS timing is query duration; TCP timing includes hostname resolution and connection establishment. Values are milliseconds, not browser page-load performance. Optional latency rules use the same stored timing and recovery hysteresis. Unknown/no-history states remain neutral. Charts preserve measured checks; acknowledgement and public communication cannot fabricate recovery.

## Private values and limits

Tags preserve case and item boundaries. Duplication and templates copy non-secret network configuration and require explicit creation; they never copy IDs, histories, incidents, publication or recipients. Editing a template changes future creations. Native version1 configuration manifests include typed DNS/TCP configuration, bounded expected sets, timing policy and owned channel references. Export/preview/apply remains additive, atomic and idempotent; API keys use `read` for reads and `full` for writes, available to every account. No implicit deletion or publication.

CNAME targets retain underscore labels. A null MX expected set is `[{"priority":0,"exchange":"."}]` and must contain no other MX records. It means the domain deliberately accepts no mail, not that an SMTP service is reachable ([RFC 7505](https://www.rfc-editor.org/rfc/rfc7505.html)). The native resolver’s empty root exchange is compared with this explicit dot. A nonzero or mixed null MX answer fails.

## Troubleshooting

Check the selected monitor, time window and saved settings first. Missing observations are not healthy results. After an error, keep your draft, correct the indicated field or prerequisite, then retry deliberately. For a stale preview, generate and review a fresh preview before applying.

## Related topics

- [Personal saved views and groups](/dashboard/help/saved-views)
- [Advanced HTTP checks](/dashboard/help/http-checks)
- [Reliability goals and event context](/dashboard/help/reliability)
- [Public status-page communication](/dashboard/help/status-communication)
