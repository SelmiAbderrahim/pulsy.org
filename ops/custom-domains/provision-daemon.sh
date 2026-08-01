#!/usr/bin/env bash
# ============================================================================
# Pulsy — custom status-page domain provisioning daemon
# ============================================================================
# Reconciles host nginx vhosts + Let's Encrypt certs against the set of VERIFIED
# custom domains in the Pulsy database. Runs as root (writes /etc/nginx, runs
# certbot + nginx) on a systemd timer. The Pulsy container stays unprivileged
# and never touches nginx/ACME — it only sets domainProvisionStatus='pending'.
#
# Safety: this script ONLY ever creates/removes files named "pulsy-custom-*".
# Every other vhost on the box is invisible to it.
#
# The daemon OWNS the whole vhost (HTTP + HTTPS). certbot only ever OBTAINS the
# cert (certonly --webroot) — it never edits nginx — which avoids the
# "Could not find a matching server block" failures of `certbot --nginx`.
#
# Flow per verified domain:
#   1. Cert already exists -> write the full vhost (HTTP+HTTPS), reload, 'active'.
#      (No DNS check / no certbot — installs an out-of-band or renewed cert too.)
#   2. No cert yet -> write the HTTP-only vhost (serves the ACME webroot
#      challenge + redirects to HTTPS), reload.
#   3. DNS must resolve to THIS server (grey-cloud / DNS-only). If not -> status
#      'pending' with a helpful message, retried next run.
#   4. certbot certonly --webroot -> on success re-write the vhost WITH the HTTPS
#      block, reload, 'active'. On failure -> 'failed' with the error.
# Renewal is handled by the system certbot timer + a deploy hook that reloads
# nginx (installed by install.sh). Domains no longer verified -> their
# pulsy-custom vhost is removed and the cert is `certbot delete`d.
#
# Config (env, or sourced from $ENV_FILE):
#   DATABASE_URL                 postgres connection string (host-reachable, or
#                                used to derive the DB user/name for the docker
#                                fallback when host `psql` is absent)
#   CERTBOT_EMAIL                (required) Let's Encrypt registration email
#   CUSTOM_DOMAIN_IP             this server's public IP (the expected A target)
#   CUSTOM_DOMAIN_CNAME_TARGET   stable host whose A record is this server
#                                (used to derive the expected IP if no IP set)
#   CERTBOT_STAGING              truthy -> use the LE staging CA (testing)
#   ACME_WEBROOT                 webroot for the http-01 challenge
#                                (default /var/www/pulsy-acme)
#   DB access: uses host `psql "$DATABASE_URL"` when available; otherwise falls
#   back to `docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME` (override
#   DB_CONTAINER / DB_USER / DB_NAME, or set USE_DOCKER_PSQL=1 to force it).
# ============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/pulsy/.env}"
PREFIX="pulsy-custom-"
SITES_AVAILABLE="${NGINX_SITES_AVAILABLE:-/etc/nginx/sites-available}"
SITES_ENABLED="${NGINX_SITES_ENABLED:-/etc/nginx/sites-enabled}"
TEMPLATE_HTTP="${VHOST_HTTP_TEMPLATE:-$(dirname "$0")/vhost-http.template}"
TEMPLATE_HTTPS="${VHOST_HTTPS_TEMPLATE:-$(dirname "$0")/vhost-https.template}"

log() { echo "[pulsy-custom-domains] $*"; }

# Load an explicit allowlist from the root .env as data, never as executable
# shell. Values already present in the process environment take precedence.
load_env_value_if_unset() {
	local key="$1" line value
	[[ -n "${!key+x}" || ! -f "$ENV_FILE" ]] && return
	line="$(grep -m1 -E "^${key}=" "$ENV_FILE" || true)"
	[[ -z "$line" ]] && return
	value="${line#*=}"; value="${value%$'\r'}"
	if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then
		value="${BASH_REMATCH[1]}"
	fi
	printf -v "$key" '%s' "$value"
	export "${key?}"
}

for config_key in \
	DATABASE_URL CERTBOT_EMAIL CUSTOM_DOMAIN_IP CUSTOM_DOMAIN_CNAME_TARGET \
	CERTBOT_STAGING ACME_WEBROOT DNS_RESOLVERS USE_DOCKER_PSQL \
	DB_CONTAINER DB_USER DB_NAME; do
	load_env_value_if_unset "$config_key"
