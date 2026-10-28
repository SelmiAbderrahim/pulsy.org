#!/bin/sh
set -eu

# The named volume survives image swaps and rollback. Content hashes are
# immutable: keep the first copy and never remove assets an open tab may need.
mkdir -p /var/cache/pulsy/assets
for asset in /usr/share/nginx/html/assets/*; do
	# An empty or absent assets directory leaves a literal glob in POSIX sh.
	[ -f "$asset" ] || continue
	cp -n "$asset" /var/cache/pulsy/assets/
done
