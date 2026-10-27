# Latency degradation and quiet recovery

## Steps

Create a monitor or open its Settings, expand **Latency and alert policy**, and
enable the policy. It is available to every account.
Quick add and monitors without a policy retain their previous behavior. An
explicitly disabled policy (`null`) restores legacy behavior. Editing or bulk
replacing a different policy resets streaks; identical or unrelated edits retain
them. It never deletes checks, incidents or delivery receipts.

## Behavior

Latency thresholds are optional. Enable slow-response detection to set an upper
threshold and consecutive count. Duration is this HTTP request's milliseconds,
including reading a configured assertion response, not browser page-load time.
Every assertion must pass on the same response before latency is considered.
Unreachable, unacceptable-status and assertion-failing responses count as Down
under the existing failure threshold. With this policy enabled, an unexpected
sub-400 response is a failure; legacy monitors retain their existing Degraded
handling for that case.

A valid response strictly **above** the upper threshold is a slow sample. The
configured count of consecutive slow samples changes Up to Degraded. Equality
at that threshold is not slow. A valid response **at or below** the recovery
threshold advances recovery. Equality counts toward recovery; zero is supported.
The recovery threshold cannot exceed the upper threshold. Values in between
reset recovery progress and keep an existing Down/Degraded state. Down takes
precedence and stays Down until the configured passing recovery count completes,
even if subsequent responses are valid but slow. Without latency thresholds,
any valid response advances quiet recovery. Counts range from 1 to 10; thresholds
are bounded by 60,000ms and cooldown by 3,600 seconds.

The monitor shows its held current state and progress; individual check history
retains each raw Up/Down/Degraded sample. One ongoing measured incident remains
open through a sustained slow → Down condition, and counted recovery resolves
that incident. Slow causes retain observed duration and the configured threshold
at the time. The existing response-time chart shows the current threshold;
missing durations remain gaps. Current policy changes do not relabel old checks.

Critical and Warning use existing selected/default channels. Informational
records measured failures and incidents without operational paging. It still
counts in raw uptime. Channels have an explicit **Notify on degradation** option,
initially off for existing and new channels; Down and recovery selections remain
unchanged. TLS-expiry alerts retain their independent channel policy.

Delivery history shows attempted, accepted, failed or suppressed messages according to the available evidence. Provider acceptance does not prove inbox delivery. Inspect a failure before retrying; delivery can be uncertain and retries can duplicate messages.

## Example

**Test configuration** is an explicit single sample: it shows raw assertion and
latency validity, not the held state after several samples. It does not advance
streaks, write history/incidents or send notifications. POST requires confirmation
because the request can have side effects. Saving never automatically tests.

The UI is available in English, Arabic, French, German and Spanish. REST reads expose the non-secret policy and counters. Every account can use API keys with scope `read` for reads and `full` for writes. Use `Authorization: Bearer` with an account API key, never put a key in a URL.

## Troubleshooting

Check the selected monitor, time window and saved settings first. Missing observations are not healthy results. After an error, keep your draft, correct the indicated field or prerequisite, then retry deliberately. For a stale preview, generate and review a fresh preview before applying.

## Related topics

- [Personal saved views and groups](/dashboard/help/saved-views)
- [Advanced HTTP checks](/dashboard/help/http-checks)
- [Reliability goals and event context](/dashboard/help/reliability)
- [Public status-page communication](/dashboard/help/status-communication)
