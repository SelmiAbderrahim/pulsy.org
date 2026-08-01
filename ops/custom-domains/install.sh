#!/usr/bin/env bash
# ============================================================================
# Pulsy — install the custom-domain provisioner (systemd timer)
# ============================================================================
# Idempotent: safe to re-run on every deploy. Installs/refreshes the systemd
# units that run provision-daemon.sh, enables the timer, and runs one reconcile.
#
# Must run as root (writes /etc/systemd/system, manages systemd). Run via:
#     sudo make custom-domains-install
#   or:
#     sudo ops/custom-domains/install.sh
#
# A Docker entrypoint can't do this: the daemon reloads the HOST nginx that owns
# :443 and uses the host's certbot — neither is reachable from a container.
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$(cd "$HERE/../.." && pwd)/.env}"

if [[ "$(id -u)" -ne 0 ]]; then
	echo "This installer must run as root. Try:  sudo make custom-domains-install" >&2
	exit 1
fi

# Read the one installer-owned setting as data, never by sourcing the root env
# as shell code. A real process environment value takes precedence.
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

load_env_value_if_unset ACME_WEBROOT

echo "[install] daemon: $HERE/provision-daemon.sh"
chmod +x "$HERE/provision-daemon.sh"

ACME_WEBROOT="${ACME_WEBROOT:-/var/www/pulsy-acme}"
echo "[install] ACME webroot: $ACME_WEBROOT"
mkdir -p "$ACME_WEBROOT/.well-known/acme-challenge"
chmod 755 "$ACME_WEBROOT"

echo "[install] renewal deploy hook (reload nginx after any cert renewal)"
HOOK=/etc/letsencrypt/renewal-hooks/deploy/pulsy-reload-nginx.sh
mkdir -p "$(dirname "$HOOK")"
cat > "$HOOK" <<'EOF'
#!/bin/sh
# Installed by ops/custom-domains/install.sh — reload nginx so renewed
# certificates are picked up (custom-domain vhosts use certonly, no installer).
systemctl reload nginx
EOF
chmod +x "$HOOK"

echo "[install] copying systemd units"
# The .service ships with placeholder /opt/pulsy paths; rewrite ExecStart
# + ENV_FILE to THIS repo's actual location so the daemon runs wherever it's
# checked out (no manual edit, no 203/EXEC from a wrong path).
sed -E \
	-e "s#^Environment=ENV_FILE=.*#Environment=ENV_FILE=${ENV_FILE}#" \
	-e "s#^ExecStart=.*#ExecStart=${HERE}/provision-daemon.sh#" \
	"$HERE/pulsy-custom-domains.service" > /etc/systemd/system/pulsy-custom-domains.service
chmod 0644 /etc/systemd/system/pulsy-custom-domains.service
install -m 0644 "$HERE/pulsy-custom-domains.timer"   /etc/systemd/system/pulsy-custom-domains.timer

echo "[install] reloading systemd + enabling timer"
systemctl daemon-reload
systemctl enable --now pulsy-custom-domains.timer

# Warn (don't fail) on missing config so the operator can fix .env and re-run.
if [[ -f "$ENV_FILE" ]]; then
	grep -q '^CERTBOT_EMAIL=.\+' "$ENV_FILE" \
		|| echo "[install] WARNING: CERTBOT_EMAIL is empty in $ENV_FILE (certbot will fail)"
	if ! grep -q '^CUSTOM_DOMAIN_IP=.\+' "$ENV_FILE" \
		&& ! grep -q '^CUSTOM_DOMAIN_CNAME_TARGET=.\+' "$ENV_FILE"; then
		echo "[install] WARNING: set CUSTOM_DOMAIN_IP or CUSTOM_DOMAIN_CNAME_TARGET in $ENV_FILE"
	fi
else
	echo "[install] WARNING: $ENV_FILE not found"
fi

echo "[install] running one reconcile now"
systemctl start pulsy-custom-domains.service || true

echo "[install] done. Status:"
systemctl --no-pager status pulsy-custom-domains.timer | sed -n '1,4p' || true
echo "---- recent daemon log ----"
journalctl -u pulsy-custom-domains.service -n 15 --no-pager || true
