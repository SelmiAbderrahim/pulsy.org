#!/bin/bash
set -eu
# Private cgroup namespace: this mount exposes only the fixture's cgroup subtree.
# No host cgroup filesystem or Docker socket is bind-mounted.
mount -t cgroup2 none /sys/fs/cgroup
exec /sbin/init
