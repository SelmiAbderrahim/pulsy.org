# Personal saved views and groups

## Steps

Use dashboard search, health, tag matching, sort, row density and grouping, then
**Save new view**. A view stores these filters for your account; it creates no
monitors, workspace, public components or additional monitoring usage. Views are personal and scoped to the owning account. Shared views require a compatible permission model
and are not advertised as delivered.

## Behavior

Save up to 200 personal views with names up to 80 characters, search up to 100,
and up to 50 selected tags. These are technical safeguards for every account. Remove an unused view if the view ceiling is reached. Pin a
view to place it before unpinned views. Only one default is stored per account;
concurrent changes are serialized. The default applies only on a dashboard with
no filter parameters. An explicit link takes priority. **Clear filters** records
an explicit cleared state so reload does not immediately reapply the default.

Applying a view creates a browser history entry. Back/Forward restore its exact
URL filters; reload retains them. Editing a filter changes the URL but leaves the
saved view unchanged until **Update view**. The UI identifies these unsaved
changes. Removing a view removes only the saved filters; existing monitors,
checks, incidents, settings and publication stay intact.

## Example

Tag filters are case-sensitive. **Any selected tag** is a union; **All selected
tags** requires every selected tag. Search remains a case-insensitive substring
of existing monitor name, URL and tags. New links encode tag arrays, preserving
commas and Arabic text. Old comma-separated links remain readable. This is UI
configuration, not a programmatic configuration export endpoint.

Group by every existing tag, or by environment tags with the exact prefix
`env:` and a non-empty value, such as `env:production`. No separate folder or
nested environment model is created. Each group counts unique matching monitors;
a monitor with several tags appears in several groups. Group counts may therefore
sum to more than the filtered monitor count. Monitors without a matching group
appear in **Without matching group**. Grouping, sorting and density preserve
selection; changing search, health or tags clears selection and open bulk dialogs.
A query refresh removes hidden/deleted IDs from actionable selection immediately.
Select-all and bulk operations always use unique explicit monitor IDs, including
when a monitor appears in multiple groups. Tag chips are native keyboard controls.

## Duplicate and reusable creation templates

Duplicate opens a new creation form with a derived name and the method, expected
status, interval, timeout, failure threshold, assertion/redirect/latency rules and
tags. Enter the destination again. Private headers, authentication and body values
are never copied, even when the source used them. History, incidents, tokens,
publication membership and subscribers are never copied. Saving explicitly creates
an independent monitor using the configured check interval.

Save as template opens an editable non-secret configuration. Templates hold no URL
or private request values. A warning records whether the source required private
values. Templates can reference up to 20 existing owned alert channels; references
reuse that channel’s settings without copying recipients or credentials. Account
defaults still apply, and duplicate channel IDs/targets are deduplicated during
worker delivery. Later channel edits affect linked monitors; deletion removes
existing bindings. A template referencing a deleted channel cannot create a monitor
until that reference is explicitly removed or replaced. The selector lists up to
200 existing channels using type and ID, with no destinations or recipients.

Templates are personal, with a technical bound of 200 per
account. Saving a template does not create a monitor. Editing/deleting a
template leaves all existing monitors unchanged. Using it opens the normal creation
form; every creation revalidates interval and owned references on the
server. Templates have no automatic bulk-update or publication effect.

## Add selected monitors to an existing status page

Select exact monitor IDs, choose a page, and Preview selection. The preview writes
nothing. It shows the page identity/publication state, each added component’s exact
public name, counts and public fields. Apply this exact selection adds only those
IDs, preserving existing membership and order. It never includes future tag
matches, publishes a draft or changes the monitor’s legacy public flag.

On a published page, applying immediately changes its public component selection.
Names, measured health, uptime, response timing, last check and recent incident dates
are public under the existing projection; URL/request credentials remain private.
Review names before applying. Use the status-page component editor for separate public display names. The existing 100-component ceiling applies. Concurrent membership,
publication or disclosed-name changes invalidate a preview; preview again.

Wholesale page selection now commits its replacement in one transaction. If
validation or insertion fails, the previous selection remains intact. Additions and
replacements serialize on the owned page.

The monitor’s Notifications tab lists its reused channel IDs/types. Detach reference
removes only that monitor’s binding; account defaults and direct channels still
apply. It does not delete or modify the original channel. Supported channels are
email, webhook, Slack, Discord and Telegram.

## Troubleshooting

Check the selected monitor, time window and saved settings first. Missing observations are not healthy results. After an error, keep your draft, correct the indicated field or prerequisite, then retry deliberately. For a stale preview, generate and review a fresh preview before applying.

## Related topics

- [Advanced HTTP checks](/dashboard/help/http-checks)
- [Reliability goals and event context](/dashboard/help/reliability)
- [Public status-page communication](/dashboard/help/status-communication)

## Navigation and monitor actions

At widths of 1024 px and above, the sidebar stays visible and monitors use a table. Below that, open the navigation menu and use monitor cards. Compact density and grouping remain available in the dashboard’s Filters panel on smaller screens; compact density affects table rows. On narrow monitor detail pages, use More actions beside the visible tabs to reach the remaining tabs.

Use Pause to stop scheduled checks and alerts, and Resume to continue monitoring. Paused describes monitoring activity, separately from the last measured health. Heartbeats may still record received results while paused; Resume starts a fresh deadline window.

## Account-wide notification defaults

Default notification channels apply to every monitor, including future monitors and monitors created from imports or templates. Detaching a template channel does not disable account defaults. Per-monitor opt-out is not currently supported. For selective alert recipients, use monitor-specific channels instead of account-wide defaults; changing or deleting a default affects every monitor.
