#!/usr/bin/env sh
set -e

# Schema strategy: committed migrations by default. PULSY_SCHEMA_MODE=push is a
# legacy escape hatch for databases bootstrapped by pre-migration `drizzle-kit
# push` installs that have no migration journal yet (dev image only — the prod
# image ships without drizzle-kit).
MODE="${PULSY_SCHEMA_MODE:-migrate}"

if [ "$MODE" = "push" ]; then
	echo "[entrypoint] PULSY_SCHEMA_MODE=push — legacy schema push..."
	# push cannot add NOT NULL columns to populated tables; this performs the
	# data migration first (no-op on fresh or already-migrated databases).
	node packages/db/scripts/pre-push-backfill.mjs || {
		echo "[entrypoint] backfill failed; retrying once after short wait..."
		sleep 3
		node packages/db/scripts/pre-push-backfill.mjs || true
	}
	(cd packages/db && ./node_modules/.bin/drizzle-kit push --force) || {
		echo "[entrypoint] schema push failed; retrying once after short wait..."
		sleep 3
		(cd packages/db && ./node_modules/.bin/drizzle-kit push --force) || true
	}
else
	echo "[entrypoint] Applying committed migrations..."
	node packages/db/scripts/migrate.mjs || {
		echo "[entrypoint] migrate failed; retrying once after short wait..."
		sleep 3
		node packages/db/scripts/migrate.mjs
	}
fi

# Seed before starting the server. Both commands invoke pnpm, which may perform
# a node_modules consistency check; running them concurrently can make two pnpm
# processes race while relinking the dependency tree in a fresh container.
# The seeder is idempotent and exits immediately when SUPERADMIN_* is unset.
echo "[entrypoint] Seeding superadmin..."
./apps/server/node_modules/.bin/tsx apps/server/src/seed-superadmin.ts ||
	echo "[entrypoint] superadmin seed skipped/failed"

echo "[entrypoint] Starting Pulsy server..."
exec ./apps/server/node_modules/.bin/tsx apps/server/src/index.ts