done

: "${CERTBOT_EMAIL:?CERTBOT_EMAIL is required}"

# Shared ACME webroot the :80 vhost serves /.well-known/acme-challenge from.
ACME_WEBROOT="${ACME_WEBROOT:-/var/www/pulsy-acme}"
# Use the Let's Encrypt staging CA when CERTBOT_STAGING is truthy (avoids rate
# limits while testing; certs won't be browser-trusted).
CERTBOT_STAGING_FLAG=""
case "${CERTBOT_STAGING:-}" in 1|true|yes|on) CERTBOT_STAGING_FLAG="--staging" ;; esac

# --- DB access: host psql if present, else docker exec into the DB container ---
DB_CONTAINER="${DB_CONTAINER:-pulsy-postgres}"
if [[ -n "${DATABASE_URL:-}" ]]; then
	DB_USER="${DB_USER:-$(sed -E 's#.*://([^:/]+):.*#\1#' <<<"$DATABASE_URL")}"
	DB_NAME="${DB_NAME:-$(sed -E 's#.*/([^/?]+)(\?.*)?$#\1#' <<<"$DATABASE_URL")}"
fi
DB_USER="${DB_USER:-pulsy}"; DB_NAME="${DB_NAME:-pulsy}"

if command -v psql >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" && "${USE_DOCKER_PSQL:-}" != "1" ]]; then
	psql_do() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "$1"; }
else
	psql_do() { docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -At -c "$1"; }
fi

# Resolve against public DNS, NOT the host resolver: systemd-resolved caches
# NXDOMAIN, so a domain queried before its A record existed stays "unresolvable"
# for the negative-TTL even after the user adds it — stalling provisioning for
# any domain. Override with DNS_RESOLVERS (comma-separated) if 1.1.1.1/8.8.8.8
# are blocked. resolve_a echoes the last A record (or nothing).
DNS_RESOLVERS="${DNS_RESOLVERS:-1.1.1.1,8.8.8.8}"
resolve_a() { # host
	local r
	IFS=',' read -ra _rs <<<"$DNS_RESOLVERS"
	for r in "${_rs[@]}"; do
		local out
		out="$(dig +short +time=5 +tries=2 A "$1" "@${r// /}" 2>/dev/null \
			| grep -E '^[0-9.]+$' | tail -n1 || true)"
		[[ -n "$out" ]] && { echo "$out"; return 0; }
	done
}

# Determine the IP a correctly-pointed domain must resolve to.
EXPECTED_IP="${CUSTOM_DOMAIN_IP:-}"
if [[ -z "$EXPECTED_IP" && -n "${CUSTOM_DOMAIN_CNAME_TARGET:-}" ]]; then
	EXPECTED_IP="$(resolve_a "$CUSTOM_DOMAIN_CNAME_TARGET" || true)"
fi
if [[ -z "$EXPECTED_IP" ]]; then
	log "ERROR: set CUSTOM_DOMAIN_IP or a resolvable CUSTOM_DOMAIN_CNAME_TARGET"; exit 1
fi

set_status() { # domain status error
	local d="$1" s="$2" e="${3:-}"
	if [[ -z "$e" ]]; then
		psql_do "UPDATE uptime_status_page SET \"domainProvisionStatus\"='$s', \"domainProvisionError\"=NULL$( [[ $s == active ]] && echo ", \"domainProvisionedAt\"=now()::text" ) WHERE \"customDomain\"='$d';" >/dev/null
	else
		# single-quote-escape the error for SQL
		e="${e//\'/\'\'}"
		psql_do "UPDATE uptime_status_page SET \"domainProvisionStatus\"='$s', \"domainProvisionError\"='$e' WHERE \"customDomain\"='$d';" >/dev/null
	fi
}

reload_nginx() { nginx -t >/dev/null 2>&1 && systemctl reload nginx; }

