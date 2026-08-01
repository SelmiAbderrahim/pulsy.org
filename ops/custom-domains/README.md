# Custom status-page domains — automated edge provisioning

Pulsy resolves a status page by the request's `Host` header
(`public.statusPageByDomain`), and the SPA renders the custom-domain page when
the browser is on any host other than `VITE_APP_URL`
(`apps/web/src/lib/status-domain.ts`). What the app does **not** do is terminate
TLS or route arbitrary hostnames — that is the operator's edge.

This directory automates that edge for the **host-nginx + certbot** deployment
(the public entrypoint is host nginx on `:80/:443`; Pulsy containers listen on
`127.0.0.1:3000` (web) and `127.0.0.1:4000` (server)).

A root systemd timer runs `provision-daemon.sh` ~every 60s. It reconciles nginx
vhosts + Let's Encrypt certs against the set of **verified** custom domains in
the DB and writes the result back to `domainProvisionStatus`
(`pending` / `active` / `failed`) for the dashboard to show.

## How a domain goes live

1. User attaches `status.example.com` in the dashboard and is shown **two** DNS
   records to create:
   - **Routing** — `CNAME status.example.com -> <CUSTOM_DOMAIN_CNAME_TARGET>`
     (or `A -> <CUSTOM_DOMAIN_IP>`). Must be **DNS-only** (e.g. Cloudflare grey
     cloud) so the HTTP-01 challenge reaches this nginx.
   - **Ownership** — `TXT _pulsy-verify.status.example.com = <token>`.
2. User clicks **Verify** → the server confirms the TXT record and sets
   `domainProvisionStatus = 'pending'`.
3. The daemon picks it up. It writes `pulsy-custom-status.example.com` (an HTTP
   vhost that serves the ACME webroot challenge and redirects to HTTPS) and, once
   the domain resolves to this server, issues the cert with
   **`certbot certonly --webroot`** — obtain only, certbot never edits nginx. It
   then re-writes the vhost with the HTTPS block, reloads nginx, and sets `active`.
4. `https://status.example.com` now serves the status page.

If DNS isn't pointed yet, the domain stays `pending` with an explanatory message
and is retried automatically on the next tick. If a certificate already exists
(e.g. issued out-of-band), the daemon simply writes the full vhost and goes
`active` — no DNS check or re-issue.

### Certificate lifecycle (SSL)

The daemon **owns the whole vhost** (HTTP + HTTPS); certbot only ever *obtains*
certificates, never installs them. That avoids the
`Could not automatically find a matching server block` class of failures you get
from `certbot --nginx` when no vhost exists yet.

- **Issue** — `certbot certonly --webroot -w $ACME_WEBROOT` (ECDSA). Set
  `CERTBOT_STAGING=1` to test against the Let's Encrypt staging CA.
- **Renew** — handled by the system's existing `certbot.renew` timer. The
  installer drops `/etc/letsencrypt/renewal-hooks/deploy/pulsy-reload-nginx.sh`,
  which reloads nginx after any successful renewal so new certs are picked up.
- **Remove** — detaching a domain removes its `pulsy-custom-*` vhost **and**
  runs `certbot delete --cert-name <domain>` so it doesn't linger and fail to
  renew.

> **Never run `certbot --nginx -d <domain>` by hand for a custom domain.** It
> tries to *install* into a server block that the daemon manages and will error
> with "Could not find a matching server block". Let the daemon handle it (or use
> `certbot certonly --webroot -w $ACME_WEBROOT -d <domain>` if you must issue
> manually); the daemon installs the cert by writing the vhost on its next run.

## Safety

The daemon only ever creates/removes files named **`pulsy-custom-*`** (and
deletes certs only for domains no longer in the verified set). Every other vhost
and certificate on the box is untouched. A cert can only be issued for a domain
the user both **owns** (TXT challenge) and has **pointed at us** (HTTP-01 webroot),
so this cannot be abused to mint certs for domains you don't control.

## Install (one command, re-runnable)

```bash
sudo make custom-domains-install     # = sudo ops/custom-domains/install.sh
```

