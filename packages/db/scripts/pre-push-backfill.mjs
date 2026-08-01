// Pre-push data backfill for upgrades of existing installs.
//
// `drizzle-kit push` cannot add a NOT NULL column to a populated table. This
// script runs in the server entrypoint BEFORE push and performs the data
// migration push can't express; push then reconciles the remaining DDL
// (FKs, indexes, nullability changes). Each block is a no-op on fresh
// databases and on databases that already carry the change, so it is safe to
// run on every boot.
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error("[pre-push-backfill] DATABASE_URL is not set");
	process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });

try {
	// uptime_notification_channel.userId (account-level default channels):
	// add nullable, backfill from the owning monitor, then enforce NOT NULL.
	await sql.unsafe(`
		DO $$
		BEGIN
			IF to_regclass('public.uptime_notification_channel') IS NOT NULL
				AND NOT EXISTS (
					SELECT 1 FROM information_schema.columns
					WHERE table_schema = 'public'
						AND table_name = 'uptime_notification_channel'
						AND column_name = 'userId'
				) THEN
				ALTER TABLE "uptime_notification_channel" ADD COLUMN "userId" text;
				UPDATE "uptime_notification_channel" c
					SET "userId" = m."userId"
					FROM "uptime_monitor" m
					WHERE c."uptimeMonitorId" = m."uptimeMonitorId";
				ALTER TABLE "uptime_notification_channel"
					ALTER COLUMN "userId" SET NOT NULL;
			END IF;
		END $$;
	`);
	console.log("[pre-push-backfill] done");
} finally {
	await sql.end();
}
