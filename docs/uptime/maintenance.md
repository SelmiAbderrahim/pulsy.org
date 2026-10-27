# Maintenance and alert snooze

## Steps

Select monitors, then choose **Maintenance & snooze**, or open a monitor's
**Settings**. These controls are available to every account.
They change notification policy only: checks, measured health, raw uptime and
measured incidents continue. A Down monitor can also have a Maintenance badge.
Snoozing alerts does not pause the monitor.

Choose 15 minutes, one hour, four hours, or a custom end within 30 days. The
private reason and resume time remain visible in the owner's controls. **Resume
snooze** removes only the selected monitors from snoozes; it leaves maintenance
schedules intact. Ending a schedule applies to its whole explicit selection and
asks for confirmation. Monitors added later are not included automatically.

Advanced maintenance schedules have a name, private reason, start/end, IANA
timezone and one-time/daily/weekly recurrence. Date inputs use the browser's
local timezone. The selected IANA timezone determines subsequent recurring
local start times. Preview the displayed occurrences before saving; changing
any field requires a fresh preview. Recurring durations are elapsed time, up
to 24 hours. One-time durations are up to 30 days. At spring DST changes,
nonexistent local starts are skipped; weekly/daily times follow the timezone's
local offset. Saving or previewing does not probe a customer endpoint.

Suppression starts inclusively and ends exclusively. All applicable schedules
and snoozes are combined; ending one does not end another. A durable worker
rechecks active windows immediately before delivery. After the last applicable
window ends, an active monitor still in the same outage gets one deferred alert
per eligible destination. Recovered, paused, deleted or superseded outages do
not produce a deferred outage alert. Recovery for a suppressed outage goes only
to the corresponding destinations with a recorded successful outage delivery;
adding or changing a destination does not authorize a recovery for it.

Delivery history shows attempted, accepted, failed or suppressed messages according to the available evidence. Provider acceptance does not prove inbox delivery. Inspect a failure before retrying; delivery can be uncertain and retries can duplicate messages.

Up to 200 active schedules per account are supported as a technical safety
ceiling for every account. Expired one-time schedules leave the active list
immediately. Daily cleanup prunes expired/cancelled schedule history and
terminal delivery history after 30 days in bounded batches. One minimal current
outage receipt per monitor survives check-history retention so recovery remains
correct; historical response timings/status/reasons are removed from that receipt.

Reasons stay private. To publish a notice, open the chosen status page's
communication controls and explicitly select a schedule occurrence and affected
public components, compose separate public text, preview, and publish. Later
recurrences require a new publication. See the status communication guide.
Maintenance does not alter raw uptime or SLA exclusions.
