# Linux server

Monitor host resources and agent connectivity alongside your website checks.

## Create and connect

Choose **Add server** on the dashboard. Save the one-time credential in a password manager. Server monitoring is available to every account. The default reporting interval is 60 seconds; valid intervals are whole seconds from 60 to 3,600.

Copy the installation command from the server page onto the monitored Linux host. It uses your configured public Pulsy HTTPS origin and versioned artifacts, verifies artifact checksums, then configures and starts the agent. Linux amd64 and arm64 are supported. Copied right after you create or rotate the credential, the command includes it and needs no input; it is saved in the host's shell history, so treat that command like a password. Later the credential is no longer shown, and the installer asks for it without echoing it. Never put credentials in URLs or tickets. The host needs outbound HTTPS access to your Pulsy origin, a trusted certificate and an accurate clock. No inbound agent port is needed.

The systemd installer needs root to create the dedicated `pulsy-agent` account and service. Metrics collection runs without root. Configuration is protected at `/etc/pulsy-agent/config.json`. Check `sudo systemctl status pulsy-agent` and `sudo journalctl -u pulsy-agent` for installation errors. Re-running the installer is supported.

## Docker Compose

Use the Compose command shown in setup. It requires Docker with the Compose plugin and starts the container itself, failing with the container logs if it does not stay running. Configuration and the binary live in `/opt/pulsy-agent`. The generated configuration is readable only by its container user and root. The agent runs with a read-only filesystem and no capabilities, privileged mode or Docker socket. Read-only mounts of host `/proc` and `/` provide host metrics, not container resource limits. The Docker administrator must permit those mounts; inaccessible filesystems are unavailable, not zero. A trusted host CA bundle is mounted read-only.

## Metrics and alerts

CPU uses differences between Linux CPU counters; the first sample, a reboot or a counter reset has no CPU percentage. RAM uses `MemAvailable`, not free memory alone. Swap is unavailable when absent. Filesystem usage reflects space available to unprivileged users; virtual and container mounts are excluded. Excluded paths also exclude descendants. Load averages cover 1, 5 and 15 minutes. Uptime is the host's boot uptime. Unreadable measurements remain unavailable. Missing measurements cannot clear an active resource alert.

Default CPU, RAM and filesystem thresholds are 90%. Three consecutive reports at or above a threshold activate that condition. Two reports below it recover that condition. CPU, RAM and each filesystem are evaluated independently. Resource pressure is **degraded**. Three reporting intervals without an accepted report make a connected monitor **down**. Two received reports clear the missing-agent condition; other active conditions can keep it degraded. The scheduler checks deadlines every five seconds. Notifications follow your channels, maintenance and retry settings. Paused monitors do not alert; resuming starts a new connection window.

A new monitor stays pending until its first report. Setup troubleshooting appears after three intervals. RAM alerts indicate memory pressure, not confirmed OOM kills. An active filesystem condition persists when a mount disappears; restore it or explicitly exclude its path.

## History and privacy

Reports are timestamped on receipt. Duplicate or older samples do not advance liveness or alert streaks. History follows the operator setting `CHECK_LOG_RETENTION_DAYS`, which defaults to 30 days. The chart returns at most 1,000 recent reports; its accessible table shows the latest 50 displayed samples. Cleanup removes expired data in batches. Deleting the monitor removes its metrics and credential. Public status pages expose sanitized status, never host metadata, filesystem paths or metric samples.

## Rotate, upgrade and remove

Rotate the credential in server settings, then run the downloaded installer as `sudo bash /tmp/pulsy-agent-install.sh --rotate`; the previous credential stops working immediately. The installer requests the replacement secretly and restarts systemd. With Compose rerun setup with `--compose` and enter the new credential; the container is recreated automatically. Do not share the protected configuration.

For an upgrade, download the release installer again and run it with `--upgrade` before its origin argument. With Compose rerun `--compose`; it recreates the container. The versioned download and checksum verification are repeated. Restart systemd with `sudo systemctl restart pulsy-agent`. Uninstall using the installer with `--uninstall`; for Compose first run `sudo docker compose -f /opt/pulsy-agent/compose.yaml down`, then remove `/opt/pulsy-agent`. Remove the monitor separately in Pulsy to delete history.

## Troubleshooting and scope

Check service/container logs, outbound DNS/HTTPS, certificate trust, token rotation, clock synchronization and filesystem permissions. No report means pending for new monitors, or disconnected for previously connected ones. An unavailable CPU on the first report is expected; wait another interval. Do not shorten the agent interval below the effective interval returned by Pulsy.

Version 1 supports Linux amd64/arm64 only. It does not detect OOM kills, inspect processes, execute remote commands, or support Windows or macOS.

Enable degraded notifications on a channel for CPU, RAM and filesystem alerts, and down notifications for missing reports.

## Excluded filesystems

In server Settings, enter one absolute filesystem path per line, such as `/var/lib/docker`. Each entry must start with `/`; comma-separated lists and relative paths are not supported. Up to 32 paths are accepted, each at most 512 UTF-8 bytes with no control characters. Excluding a path also excludes its descendants.
