# Personal incident response

## Steps

Open **Incidents** from the monitoring dashboard. Search a monitor name or cause,
then filter Unresolved (Open and Acknowledged), Open (unacknowledged and still measured failing), Acknowledged,
Resolved, or All. Severity is the operating importance recorded when a new
incident starts; older records have Unknown severity rather than an invented
historical value. Each row shows its owning account, start, elapsed seconds and
last update. Cursor pages use stable start-time/incident-ID ordering. Filters,
pages and the selected incident live in the URL, so reload and Back/Forward keep
the requested context. A monitor-specific or group deep link filters owned records
only; another account's ID does not grant access.

## Time display preferences

Open the account menu at the bottom of the sidebar, then **Preferences**. Choose **Language** and **Account timezone**, then **Save**. Language is saved in this browser; an explicit IANA timezone is saved to your account across devices. Select **Use browser timezone** to follow each browser instead. These settings change timestamp display, not incident start times or report windows.

## Behavior

You can remove acknowledgement while the incident is unresolved, returning it to Open. Acknowledgement and removing it change response state only; resolution remains driven by measured recovery. Both actions are recorded in the private timeline.

Acknowledgement records your response and actor/time. It does not pause checks,
change uptime, close the measured incident or publish anything. Only a real
recovery closes the measured incident. Private notes and runbook descriptions
are plain text, up to 2,000 characters. Known configured request/auth/header/body
values are redacted before notes are stored; never paste credentials. Runbook
links accept HTTP(S), without embedded credentials, query parameters or fragments.
Saving an omitted/empty link clears the previous link explicitly. Links are opened
with a separate browsing context. Notes and runbooks remain private and are never
used as customer announcements.

## Example

Select exact incidents on the current cursor page to create a response group.
Groups help coordinate your own response; they do not merge the underlying
measured incidents or infer a common root cause. Changing filters/pages clears
the selection. Every selected ID is checked server-side in one transaction, so a
foreign or missing incident rejects the entire operation. Up to 100 incidents
can be selected; the present technical ceiling is 200 groups per account.

The timeline records human acknowledgement, notes, runbook edits and grouping.
New check transitions and delivery outcomes are written separately from raw check
history; pruning raw history therefore does not erase their response trail.
Existing historical transitions/outcomes are shown when their retained source
records are available. No response body, notification recipient, provider error,
credential or private request configuration is projected. The panel currently
shows the latest 100 events and labels truncation. Up to 1,000 private human
actions can be recorded per incident. Events follow the owning incident's existing
retention/removal; this is not an independent permanent audit archive.

This workflow is scoped to the owning account. The current monitor authorization model does not support teammate assignment or shared incident operators.

## Delayed escalation

Optional delayed escalation uses one immutable plan per measured incident, with
one primary and optionally one distinct second existing owned channel. Each
absolute delay runs from incident start, 60–86,400 seconds; an elapsed delay is
eligible at the next scan. The second waits for the first attempt to settle,
then can notify while the incident remains unresolved and unacknowledged.
Changing the configured channel destination affects later attempts; exact target
receipts prevent replay/recovery to newly changed destinations. Cancel explicitly
to stop remaining reminders. Acknowledgement stops only that incident's reminders;
it does not suppress ordinary transitions, another incident's reminders, or a real
recovery. Paused/informational/recovered incidents stop reminders. Maintenance
postpones them without changing measured facts.

## Recovery notices

Recovery also reaches opted-in, unchanged targets that actually received an
escalation, even if the initial outage alert was undelivered. Undelivered reminder
targets get no invented recovery. Original ordinary-monitor recovery policy remains
in place. Customer announcements/subscriptions remain separate from private actions.
API access, SLA reports and monthly reports are available to every account.

## Troubleshooting

Check the selected monitor, time window and saved settings first. Missing observations are not healthy results. After an error, keep your draft, correct the indicated field or prerequisite, then retry deliberately. For a stale preview, generate and review a fresh preview before applying.

## Related topics

- [Personal saved views and groups](/dashboard/help/saved-views)
- [Advanced HTTP checks](/dashboard/help/http-checks)
- [Reliability goals and event context](/dashboard/help/reliability)
- [Public status-page communication](/dashboard/help/status-communication)

Select at least two incidents for a response group. Selection actions stay below the list without moving rows. The response panel has one persistent close control and one scrolling body; Esc closes it and returns focus to the selected row.