# Write the vhost for a domain: always the HTTP block (serves the ACME challenge
# + redirects to HTTPS); append the HTTPS block ONLY when the cert exists, so
# `nginx -t` never references missing cert files. Then (re)link it enabled.
render_vhost() { # domain
	local d="$1" vhost="$SITES_AVAILABLE/${PREFIX}$1"
	# envsubst needs literal placeholder names.
	# shellcheck disable=SC2016
	DOMAIN="$d" ACME_WEBROOT="$ACME_WEBROOT" \
		envsubst '${DOMAIN} ${ACME_WEBROOT}' < "$TEMPLATE_HTTP" > "$vhost"
	if [[ -f "/etc/letsencrypt/live/$d/fullchain.pem" ]]; then
		# envsubst needs a literal placeholder name.
		# shellcheck disable=SC2016
		DOMAIN="$d" envsubst '${DOMAIN}' < "$TEMPLATE_HTTPS" >> "$vhost"
	fi
	ln -sf "$vhost" "$SITES_ENABLED/${PREFIX}$d"
}

# Reject anything that isn't a plain hostname before it touches the shell/FS/SQL.
valid_domain() { [[ "$1" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$ ]]; }

# --- desired set: verified custom domains ---------------------------------
mapfile -t DESIRED < <(psql_do "SELECT \"customDomain\" FROM uptime_status_page WHERE \"domainVerified\"=true AND \"customDomain\" IS NOT NULL;" || true)

declare -A WANT=()
for d in "${DESIRED[@]}"; do
	[[ -z "$d" ]] && continue
	if ! valid_domain "$d"; then log "skip invalid domain: $d"; continue; fi
	WANT["$d"]=1

	cert="/etc/letsencrypt/live/${d}/fullchain.pem"

	# Cert already exists (incl. one issued out-of-band) → just serve it: write the
	# full vhost (HTTP+HTTPS) and reload. No DNS check or certbot call needed.
	if [[ -f "$cert" ]]; then
		render_vhost "$d"
		if reload_nginx; then
			set_status "$d" active
		else
			set_status "$d" failed "nginx config test failed while installing the certificate for $d"
		fi
		continue
	fi

	# No cert yet — render the HTTP-only vhost so the ACME webroot challenge is
	# served, then issue once DNS points at this server (DNS-only / grey cloud).
	render_vhost "$d"
	if ! reload_nginx; then
		set_status "$d" failed "nginx config test failed while adding $d"
		continue
	fi

	resolved="$(resolve_a "$d" || true)"
	if [[ "$resolved" != "$EXPECTED_IP" ]]; then
		log "$d: DNS not pointing here (got '${resolved:-none}', want '$EXPECTED_IP')"
		set_status "$d" pending "DNS for $d does not point to this server yet (resolved ${resolved:-nothing}, expected $EXPECTED_IP). Create the routing record, then it provisions automatically."
		continue
	fi

	log "$d: requesting certificate (certonly --webroot)"
	if certbot certonly --webroot -w "$ACME_WEBROOT" -d "$d" \
		--non-interactive --agree-tos -m "$CERTBOT_EMAIL" --key-type ecdsa \
		$CERTBOT_STAGING_FLAG >/tmp/pulsy-certbot-"$d".log 2>&1; then
		render_vhost "$d" # now includes the HTTPS block
		reload_nginx || true
		set_status "$d" active
		log "$d: provisioned"
	else
		log "$d: certbot failed (see /tmp/pulsy-certbot-$d.log)"
		set_status "$d" failed "Certificate issuance failed. Confirm $d resolves to this server over plain HTTP (no proxy), then it retries automatically."
	fi
done

# --- cleanup: remove pulsy-custom vhosts no longer wanted ------------------
shopt -s nullglob
for f in "$SITES_AVAILABLE/${PREFIX}"*; do
	d="$(basename "$f")"; d="${d#"$PREFIX"}"
	if [[ -z "${WANT[$d]:-}" ]]; then
		log "removing stale vhost + certificate for $d"
		rm -f "$f" "$SITES_ENABLED/${PREFIX}${d}"
		reload_nginx || true
		# Drop the cert + its renewal config so it doesn't fail to renew later.
		certbot delete --cert-name "$d" --non-interactive >/dev/null 2>&1 || true
	fi
done

log "reconcile complete (${#WANT[@]} active domain(s))"
