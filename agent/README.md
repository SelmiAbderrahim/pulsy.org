# Pulsy Linux agent

The agent supports Linux amd64 and arm64. Create a server monitor in Pulsy, then
run the installation command shown in its setup view. The Pulsy deployment serves
the installer, matching binaries and SHA-256 checksums under
`/api/agent/releases/v1.0.0/`. No external release upload is required.

## Systemd

The host needs Bash, curl, Python 3, coreutils, useradd and a running systemd.
Use the HTTPS origin of your own Pulsy deployment:

```sh
PULSY_ORIGIN=https://your-pulsy.example
curl --fail --proto '=https' --tlsv1.2 "$PULSY_ORIGIN/api/agent/releases/v1.0.0/install.sh" -o /tmp/pulsy-agent-install.sh
sudo bash /tmp/pulsy-agent-install.sh "$PULSY_ORIGIN"
```

The installer prompts for the agent credential through the terminal without
echoing it. Never pass it as an argument, URL or environment variable. For an
unattended install, `--credential-stdin` reads it as one line from standard
input instead; this is what the command copied right after creating or rotating
the credential does (`printf '%s\n' '<credential>' | sudo bash … --credential-stdin`).
`printf` is a shell builtin, so the credential never appears in the process list,
but it is kept in the host's shell history. With `--credential-stdin` the
configuration is always rewritten with the supplied credential.
It downloads the versioned binary, checks its SHA-256 digest, creates a dedicated
`pulsy-agent` account, writes `/etc/pulsy-agent/config.json` with mode 0600 and
starts the service. Reinstalling retains an existing valid configuration.

```sh
systemctl status pulsy-agent
journalctl -u pulsy-agent
sudo bash /tmp/pulsy-agent-install.sh --upgrade
sudo systemctl restart pulsy-agent
sudo bash /tmp/pulsy-agent-install.sh --rotate
sudo bash /tmp/pulsy-agent-install.sh --uninstall
```

For a new release, download that release's installer before upgrading. Rotation
first happens in Pulsy; the previous credential immediately stops working. Run
`--rotate` and enter the new credential to restart the agent with it. Uninstall
removes the binary, service and credential configuration, but retains the service
account. If unused, remove the account with `sudo userdel pulsy-agent`. Delete the
monitor in Pulsy separately to remove its history.

## Docker Compose

Run the same installer with `--compose`. It requires Docker with the Compose
plugin, prepares `/opt/pulsy-agent` with the verified binary, Compose file and
mode-0600 config owned by UID/GID 65532, then starts the container with
`docker compose --project-directory /opt/pulsy-agent up -d --force-recreate`
and fails, printing its logs, if it is not running:

```sh
sudo bash /tmp/pulsy-agent-install.sh --compose "$PULSY_ORIGIN"
```

The container runs as UID 65532 with all capabilities dropped, read-only root,
no Docker socket and no privileged mode. The host `/proc` and `/` are mounted
read-only at `/host/proc` and `/host/root`; configuration selects those paths.
This is **host monitoring**, not container CPU/memory limits. The host CA bundle
is mounted read-only for HTTPS verification. On hosts with `hidepid`, restricted
mount metadata or directory permissions, some filesystem metrics can be
unavailable. Grant only the read/traversal permissions you intend to expose.
The root mount exposes host files to the agent's unprivileged UID; the agent
only reads the documented proc metrics and calls statfs on mount points.

To upgrade or rotate, rerun `--compose` and enter the current/new credential;
the container is recreated automatically.
To uninstall, run `docker compose --project-directory /opt/pulsy-agent down`,
then remove `/opt/pulsy-agent`. No persistent Docker volumes are created.

## Metrics and connectivity

Only outbound HTTPS to the configured Pulsy origin is required. TLS certificate
verification is always enabled; install your private CA in the system/host trust
store if needed. Requests time out after 10 seconds and retry at most twice with
backoff and jitter. Redirects are refused so credentials cannot be forwarded.
No process arguments, process list, environment variables or remote commands are
collected. Memory is bounded; there is no disk queue of old reports.

- CPU is the busy fraction between two `/proc/stat` observations, excluding
  idle and I/O wait. Guest counters are not counted twice. The first observation,
  a reboot, or counter reset gives an unavailable value until a valid delta exists.
- RAM is `(MemTotal - MemAvailable) / MemTotal`, including reclaimable memory
  in the available value. It is not an OOM-kill detector.
- Swap is `(SwapTotal - SwapFree) / SwapTotal`; a host without swap reports null.
- Filesystem use is `used / (used + available-to-unprivileged-users)`, reflecting
  reserved space. Virtual filesystems and container storage mounts are excluded.
  At most 64 mount points are reported. Unreadable metrics are null, never zero.
- Load averages are the host's 1/5/15-minute values; uptime is seconds since boot.

Reports default to 60 seconds. The server returns the configured reporting
interval and filesystem exclusions.
The agent adopts them for its next report. A newly created monitor stays pending
until connection. If it does not connect, check the origin, firewall/proxy, CA
trust, service state, config permissions and whether the credential was rotated.

## Reproducible builds

`make agent-format`, `make agent-check` and `make agent-build` run inside the
pinned Go container. The agent has no third-party Go dependencies. Static
amd64/arm64 binaries use trimmed paths, no VCS stamping and no build ID. Generated
artifacts are ignored by Git. The server Dockerfile uses the same build script.

Metric semantics follow the [Linux proc filesystem documentation](https://www.kernel.org/doc/html/latest/filesystems/proc.html).
