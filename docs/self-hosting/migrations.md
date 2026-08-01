# Database migrations

Pulsy applies the committed SQL migrations in `packages/db/drizzle/` automatically on server
startup (and via `make migrate`). Already-applied migrations are skipped using the Drizzle
journal table, so the step is idempotent and safe on every boot.

## Fresh installs

Nothing to do — the first boot creates the schema from migration `0000` onward.

## Web build settings during upgrades

Vite settings are compiled into the web image rather than read at container
startup. During every source-built upgrade, confirm that
`VITE_SOURCE_CODE_URL` points to the publicly reachable tag or commit containing
the exact source for the version you are deploying, then rebuild the web image.
Changing `VITE_SOURCE_CODE_URL` only in the environment of an already-built
container does not update its global source link. Official release images bake
in a link to their exact release commit.

## Notification-channel encryption upgrade

Migration `0010` adds a storage-format marker for notification channels. On
the first subsequent server start, Pulsy atomically encrypts legacy webhook,
Slack, Discord, and Telegram targets plus custom header values before opening
the HTTP listener.

For this upgrade, stop every old server instance, back up PostgreSQL and the
current `ENCRYPTION_KEY`, then start only the new version. Do not use a rolling
mixed-version deployment: an old process can insert new plaintext rows after
the new process has completed its one-time scan. The conversion is forward-only
for application binaries; a pre-`0010` server interprets the ciphertext as a
delivery target. Rotating `ENCRYPTION_KEY` also makes the converted values
unreadable, so keep that key stable and backed up.

## Upgrading an install bootstrapped by `drizzle-kit push` (pre-1.0)

Early Pulsy versions synced the schema with `drizzle-kit push` instead of migrations. Those
databases have the full schema but **no migration journal**, so the migrator would try to
re-create existing tables and fail.

Two ways forward:

1. **Temporary escape hatch** — start the server once with `PULSY_SCHEMA_MODE=push` in your
   `.env` (legacy behavior, dev image only). Plan to baseline soon; new schema changes ship
   only as migrations.
2. **Synchronize, then baseline the journal (recommended)** — first stop the
   server, back up PostgreSQL and `ENCRYPTION_KEY`, set
   `PULSY_SCHEMA_MODE=push`, and start the current source-built development
   image once. Wait for the schema push and notification-secret conversion to
   complete, then stop it again and restore `PULSY_SCHEMA_MODE=migrate`. This
   step is required: never mark a migration as applied before its schema change
   is actually present.

   Next, tell Drizzle that the now-current schema contains every committed
   migration:

   ```bash
   make shell-postgres
   ```

   ```sql
   CREATE SCHEMA IF NOT EXISTS drizzle;
   CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
     id SERIAL PRIMARY KEY,
     hash text NOT NULL,
     created_at bigint
   );
   ```

   Then, for each entry in `packages/db/drizzle/meta/_journal.json` (in order), insert a row
   whose `hash` is the SHA-256 of the corresponding `.sql` file and `created_at` is the
   journal entry's `when` value. From the repo root, this one-liner prints ready-to-run
   `INSERT` statements:

   ```bash
   docker compose -f docker/docker-compose.yml --env-file .env exec server node -e '
   const fs=require("fs"),c=require("crypto");
   const j=JSON.parse(fs.readFileSync("packages/db/drizzle/meta/_journal.json","utf8"));
   for(const e of j.entries){
     const sql=fs.readFileSync(`packages/db/drizzle/${e.tag}.sql`,"utf8");
     const h=c.createHash("sha256").update(sql).digest("hex");
     console.log(`INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) VALUES ('"'"'${h}'"'"', ${e.when});`);
   }'
   ```

   Run the printed statements in psql, then `make migrate` — it reports
   everything as applied and future upgrades proceed normally. Finally, start
   Pulsy normally and verify notification delivery before removing the backup.
