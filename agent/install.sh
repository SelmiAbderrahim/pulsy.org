#!/bin/bash
# Pulsy agent v1.0.0. Never accept credentials as CLI arguments or environment variables.
set -euo pipefail
umask 077
version=1.0.0
mode=install
origin=
credential_stdin=false
usage() { echo 'Usage: install.sh [--upgrade|--rotate|--uninstall|--compose] [--credential-stdin] [https://pulsy-origin]' >&2; exit 1; }
while [[ $# -gt 0 ]]; do
  case $1 in
    --uninstall|--upgrade|--rotate|--compose) [[ $mode == install ]] || usage; mode=${1#--};;
    --credential-stdin) [[ $credential_stdin == false ]] || usage; credential_stdin=true;;
    --*) usage;;
    *) [[ -z $origin ]] || usage; origin=$1;;
  esac
  shift
done
if [[ $credential_stdin == true && ( $mode == uninstall || $mode == upgrade ) ]]; then usage; fi
[[ $(id -u) == 0 ]] || { echo 'Run this installer with sudo.' >&2; exit 1; }
[[ $(uname -s) == Linux ]] || { echo 'Linux is required.' >&2; exit 1; }
case $(uname -m) in x86_64) arch=amd64;; aarch64|arm64) arch=arm64;; *) echo 'Only Linux amd64 and arm64 are supported.' >&2; exit 1;; esac
config=/etc/pulsy-agent/config.json
compose_dir=/opt/pulsy-agent
if [[ $mode == uninstall ]]; then
  systemctl disable --now pulsy-agent.service 2>/dev/null || true
  rm -f /etc/systemd/system/pulsy-agent.service /usr/local/bin/pulsy-agent
  rm -f "$config"
  rmdir /etc/pulsy-agent /usr/local/lib/pulsy-agent 2>/dev/null || true
  systemctl daemon-reload
  echo 'Systemd agent removed. The dedicated account is retained; remove it with userdel pulsy-agent if unused.'
  exit 0
fi
for command in curl sha256sum python3 install; do command -v "$command" >/dev/null || { echo "Required command: $command" >&2; exit 1; }; done
if [[ $mode != compose ]]; then command -v systemctl >/dev/null && [[ -d /run/systemd/system ]] || { echo 'A running systemd installation is required.' >&2; exit 1; }; fi
if [[ $mode == compose ]]; then command -v docker >/dev/null && docker compose version >/dev/null 2>&1 || { echo 'Docker with the Compose plugin is required (docker compose version).' >&2; exit 1; }; fi
credential=
if [[ $credential_stdin == true ]]; then
  IFS= read -r credential || true
  [[ $credential =~ ^[A-Za-z0-9_-]{43}$ ]] || { echo 'Invalid agent credential.' >&2; exit 1; }
fi
if [[ -z $origin && -f $config ]]; then origin=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["origin"])' "$config"); fi
if [[ -z $origin ]]; then read -r -p 'Pulsy HTTPS origin: ' origin </dev/tty; fi
python3 - "$origin" <<'PY'
import sys, urllib.parse
u=urllib.parse.urlsplit(sys.argv[1])
if u.scheme!='https' or not u.hostname or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:
    raise SystemExit('Provide an HTTPS origin without credentials, path, query or fragment.')
PY
origin=${origin%/}
install -d -m 0755 /usr/local/lib/pulsy-agent
temporary=$(mktemp -d /usr/local/lib/pulsy-agent/install.XXXXXXXX)
trap 'rm -rf "$temporary"' EXIT
base="$origin/api/agent/releases/v$version"
for artifact in "pulsy-agent-linux-$arch" SHA256SUMS compose.yaml; do
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 120 "$base/$artifact" -o "$temporary/$artifact"
done
(
  cd "$temporary"
  # Check only selected artifacts, require exactly one checksum entry for each.
  python3 - "$arch" <<'PY'
import hashlib, pathlib, sys
lines=pathlib.Path('SHA256SUMS').read_text().splitlines()
for name in ('pulsy-agent-linux-'+sys.argv[1], 'compose.yaml'):
    matches=[line.split() for line in lines if len(line.split())==2 and line.split()[1]==name]
    if len(matches)!=1 or hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()!=matches[0][0]:
        raise SystemExit('Artifact checksum verification failed.')
PY
)
chmod 0755 "$temporary/pulsy-agent-linux-$arch"
if [[ $mode == compose ]]; then
  install -d -m 0755 "$compose_dir"
  install -m 0755 "$temporary/pulsy-agent-linux-$arch" "$compose_dir/pulsy-agent.new"
  mv -f "$compose_dir/pulsy-agent.new" "$compose_dir/pulsy-agent"
  install -m 0644 "$temporary/compose.yaml" "$compose_dir/compose.yaml"
  config="$compose_dir/config.json"