This is idempotent — run it once per host, and safely again on every deploy. It
copies the systemd units, enables the timer, runs one reconcile, and prints the
status + recent log. It must run as **root** (it manages systemd; the daemon it
schedules reloads the host nginx and runs certbot). A Docker entrypoint can't do
this — the host nginx owns `:443` and certbot lives on the host, neither
reachable from a container.

### nginx upstreams

The per-domain vhost references `pulsy_web` / `pulsy_server`, the
`$connection_upgrade` map, and the rate-limit zones. On the existing
single-domain host these are already defined globally by the `pulsy.example.com`
vhost, so nothing more is needed. For a **fresh** host (no Pulsy vhost yet),
install the shared definitions once and remove the duplicates from your primary
vhost:

```bash
sudo cp conf.d/pulsy-shared.conf /etc/nginx/conf.d/pulsy-shared.conf
# then delete the duplicate `upstream pulsy_web {}` / `pulsy_server {}`,
# `map $http_upgrade ...`, and `limit_req_zone ...` from your app vhost.
sudo nginx -t && sudo systemctl reload nginx
```

### Manual fallback

```bash
cd /opt/pulsy/ops/custom-domains
sudo install -m 0644 pulsy-custom-domains.service pulsy-custom-domains.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pulsy-custom-domains.timer
```

## Required config (root `.env`)

```ini
# Routing target advertised to users (CNAME preferred; A fallback).
CUSTOM_DOMAIN_CNAME_TARGET=ingress.example.com   # A record -> this server's IP
CUSTOM_DOMAIN_IP=                               # or set the IP directly
CERTBOT_EMAIL=ops@example.com
CERTBOT_STAGING=                               # 1/true to use LE staging while testing
ACME_WEBROOT=                                  # optional; default /var/www/pulsy-acme
USE_DOCKER_PSQL=1                              # recommended for the Compose stack
DB_CONTAINER=pulsy-postgres                    # Docker DB container name
DB_USER=                                       # optional; derived from DATABASE_URL
DB_NAME=                                       # optional; derived from DATABASE_URL

# App canonical host — anything else is treated as a custom domain. Baked into
# the web bundle at build (rebuild pulsy-web after changing).
VITE_APP_URL=https://status.example.com
```

`docker/docker-compose.yml` maps `CUSTOM_DOMAIN_*` into the web build args
(`VITE_CUSTOM_DOMAIN_*`) so the dashboard can show the routing record. The
daemon reads `DATABASE_URL`, `CERTBOT_EMAIL`, `CUSTOM_DOMAIN_*`, `CERTBOT_STAGING`,
`ACME_WEBROOT`, `DNS_RESOLVERS`, and the optional `USE_DOCKER_PSQL`/`DB_*`
overrides from `.env`. The installer reads `ACME_WEBROOT` from the same file so
it creates the exact directory later served by the daemon.

> DNS for the routing check is resolved against public resolvers
> (`DNS_RESOLVERS`, default `1.1.1.1,8.8.8.8`), **not** the host's
> `systemd-resolved`. The host resolver caches NXDOMAIN, so a domain queried
> before its A record existed would otherwise stay "unresolvable" for the
> negative-TTL and stall provisioning. Set `DNS_RESOLVERS` only if those public
> resolvers are blocked from this host.

Dependencies on the host: `nginx`, `certbot` (the core CLI — webroot issuance
needs **no** nginx plugin), `psql` (postgresql-client) **or** Docker access to the
`pulsy-postgres` container, `dig` (dnsutils), `envsubst` (gettext-base).

## Operate / debug

```bash
sudo systemctl start pulsy-custom-domains.service   # run a reconcile now
journalctl -u pulsy-custom-domains.service -n 50    # daemon log
cat /tmp/pulsy-certbot-<domain>.log                 # certbot output for a domain
```

> Cloudflare-proxied (orange-cloud) custom domains won't pass HTTP-01 here and
> would resolve to a Cloudflare IP, not this server. For those, either use
> DNS-only mode, or front custom domains with Cloudflare for SaaS instead of
> this daemon.
