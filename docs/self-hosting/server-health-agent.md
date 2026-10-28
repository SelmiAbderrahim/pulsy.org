# Linux server health agent

Server monitoring is available to every account. The Linux agent reports host
resource measurements over outbound HTTPS; it opens no inbound listener and
accepts no remote commands. Version 1.0.0 supports Linux amd64 and arm64.

## Prepare the Pulsy origin

Set `PUBLIC_WEB_URL` to the HTTPS application origin reachable from monitored
hosts. Installation commands derive from that configuration, never the request
Host header. The origin must have a trusted certificate and no credentials,
path, query or fragment. Hosts need outbound DNS/HTTPS and an accurate clock.

The server image serves versioned artifacts under
`/api/agent/releases/v1.0.0/`: `install.sh`, `compose.yaml`, `SHA256SUMS`,
`pulsy-agent-linux-amd64` and `pulsy-agent-linux-arm64`. Only these files are
served, with GET/HEAD, immutable one-year caching and a 240-request/IP/minute
limit. If files are unavailable, check that the deployed server image includes
the release artifacts. Contributor artifact builds use `make agent-build` in
Docker.

## Install on the monitored host

Choose **Add server** in the dashboard and save the credential shown after
creation. Copy the installation command from that server's setup screen.
Immediately after creation or rotation it can include the credential through
standard input; that copied command contains a secret in shell history. Later
commands prompt for it without echoing. Do not put credentials in URLs, tickets
or configuration committed to a repository.

The installer requires root, Linux, `curl`, `sha256sum`, `python3` and `install`.
Systemd mode also requires a running systemd installation. It downloads the
matching architecture binary and Compose definition over HTTPS and verifies
both against `SHA256SUMS` before installation. These checks detect damaged or
mismatched downloads; the configured HTTPS origin remains the trusted source.

For systemd, the installer creates the dedicated `pulsy-agent` account. The
process runs without root, without capabilities, with service hardening, a
64 MiB memory limit and a 32-task limit. Configuration is owned by that account
at `/etc/pulsy-agent/config.json` with mode `0600`; the containing directory is
restricted. Inspect service operation on the monitored host with:

```sh
sudo systemctl status pulsy-agent
sudo journalctl -u pulsy-agent
```

## Docker Compose installation

Use the setup command with `--compose`. It requires Docker and the Compose
plugin, verifies the artifacts, writes `/opt/pulsy-agent`, and starts the
container. It reports container logs if startup fails. Configuration is mode
`0600`, owned by UID/GID 65532, which also runs the container process.

The container has a read-only filesystem, no capabilities, no privileged mode,
no Docker socket and no host network or PID namespace. Read-only mounts of host
`/proc` and `/` provide host measurements rather than container limits; the host
CA bundle is also mounted read-only. The Docker administrator must permit those
mounts. Unreadable measurements remain unavailable rather than zero.

## Reporting contract and alerts

Reports use `POST /api/agent/v1/metrics` with
`Authorization: Bearer <43-character agent token>` and uncompressed
`application/json`. The route accepts at most 48 KiB before the general JSON
parser, rejects query parameters, and returns only `outcome` plus, when
applicable, `interval` and `excludedFilesystems`. Missing or unknown credentials
return the same unavailable 401. Agent credentials do not authorize account API
or dashboard access.

The default reporting interval is 60 seconds. Configuration accepts whole
seconds from 60 to 3,600, with standard UI choices of 60, 120, 300, 600, 1,800
and 3,600 seconds. The agent follows the interval returned by Pulsy. Per-token
admission permits at most 12 attempts/minute and rejects reports arriving
before the configured interval. The ingress also limits each IP to 1,200
requests/minute, the process to 12,000/minute and concurrent processing to 16.
Respect `Retry-After` on 429/503 responses.

Duplicate or older samples do not advance liveness. Samples more than five
minutes in the future or one day old are rejected. CPU is unknown on the first
sample or after a counter reset; RAM uses `MemAvailable`. Missing swap or
unreadable filesystems stay unavailable. Load averages cover 1, 5 and 15 minutes.
Filesystem exclusions accept up to 32 absolute paths, each at most 512 UTF-8
bytes; each exclusion includes descendants.

Default CPU, RAM and filesystem thresholds are 90%. Three consecutive reports
at or above a threshold activate a degraded condition; two below it recover
that condition. Missing measurements cannot clear an active alert. Three
reporting intervals without an accepted report make a connected monitor Down;
two received reports clear the missing-agent condition. New servers remain
Pending until their first report. Maintenance suppresses notifications while
measurements continue; pause/resume starts a fresh connection window.

History follows `CHECK_LOG_RETENTION_DAYS`, default 30 days. Queries return at
most 1,000 reports. Cleanup deletes expired samples in batches. Public status
pages expose only the safe status projection, never host metadata, filesystem
paths or raw metrics.

## Rotate, update and remove

Rotate in server settings, then use the downloaded installer with `--rotate`
before its HTTPS origin argument. Rotation immediately revokes the previous
credential. The replacement is returned only by explicit create/rotate actions;
ordinary server reads and history omit hashes and ciphertext as well as tokens.
Preserve `ENCRYPTION_KEY` when restoring the server database.

For a systemd software update, download the versioned installer again and run
it with `--upgrade` before the origin argument. It verifies artifacts and
restarts the service while retaining the existing configuration. For Compose
rotation or updates, rerun setup with `--compose`; it asks for the credential
and recreates the container. The installer accepts a credential only through a
hidden prompt or `--credential-stdin`, never a credential command-line argument
or environment variable.

Systemd removal uses the installer with `--uninstall`; it retains the dedicated
account. For Compose, stop the agent with
`sudo docker compose -f /opt/pulsy-agent/compose.yaml down`, then remove its
directory deliberately. Delete the server monitor separately in Pulsy to remove
its metric history and stored credential. Version 1 does not detect OOM kills,
monitor processes or support Windows/macOS.
