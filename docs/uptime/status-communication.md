# Public status-page communication

## Steps

Open **Monitor → Status pages** in the application navigation, then Manage communication for the exact page.
Page publication and custom domains are available to every account. Public components
reference only explicitly selected owned monitors. Existing pages initially use
their previously disclosed monitor names; set separate public names/descriptions
when private deployment names should stay private. Optional flat group labels are
case-sensitive. Groups appear in their first component's order; component order
inside a group follows the edited order. Move components deliberately, preview
all disclosed names/descriptions/groups, then apply. This never adds future tag
matches or copies private URLs/request configuration. Unchanged selection retains
component keys; removing/readding creates a new explicit component identity.
Applying public names to a published page changes that public page immediately;
preview tells you whether the page is published. A changed page/member/name state
invalidates the preview and requires a fresh preview.

## Example

Write a separate manual announcement with a title, plain multiline text, one of
Investigating/Identified/Monitoring/Resolved, exact affected components and an
IANA timezone. Save a private draft first. Preview shows the page, affected public
names, text, stage and timezone. Publish explicitly; an unpublished page must be
published through its existing control first. Publication never acknowledges a
private incident, changes measured health, closes a measured incident or pauses a
check. Private notes/runbooks are never copied into customer announcements.
Configured request values and credential-bearing URLs are redacted before draft
storage; do not paste credentials. Text is rendered as plain escaped text, with
line breaks, rather than executable HTML or arbitrary scripts.

## Behavior

A published update is immutable. Post update creates a new draft referencing it;
it still requires save, preview and publish. Editing an existing private draft
does not modify a published record. Publisher concurrency invalidates stale
previews, including a draft changed while publication waits for the page lock.
The current management view shows the latest 100 records and supports up to
1,000 records/page; archival/paging should be added before real histories reach
this technical bound. These are technical operating bounds.

A maintenance notice selects an existing owned enabled maintenance schedule,
one of its next five verified occurrences and exact components belonging to both
that schedule and this page. Snooze rules are not public maintenance notices.
Author public text separately: internal reasons remain private. Preview includes
start/end in the schedule's IANA timezone. Publication covers that explicitly
chosen occurrence; recurrence continues independently and later notices require
another explicit publication. Cancelling/changing a schedule before publishing
invalidates the notice. Publishing a notice does not change raw uptime or the
maintenance suppression policy.

RSS and Atom use the safe published projection. Dedicated URLs are
`/api/status/pages/<publicKey>/feed.rss` and `feed.atom`; `status.json` is version 1
and `badge.svg` reports stored overall status. The page publicKey is a non-secret
public identifier and grants no configuration/owner access. Missing/draft pages
are unavailable. Empty/partial states remain unknown; a Down or Degraded component
still takes precedence. Scrapes/feeds never execute checks. Payloads exclude URLs,
headers, credentials, subscribers, internal notes, provider/domain challenge data
and email addresses. The JSON's asOf is response generation time, while component
last-check time remains the stored fact. Badges use Accept-Language for five
localized status labels. Feeds preserve the author's public text.

## Email subscriptions

Enable email subscriptions only with your account's verified, usable email
provider. No Pulsy-funded mail service is supplied, and alert recipients are
never imported. Save explicitly with confirmation. Provider replacement,
disable or budget changes cancel unsent jobs from the previous configuration;
already-started sends may finish. Confirmed subscribers remain opted in for
future updates, while unsubscribed users remain unsubscribed. Management shows
private counts and safe failure categories, not subscriber addresses or tokens.
Provider acceptance is an outbound receipt, not proof of inbox placement.

## Private values and limits

Visitors choose the whole page (including future explicitly published components)
or exact selected components, enter an email address and request confirmation.
Addresses are trim/lowercase for per-page deduplication. Confirmation is required
within 24 hours; another request is eligible after 15 minutes. A change of scope
requires fresh confirmation and leaves the previous confirmed scope active until
then. New subscribers receive future matching published updates, not old history.
Removed/readded components get new keys and cannot silently replace a selected
component. Confirmation and unsubscribe links use a fragment that is removed
before analytics/router initialization and held only in page-bound memory. The
visitor must click the action; visiting the link alone does nothing. Unsubscribe
continues to work after unpublication, while deletion removes the records. Old
confirmation/unsubscribe tokens cannot alter a later confirmed opt-in. Responses
are neutral and do not reveal whether an email is registered; expired links may
have no effect. No recipient import or automatic resubscription is supported.

## Troubleshooting

Check the selected monitor, time window and saved settings first. Missing observations are not healthy results. After an error, keep your draft, correct the indicated field or prerequisite, then retry deliberately. For a stale preview, generate and review a fresh preview before applying.

## Related topics

- [Personal saved views and groups](/dashboard/help/saved-views)
- [Advanced HTTP checks](/dashboard/help/http-checks)
- [Reliability goals and event context](/dashboard/help/reliability)

Subscriber setup shows only unmet publication and provider prerequisites, with
links to the General tab, provider selection, or Notifications. Provider readiness
requires an owned, verified provider with decryptable, complete credentials; a
verification flag alone is insufficient. No provider secrets enter the readiness
response.
