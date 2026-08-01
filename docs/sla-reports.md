# SLA Reports

Pulsy can produce a per-monitor **SLA / uptime report** — viewable in the
dashboard, downloadable as a branded PDF, and (optionally) emailed to your team
on the 1st of every month.

## What's measured

A report covers a time window and summarizes:

- **Uptime %** — successful checks ÷ total checks over the window.
- **Checks** — total, successful, and failed counts.
- **Response time** — average and **p95** (95th-percentile) in milliseconds.
- **Incidents** — count, total downtime, and the longest single incident.
- **Per-day uptime** — a daily breakdown for the window.

The on-demand view and PDF use a rolling 30-day window. The monthly email
covers the **prior full calendar month**.

## Viewing and downloading

Open a monitor → **SLA Report** tab. The tab shows the current report and a
**Download PDF** button. The PDF is served from an authenticated route
(`GET /api/reports/sla/<monitorId>.pdf?days=30`) — your browser session
authorizes the request, so the link only works while you're signed in.

## Monthly email

From the same tab, add one or more **recipients** and pick an **email
provider** (configure providers under the monitor's Notifications tab first),
then **Save**. On the 1st of each month at 06:00 UTC, Pulsy builds the prior
month's report for the chosen monitor — or for **all** of your monitors if you
leave the subscription account-wide — and emails it with the PDF attached.

Use **Send now** to send immediately and confirm delivery. Delivery uses your
own provider credentials (Resend, SendGrid, or SMTP); links in the email derive
from `PUBLIC_WEB_URL`, and the `fromAddress` should be on a DNS-verified domain
so messages land in the inbox (see the email-deliverability notes for SPF/DKIM/
DMARC).

## Availability

SLA reports are available to every account. Pulsy has no plans or tiers.
