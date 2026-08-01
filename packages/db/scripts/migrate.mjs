// Applies the committed SQL migrations in packages/db/drizzle/ using
// drizzle-orm's programmatic migrator. Runs with production dependencies only
// (no drizzle-kit needed), so the same command works in the dev and prod
// images. Safe to run on every boot: already-applied migrations are skipped
// via the drizzle migrations journal table.
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error("[migrate] DATABASE_URL is not set");
	process.exit(1);
}

const migrationsFolder = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../drizzle",
);

const sql = postgres(databaseUrl, { max: 1 });

try {
	await migrate(drizzle(sql), { migrationsFolder });
	console.info("[migrate] Migrations applied");
} catch (err) {
	console.error(
		"[migrate] Failed to apply migrations. If this database was originally " +
			"created by `drizzle-kit push` (pre-migration bootstrap), start once " +
			"with PULSY_SCHEMA_MODE=push or baseline the migration journal — see " +
			"docs/self-hosting.",
	);
	console.error(err);
	process.exit(1);
} finally {
	await sql.end();
}
