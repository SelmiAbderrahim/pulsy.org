# Custom-Domain Status Pages

Every account can create named public status pages, publish them independently
and attach its own domains. There is no account page or component count limit.
Publication remains an explicit owner action.

## Pages, slugs, and URLs

A page has an account-local slug and an application-host URL:

```text
https://<your-pulsy-host>/status/<userId>/<slug>
```

The `default` page also backs `/status/<userId>`. These addresses remain
compatible; they are public identifiers rather than management credentials.
New default pages start as drafts. Draft and missing pages return the same
unavailable result. Publishing an empty page requires confirmation; API callers
must explicitly send `confirmEmptyPublication: true`. A published empty page
shows a neutral state, not a claim that services are healthy.

## Choose public components

Open **Status pages**, select a page, and edit its selected owned monitors.
Selection is explicit: future monitors matching a tag are not automatically
included. Only active selected monitors appear publicly. Pausing hides a
component without deleting its stored selection; deleting its monitor removes
the relationship.

Use separate public names and descriptions when deployment names should stay
private. Optional flat groups and edited ordering control presentation.
Preview the exact public names, membership and publication state before
applying. Concurrent changes invalidate stale previews. Applying changes to a
published page immediately changes its public projection. Duplicating a page
creates a draft without copying domains, announcements or subscribers.

Public output contains audited display names, measured status, check-success
percentage, recorded duration, last-check time and recent incident dates.
Pending or missing observations stay unknown. Request URLs, credentials, TLS
details, private notes, owner identity fields, provider configuration and
subscriber information are excluded. The public page's `asOf` timestamp is
snapshot generation time, distinct from the last observation.

## Custom domain: routing and ownership

Attach a domain such as `status.example.com` on the page's **Custom domain**
card. Publish the two records shown by Pulsy:

| Purpose | Record | Value |
|---|---|---|
| Route traffic | CNAME for `status.example.com` | The routing target shown by Pulsy |
| Prove ownership | TXT for `_pulsy-verify.status.example.com` | The generated verification value |

An A record can be used when the operator advertises `CUSTOM_DOMAIN_IP`
instead of `CUSTOM_DOMAIN_CNAME_TARGET`. Click **Verify** after DNS propagation.
Verification uses DNS TXT lookup, not an HTTP request to the supplied domain.
Public domain resolution requires both verified ownership and publication.

Verification does not route traffic or install a certificate. Complete the
routing record and TLS termination at your edge, preserving the original Host
header for Pulsy's custom-domain lookup.

## TLS and proxy setup

Pulsy does not run in-app ACME. Choose one of the existing deployment approaches:

- Install the optional host-nginx/certbot integration in
  [ops/custom-domains/README.md](../ops/custom-domains/README.md). Its root
  systemd timer reconciles verified domains, owns their `pulsy-custom-*`
  vhosts, obtains certificates using the HTTP-01 webroot flow and updates the
  pending/active/failed provisioning state. Use DNS-only routing so the
  challenge reaches that host. Certificate renewal reloads nginx through its
  deploy hook; detaching a domain lets the next reconciliation remove its
  managed vhost and certificate. Follow the integration's host installation
  instructions separately from the application containers.
- With Caddy, Traefik or another proxy, configure DNS and HTTPS there and
  forward the original Host header. The optional nginx reconciler is not
  required for these deployments.

Configure `VITE_APP_URL` as the canonical application origin before building
the web image. The SPA compares the browser host with that configured host to
decide whether `/` should render a custom-domain status page. An empty or
invalid value leaves the normal application entry flow. Vite values are baked
into the bundle: changing only the runtime environment cannot update an
existing web image. `PUBLIC_WEB_URL` supplies the canonical origin for
server-generated links, including subscription email links.

## Announcements, feeds and optional history

Use the page's communication controls to create a private draft with separate
public text and exact affected components. Save, preview and explicitly publish.
Published announcements are immutable; a follow-up is another reviewed update.
Private incident notes and maintenance reasons are not copied. Public maintenance
notices select a verified schedule occurrence and require their own publication;
later recurrences do not publish automatically.

Each published page exposes these credential-free projections, where
`<publicKey>` is the page's non-secret public identifier:

```text
/api/status/pages/<publicKey>/feed.rss
/api/status/pages/<publicKey>/feed.atom
/api/status/pages/<publicKey>/status.json
/api/status/pages/<publicKey>/badge.svg
/api/status/pages/<publicKey>/history.json
```

Feeds carry escaped published announcements. JSON version 1 and the badge use
stored state; fetching them does not run checks. Badge labels follow
Accept-Language across the five supported locales. Compact history additionally
requires explicit enablement and exposes seven completed UTC days of
availability, coverage and typed duration, with separately enabled maintenance
adjustment. It excludes private goals, monitor IDs and annotations.

These GET/HEAD projections use `Access-Control-Allow-Origin: *`,
`Cache-Control: no-store`, no query parameters, and uniform unavailable 404s
for missing/draft pages. They share a 240-request/IP/minute budget with public
subscription requests. These routes run before general auth/JSON handling and
add no public tRPC procedures.

## Email subscriptions

Enable subscriptions using an owned, verified, usable email provider with
complete decryptable credentials. Set up the provider and publish the page
before inviting subscribers. Alert recipients are not imported automatically.
The owner sees private counts and safe failure categories rather than a public
subscriber directory.

Visitors select the whole page or exact components and confirm their address
within 24 hours. New subscribers receive future matching published updates,
not historical messages. Reconfirmation is required for a changed selection.
Removing and readding a component creates a new key, so it cannot silently
replace a visitor's selected component.

Public POSTs to `/api/status/pages/<publicKey>/subscribe` and `/subscription`
accept at most 16 KiB of uncompressed JSON. They require an exact Origin from
the configured `PUBLIC_WEB_URL` origin or the page's verified domain origin;
their CORS response allows that origin, without credentialed cookies. Tokens
are accepted only in the JSON body, never query parameters. Confirmation and
unsubscribe email links always use `PUBLIC_WEB_URL` with fragment capabilities
removed before router/analytics initialization. The visitor must explicitly
redeem the action. Unsubscribe remains possible after unpublication.

Addresses and capabilities remain encrypted at rest, with page-specific email
hashes for deduplication. Public responses do not disclose whether an address
exists. Changing the provider, disabling delivery or changing delivery settings
cancels unsent jobs from the old configuration; already-started sends may finish.
Provider acceptance records an outbound receipt rather than guaranteed inbox
placement. See the [communication guide](uptime/status-communication.md) for
the complete owner and subscriber workflow.
