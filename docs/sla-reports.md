# SLA Reports

Every account can view per-monitor SLA reports, download PDFs and configure
monthly email delivery using its own email provider.

## What's measured

The report's **Check success** percentage is `up checks / all recorded checks`,
rounded to two decimal places. Counts separate successful, degraded and failed
checks; degraded is not successful. No recorded checks means unknown, never
0% or 100%. Paused intervals and missing observations are not inferred as
successes.

The report also shows average and p95 recorded duration, daily check-success
rows, and measured incidents with total downtime and longest incident.
Incident durations are clipped to the report window, including incidents that
started earlier or remain open. Timing measures HTTP requests, DNS resolution
or TCP connection establishment as appropriate; job duration is not request
latency.

Check success is separate from duration-weighted observed availability and
coverage in History. Sampling gaps and failure thresholds can make incident
downtime differ from the check-success ratio. Report average/p95 include all
checks with a recorded timing, while Overview average uses successful checks
with timing. The dashboard average gives each monitor with recorded checks
equal weight, includes measured zero, and excludes unknown monitors.

## Windows, retention and timezone

The on-demand tab and default PDF cover the rolling 30 days through the request
snapshot, with inclusive boundaries and no future samples. Monthly email covers
the prior full UTC calendar month. Daily rows are UTC calendar days; changing
the account display timezone does not move these boundaries.

PDF period, incident and generation timestamps use an IANA display timezone.
The Reports tab passes the saved account zone or its resolved browser zone for
an on-demand download. Direct PDF links and monthly jobs use the saved account
zone, defaulting to UTC when none is stored; they cannot infer a browser zone.
The report names its display zone
and UTC daily-bucket basis. Arabic PDF labels fall back to English because the
built-in PDF font cannot render them; unsupported characters in user text are
replaced with `?` and the PDF notes that limitation.

Check history retention is controlled by the operator's
`CHECK_LOG_RETENTION_DAYS`, default 30 days. A larger requested report window
does not restore removed observations. Review retention before relying on a
full prior-month report, especially for months longer than 30 days. Missing
history remains unknown.

## Viewing and downloading

Open the monitor's **Reports** tab and select **Download PDF**. The protected
`uptimeMonitor.slaReport.download` procedure generates the report and PDF from
one owned snapshot, with the requested display timezone. CSV and JSON exports
retain raw UTC timestamps and record their display timezone separately.

Direct links use `GET /api/reports/sla/<monitorId>.pdf?days=30`; this route
rechecks the browser session and monitor ownership and uses the saved account
timezone. It is not a public share URL. The `days` parameter accepts whole
numbers from 1 through 366 and defaults to 30.

## Monthly email

Configure a usable email provider in Notifications, then select the provider
and recipients in the report controls and save. Delivery uses your own Resend,
SendGrid or SMTP credentials. An account-wide report subscription processes
all monitors owned by that account; a monitor-specific one processes only its
selected monitor.

The leader's monthly job runs at 06:00 on the first day of each month in the
server process timezone. Standard images use UTC; keep that timezone when a
06:00 UTC schedule is required. Report boundaries remain UTC independently of
the scheduler timezone. **Send now** processes the prior month's report
immediately. Provider acceptance is not proof of inbox delivery.

Links derive from `PUBLIC_WEB_URL`. Use a verified sending domain and configure
SPF, DKIM and DMARC. A missing/unusable provider is skipped; one recipient's
send failure does not prevent attempts to other recipients. The attached PDF
captures the monthly window; the email's download link opens the authenticated
on-demand PDF route rather than a permanently stored monthly attachment.

See [measurement definitions](uptime/check-success-and-availability.md) and
[reliability goals](uptime/reliability.md) for operational availability and
coverage.
