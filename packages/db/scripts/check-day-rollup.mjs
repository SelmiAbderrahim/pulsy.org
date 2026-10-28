import { readFileSync } from "node:fs";
import postgres from "postgres";

// Schema push cannot install triggers. Reuse the migration's transactional
// backfill and trigger definitions rather than maintaining a second SQL copy.
const migration = readFileSync(new URL("../drizzle/0013_wet_dracula.sql", import.meta.url), "utf8");
const definitions = migration.slice(migration.indexOf("LOCK TABLE uptime_check_log"));
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await client.begin(async tx => {
    await tx`LOCK TABLE uptime_check_log IN SHARE ROW EXCLUSIVE MODE`;
    const [{ count }] = await tx`SELECT count(*)::integer AS count FROM pg_trigger
      WHERE tgrelid = 'uptime_check_log'::regclass AND tgname IN
      ('uptime_check_day_insert', 'uptime_check_day_delete', 'uptime_check_day_update', 'uptime_check_day_truncate')`;
    if (count === 4) return;
    if (count !== 0) throw new Error("Incomplete check-day trigger installation");
    await tx`DELETE FROM uptime_check_day`;
    // Static, checked-in migration SQL; never accepts user input.
    for (const statement of definitions.split("--> statement-breakpoint")) await tx.unsafe(statement);
  });
} finally {
  await client.end();
}