else
  if ! id pulsy-agent >/dev/null 2>&1; then useradd --system --no-create-home --shell /usr/sbin/nologin pulsy-agent; fi
  install -d -m 0750 -o root -g pulsy-agent /etc/pulsy-agent
fi
# --credential-stdin reads one line from stdin (piped by the copied command) into a
# 0600 file in the root-only temporary directory. Otherwise getpass opens /dev/tty,
# so the hidden prompt also works with curl|sudo bash. Neither path echoes it.
if [[ ! -f $config || $mode == rotate || $mode == compose || $credential_stdin == true ]]; then
  credential_file=
  if [[ $credential_stdin == true ]]; then credential_file="$temporary/credential"; printf '%s' "$credential" > "$credential_file"; credential=; fi
  python3 - "$origin" "$temporary/config.json" "$mode" "$credential_file" <<'PY'
import getpass,json,os,re,sys
token=open(sys.argv[4]).read() if sys.argv[4] else getpass.getpass('Agent credential (hidden): ')
if not re.fullmatch(r'[A-Za-z0-9_-]{43}',token): raise SystemExit('Invalid agent credential.')
config={'origin':sys.argv[1],'token':token,'interval':60,'proc':'/host/proc' if sys.argv[3]=='compose' else '/proc','root':'/host/root' if sys.argv[3]=='compose' else '/'}
with open(sys.argv[2],'x') as f: json.dump(config,f)
os.chmod(sys.argv[2],0o600)
PY
  "$temporary/pulsy-agent-linux-$arch" -config "$temporary/config.json" -check-config
  if [[ $mode == compose ]]; then install -m 0600 -o 65532 -g 65532 "$temporary/config.json" "$config"; else install -m 0600 -o pulsy-agent -g pulsy-agent "$temporary/config.json" "$config"; fi
else
  "$temporary/pulsy-agent-linux-$arch" -config "$config" -check-config
fi
if [[ $mode == compose ]]; then
  docker compose --project-directory "$compose_dir" up -d --force-recreate
  sleep 3
  if [[ -z $(docker compose --project-directory "$compose_dir" ps --status running --quiet pulsy-agent) ]]; then
    docker compose --project-directory "$compose_dir" logs --tail 30 pulsy-agent >&2 || true
    echo 'The Pulsy agent container is not running.' >&2
    exit 1
  fi
  echo "Pulsy agent $version running in Docker. Inspect with: docker compose --project-directory $compose_dir logs pulsy-agent"
  exit 0
fi
install -m 0755 "$temporary/pulsy-agent-linux-$arch" /usr/local/bin/pulsy-agent.new
mv -f /usr/local/bin/pulsy-agent.new /usr/local/bin/pulsy-agent
cat > /etc/systemd/system/pulsy-agent.service <<'UNIT'
[Unit]
Description=Pulsy Linux server health agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pulsy-agent
Group=pulsy-agent
ExecStart=/usr/local/bin/pulsy-agent -config /etc/pulsy-agent/config.json
Restart=on-failure
RestartSec=10
TimeoutStopSec=15
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=
UMask=0077
MemoryMax=64M
TasksMax=32

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable pulsy-agent.service
systemctl restart pulsy-agent.service
echo "Pulsy agent $version installed. Inspect with: systemctl status pulsy-agent"
