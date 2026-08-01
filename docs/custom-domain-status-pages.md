# Custom-Domain Status Pages

A **status page** is a public page that shows the live status of the monitors
you choose. Pulsy lets you create several named pages, publish them
independently, and — on a paid plan, or **free when you self-host** — serve each
one from your own domain (e.g. `https://status.acme.com`).

## Pages, slugs, and URLs

Each status page has a per-account **slug** and is reachable on the app host at:

```
https://<your-pulsy-host>/status/<userId>/<slug>
```

The page named `default` also backs the legacy account URL
`https://<your-pulsy-host>/status/<userId>`. A page only resolves publicly once
you **publish** it; unpublished and non-existent pages are indistinguishable
(both return "not found").

A page exposes only safe, aggregate data — each monitor's name, current status,
uptime %, last response time, the overall status, and incidents from the last 7
days. URLs, TLS details, notification channels, credentials, and your account
identity are never exposed.

## Choosing what a page shows

Open **Status pages**, create or edit a page, and select the monitors to
include. Membership is managed entirely from this screen — there is no longer a
per-monitor "show on status page" toggle. Monitors you later delete or pause
simply drop off the page.

## Custom domain (CNAME + TXT verification)

To serve a page from your own domain you create **two** DNS records — one to
**route** traffic to the server, one to **prove ownership**:

1. **Attach the domain** on the page's **Custom domain** card (e.g.
   `status.acme.com`). Pulsy shows both records to publish.
2. **Point the domain at Pulsy** (the routing record). This is what makes the
   hostname actually resolve — without it the browser gets "site can't be
   reached". Use the target Pulsy shows:

   | Type  | Name              | Value                          |
   |-------|-------------------|--------------------------------|
   | CNAME | `status.acme.com` | `<routing target Pulsy shows>` |

   Keep it **DNS-only** (e.g. Cloudflare grey cloud) so automatic certificate
   issuance can reach the server over HTTP.
3. **Add the TXT record** (ownership challenge) at your DNS provider:

   | Type | Name                            | Value                     |
   |------|---------------------------------|---------------------------|
   | TXT  | `_pulsy-verify.status.acme.com` | *(the value Pulsy shows)* |

4. Click **Verify**. Pulsy resolves the TXT record over DNS (no outbound HTTP
   request is made to your domain). Once it matches, the domain is verified.

After verification the **Custom domain** card shows the provisioning state:
*Issuing TLS certificate…* → **Live**. If it stays pending or fails, the message
tells you what to fix (usually the routing record not yet pointing at the
server). **Detach** clears the domain, its verification, and the edge config.

### TLS / certificates

Verifying a domain proves you own it; it does not by itself serve traffic — the
**routing record + TLS** do that.

- **Managed host-nginx deployment** (the default cloud setup): TLS is fully
  automated. Once a verified domain points at the server, a root systemd timer
  (`ops/custom-domains/`) writes an nginx vhost it fully owns and obtains a Let's
  Encrypt certificate via `certbot certonly --webroot`, then marks the page
  **Live**. Certificates **auto-renew** (the system certbot timer + a deploy hook
  that reloads nginx), and detaching a domain removes its vhost and certificate —
  no manual certbot steps. See `ops/custom-domains/README.md` for installation and
  the required env (`CUSTOM_DOMAIN_CNAME_TARGET` / `CUSTOM_DOMAIN_IP`,
  `CERTBOT_EMAIL`).
- **Self-hosted / other proxies** (Traefik, Caddy, manual nginx): Pulsy runs no
  in-app ACME. Terminate TLS for `status.acme.com` at your proxy, and ensure it
  **forwards the original `Host` header** to the Pulsy server so the page
  resolves by domain.

## Plans

| Capability                         | Self-hosted (payments off) | Free | Pro | Team |
|------------------------------------|:-------------------------:|:----:|:---:|:----:|
| Number of status pages             | No plan cap               | 1    | 5   | 25   |
| Custom domains                     | ✓                         | —    | ✓   | ✓    |

When payments are disabled (the default for self-hosting), Pulsy may return the
`team_yearly` row as compatibility metadata, but it bypasses the numeric and
capability guards. All status-page features are available without a plan cap.

App-host detection uses `VITE_APP_URL`, which is baked into the web bundle at
build time: any host other than that is treated as a custom status-page domain.
It **must** be set for custom domains to render — if it's empty, every host
(including custom ones) falls through to the normal app entry flow.
