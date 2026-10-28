#!/bin/bash
# Test-only stand-in for the Docker CLI: the installer fixtures have no Docker daemon.
# Records each invocation; the real container start is covered by make agent-compose-check.
echo "$*" >> /tmp/docker.log
case "$*" in
  "compose version") echo 'Docker Compose version v2-fixture';;
  *" ps --status running --quiet pulsy-agent") echo fixture-container;;
esac
